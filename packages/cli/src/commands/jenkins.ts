import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JENKINS_DIR = path.join(__dirname, "..", "..", "templates", "jenkins");
const JENKINS_DATA_DIR = path.join(process.env.HOME || "~", ".blissful-infra", "jenkins");
const JENKINS_BASE = "http://localhost:8081";
const JENKINS_AUTH = "Basic " + Buffer.from("admin:admin").toString("base64");

interface JenkinsOptions {
  build?: boolean;
  reset?: boolean;
}

/** Fetch Jenkins CSRF crumb (required for all POST operations). */
async function getJenkinsCrumb(): Promise<Record<string, string>> {
  try {
    const resp = await fetch(`${JENKINS_BASE}/crumbIssuer/api/json`, {
      headers: { Authorization: JENKINS_AUTH },
      signal: AbortSignal.timeout(3000),
    });
    if (resp.ok) {
      const data = await resp.json() as { crumb: string; crumbRequestField: string };
      return { [data.crumbRequestField]: data.crumb };
    }
  } catch {
    // CSRF disabled or Jenkins not reachable — proceed without crumb
  }
  return {};
}

/** POST to Jenkins with automatic crumb injection. */
async function jenkinsPost(url: string, body: string, contentType = "application/xml"): Promise<Response> {
  const crumb = await getJenkinsCrumb();
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": contentType, Authorization: JENKINS_AUTH, ...crumb },
    body,
  });
}

export async function checkDockerRunning(): Promise<boolean> {
  try {
    await execa("docker", ["info"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export async function isJenkinsRunning(): Promise<boolean> {
  try {
    const { stdout } = await execa("docker", [
      "ps",
      "--filter",
      "name=blissful-jenkins",
      "--format",
      "{{.Status}}",
    ], { stdio: "pipe" });
    return stdout.includes("Up");
  } catch {
    return false;
  }
}

async function waitForJenkins(timeoutSeconds = 120): Promise<boolean> {
  const spinner = ora("Waiting for Jenkins to be ready...").start();
  const startTime = Date.now();
  const timeoutMs = timeoutSeconds * 1000;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`${JENKINS_BASE}/login`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok || response.status === 403) {
        spinner.succeed("Jenkins is ready");
        return true;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
    spinner.text = `Waiting for Jenkins to be ready... (${Math.round((Date.now() - startTime) / 1000)}s)`;
  }

  spinner.fail("Jenkins failed to start within timeout");
  return false;
}

async function ensureJenkinsImage(): Promise<void> {
  try {
    await execa("docker", ["image", "inspect", "blissful-jenkins:latest"], { stdio: "pipe" });
  } catch {
    const spinner = ora("Building Jenkins image with plugins (first time only, ~2 min)...").start();
    try {
      await execa("docker", ["build", "-t", "blissful-jenkins:latest", "."], {
        cwd: JENKINS_DATA_DIR,
        stdio: "pipe",
      });
      spinner.succeed("Jenkins image built");
    } catch (error) {
      spinner.fail("Failed to build Jenkins image");
      throw error;
    }
  }
}

export async function startJenkins(opts: JenkinsOptions): Promise<void> {
  // Check Docker
  if (!(await checkDockerRunning())) {
    console.error(chalk.red("Docker is not running."));
    process.exit(1);
  }

  // Check if already running
  if (await isJenkinsRunning()) {
    console.log(chalk.yellow("Jenkins is already running."));
    console.log();
    console.log(chalk.dim("URL:"), chalk.cyan("http://localhost:8081"));
    console.log(chalk.dim("Username:"), "admin");
    console.log(chalk.dim("Password:"), "admin");
    return;
  }

  // Ensure data directory exists
  await fs.mkdir(JENKINS_DATA_DIR, { recursive: true });

  // On reset, wipe Docker volumes so JCasC runs fresh
  if (opts.reset) {
    const resetSpinner = ora("Removing old Jenkins data...").start();
    try {
      await execa("docker", ["compose", "down", "-v"], { cwd: JENKINS_DATA_DIR, stdio: "pipe" });
      resetSpinner.succeed("Old Jenkins data removed");
    } catch {
      resetSpinner.info("No existing Jenkins data to remove");
    }
  }

  // Copy Jenkins templates to data directory if not exists or reset
  const composeFile = path.join(JENKINS_DATA_DIR, "docker-compose.yaml");
  const shouldCopy = opts.reset || !(await fs.access(composeFile).then(() => true).catch(() => false));

  if (shouldCopy) {
    const spinner = ora("Setting up Jenkins configuration...").start();
    try {
      // Copy all files from templates/jenkins to data directory
      const files = await fs.readdir(JENKINS_DIR);
      for (const file of files) {
        const src = path.join(JENKINS_DIR, file);
        const dest = path.join(JENKINS_DATA_DIR, file);
        await fs.copyFile(src, dest);
      }
      spinner.succeed("Jenkins configuration ready");
    } catch (error) {
      spinner.fail("Failed to setup Jenkins configuration");
      throw error;
    }
  }

  // Force rebuild on --build, otherwise ensure image exists (build once on first run)
  if (opts.build) {
    await execa("docker", ["rmi", "-f", "blissful-jenkins:latest"], { stdio: "pipe" }).catch(() => {});
  }
  await ensureJenkinsImage();

  // Start Jenkins
  const spinner = ora("Starting Jenkins...").start();
  try {
    await execa("docker", ["compose", "up", "-d"], {
      cwd: JENKINS_DATA_DIR,
      stdio: "pipe",
    });
    spinner.succeed("Jenkins containers started");
  } catch (error) {
    spinner.fail("Failed to start Jenkins");
    throw error;
  }

  // Wait for Jenkins to be ready
  await waitForJenkins();

  console.log();
  console.log(chalk.green("Jenkins is running!"));
  console.log();
  console.log(chalk.dim("URL:"), chalk.cyan("http://localhost:8081"));
  console.log(chalk.dim("Username:"), "admin");
  console.log(chalk.dim("Password:"), "admin");
  console.log();
  console.log(chalk.dim("Registry:"), chalk.cyan("localhost:5050"));
  console.log();
  console.log(chalk.dim("To register a project:"));
  console.log(chalk.cyan("  blissful-infra jenkins add-project <project-name>"));
}

async function stopJenkins(): Promise<void> {
  if (!(await isJenkinsRunning())) {
    console.log(chalk.yellow("Jenkins is not running."));
    return;
  }

  const spinner = ora("Stopping Jenkins...").start();
  try {
    await execa("docker", ["compose", "down"], {
      cwd: JENKINS_DATA_DIR,
      stdio: "pipe",
    });
    spinner.succeed("Jenkins stopped");
  } catch (error) {
    spinner.fail("Failed to stop Jenkins");
    throw error;
  }
}

async function jenkinsStatus(): Promise<void> {
  const running = await isJenkinsRunning();

  console.log();
  console.log(chalk.bold("Jenkins Status"));
  console.log();

  if (running) {
    console.log(chalk.green("●"), "Jenkins is running");
    console.log();
    console.log(chalk.dim("URL:"), chalk.cyan("http://localhost:8081"));
    console.log(chalk.dim("Username:"), "admin");
    console.log(chalk.dim("Password:"), "admin");

    // Check registry
    try {
      const { stdout } = await execa("docker", [
        "ps",
        "--filter",
        "name=blissful-registry",
        "--format",
        "{{.Status}}",
      ], { stdio: "pipe" });

      if (stdout.includes("Up")) {
        console.log();
        console.log(chalk.green("●"), "Registry is running");
        console.log(chalk.dim("URL:"), chalk.cyan("localhost:5050"));
      }
    } catch {
      // Registry not running
    }
  } else {
    console.log(chalk.red("●"), "Jenkins is not running");
    console.log();
    console.log(chalk.dim("Start with:"));
    console.log(chalk.cyan("  blissful-infra jenkins start"));
  }
  console.log();
}

async function findJenkinsfileScriptPath(projectDir: string): Promise<string | null> {
  for (const loc of ["Jenkinsfile", "backend/Jenkinsfile"]) {
    try {
      await fs.access(path.join(projectDir, loc));
      return loc;
    } catch {
      // try next
    }
  }
  return null;
}

function buildJobXml(projectDir: string, projectName: string, scriptPath: string): string {
  return `<?xml version='1.1' encoding='UTF-8'?>
<flow-definition plugin="workflow-job">
  <description>Pipeline for ${projectName} - managed by blissful-infra</description>
  <keepDependencies>false</keepDependencies>
  <properties>
    <org.jenkinsci.plugins.workflow.job.properties.PipelineTriggersJobProperty>
      <triggers/>
    </org.jenkinsci.plugins.workflow.job.properties.PipelineTriggersJobProperty>
  </properties>
  <definition class="org.jenkinsci.plugins.workflow.cps.CpsScmFlowDefinition" plugin="workflow-cps">
    <scm class="hudson.plugins.git.GitSCM" plugin="git">
      <configVersion>2</configVersion>
      <userRemoteConfigs>
        <hudson.plugins.git.UserRemoteConfig>
          <url>${projectDir}</url>
        </hudson.plugins.git.UserRemoteConfig>
      </userRemoteConfigs>
      <branches>
        <hudson.plugins.git.BranchSpec>
          <name>*/main</name>
        </hudson.plugins.git.BranchSpec>
        <hudson.plugins.git.BranchSpec>
          <name>*/master</name>
        </hudson.plugins.git.BranchSpec>
        <hudson.plugins.git.BranchSpec>
          <name>*/dev</name>
        </hudson.plugins.git.BranchSpec>
      </branches>
      <doGenerateSubmoduleConfigurations>false</doGenerateSubmoduleConfigurations>
      <submoduleCfg class="empty-list"/>
      <extensions/>
    </scm>
    <scriptPath>${scriptPath}</scriptPath>
    <lightweight>true</lightweight>
  </definition>
  <triggers/>
  <disabled>false</disabled>
</flow-definition>`;
}

/**
 * Register a project with Jenkins. Safe to call from other commands —
 * no process.exit, silently skips if no Jenkinsfile is found.
 */
export async function registerProjectWithJenkins(projectDir: string, projectName: string): Promise<void> {
  const scriptPath = await findJenkinsfileScriptPath(projectDir);
  if (!scriptPath) return;

  const jobXml = buildJobXml(projectDir, projectName, scriptPath);

  // Skip if already registered
  const checkResp = await fetch(
    `${JENKINS_BASE}/job/blissful-projects/job/${projectName}/api/json`,
    { headers: { Authorization: JENKINS_AUTH }, signal: AbortSignal.timeout(5000) },
  );
  if (checkResp.ok) return;

  // Try the blissful-projects folder first, fall back to root
  const createResp = await jenkinsPost(
    `${JENKINS_BASE}/job/blissful-projects/createItem?name=${projectName}`,
    jobXml,
  );

  if (!createResp.ok) {
    const fallbackResp = await jenkinsPost(
      `${JENKINS_BASE}/createItem?name=${projectName}`,
      jobXml,
    );
    if (!fallbackResp.ok) {
      throw new Error(`Failed to create Jenkins job: ${fallbackResp.status}`);
    }
  }

  console.log(chalk.dim("  Jenkins job: ") + chalk.cyan(`http://localhost:8081/job/blissful-projects/job/${projectName}`));
}

async function addProject(projectName: string): Promise<void> {
  // Find project directory
  const projectDir = path.join(process.cwd(), projectName);
  const configPath = path.join(projectDir, "blissful-infra.yaml");

  try {
    await fs.access(configPath);
  } catch {
    console.error(chalk.red(`Project '${projectName}' not found.`));
    console.error(chalk.dim("Make sure you're in the parent directory of the project."));
    process.exit(1);
  }

  // Check if Jenkinsfile exists (root or backend/)
  const scriptPath = await findJenkinsfileScriptPath(projectDir);
  if (!scriptPath) {
    console.error(chalk.red(`No Jenkinsfile found in ${projectName}.`));
    console.error(chalk.dim("The spring-boot backend template includes a Jenkinsfile automatically."));
    process.exit(1);
  }

  // Check if Jenkins is running
  if (!(await isJenkinsRunning())) {
    console.error(chalk.red("Jenkins is not running."));
    console.error(chalk.dim("Start Jenkins first:"));
    console.error(chalk.cyan("  blissful-infra jenkins start"));
    process.exit(1);
  }

  const spinner = ora(`Adding ${projectName} to Jenkins...`).start();

  try {
    const checkResp = await fetch(
      `${JENKINS_BASE}/job/blissful-projects/job/${projectName}/api/json`,
      { headers: { Authorization: JENKINS_AUTH } },
    );

    if (checkResp.ok) {
      spinner.info(`Project ${projectName} already exists in Jenkins`);
    } else {
      await registerProjectWithJenkins(projectDir, projectName);
      spinner.succeed(`Added ${projectName} to Jenkins`);
    }

    console.log();
    console.log(chalk.dim("Job URL:"), chalk.cyan(`http://localhost:8081/job/blissful-projects/job/${projectName}`));
    console.log();
    console.log(chalk.dim("To run the pipeline:"));
    console.log(chalk.cyan(`  blissful-infra jenkins build ${projectName}`));
  } catch (error) {
    spinner.fail(`Failed to add ${projectName} to Jenkins`);
    throw error;
  }
}

async function buildProject(projectName: string): Promise<void> {
  // Check if Jenkins is running
  if (!(await isJenkinsRunning())) {
    console.error(chalk.red("Jenkins is not running."));
    process.exit(1);
  }

  const spinner = ora(`Triggering build for ${projectName}...`).start();

  try {
    // Try both with and without folder prefix
    let response = await jenkinsPost(
      `${JENKINS_BASE}/job/blissful-projects/job/${projectName}/build`, "",
    );
    if (!response.ok) {
      response = await jenkinsPost(
        `${JENKINS_BASE}/job/${projectName}/build`, "",
      );
    }

    if (!response.ok) {
      throw new Error(`Failed to trigger build: ${response.status}`);
    }

    spinner.succeed(`Build triggered for ${projectName}`);
    console.log();
    console.log(chalk.dim("View build:"), chalk.cyan(`http://localhost:8081/job/${projectName}`));
  } catch (error) {
    spinner.fail(`Failed to trigger build for ${projectName}`);
    throw error;
  }
}

async function listProjects(): Promise<void> {
  // Check if Jenkins is running
  if (!(await isJenkinsRunning())) {
    console.error(chalk.red("Jenkins is not running."));
    process.exit(1);
  }

  const spinner = ora("Fetching projects...").start();

  try {
    // Get all jobs
    const response = await fetch(`${JENKINS_BASE}/api/json`, {
      headers: { Authorization: JENKINS_AUTH },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch jobs: ${response.status}`);
    }

    const data = await response.json() as {
      jobs: Array<{
        name: string;
        color: string;
        lastBuild?: {
          number: number;
          result: string;
          timestamp: number;
        };
      }>;
    };

    spinner.stop();

    console.log();
    console.log(chalk.bold("Jenkins Projects"));
    console.log();

    if (data.jobs.length === 0) {
      console.log(chalk.dim("No projects registered yet."));
      console.log();
      console.log(chalk.dim("Add a project:"));
      console.log(chalk.cyan("  blissful-infra jenkins add-project <name>"));
    } else {
      console.log(chalk.dim("Name".padEnd(25) + "Status".padEnd(15) + "Last Build"));
      console.log(chalk.dim("─".repeat(55)));

      for (const job of data.jobs) {
        if (job.name === "blissful-projects") continue; // Skip folder

        let status = "unknown";
        let statusColor = chalk.dim;

        if (job.color === "blue") {
          status = "success";
          statusColor = chalk.green;
        } else if (job.color === "red") {
          status = "failed";
          statusColor = chalk.red;
        } else if (job.color.includes("anime")) {
          status = "building";
          statusColor = chalk.yellow;
        } else if (job.color === "notbuilt") {
          status = "not built";
          statusColor = chalk.dim;
        }

        const lastBuild = job.lastBuild
          ? `#${job.lastBuild.number} (${new Date(job.lastBuild.timestamp).toLocaleString()})`
          : "-";

        console.log(
          job.name.padEnd(25) +
          statusColor(status.padEnd(15)) +
          chalk.dim(lastBuild)
        );
      }
    }
    console.log();
  } catch (error) {
    spinner.fail("Failed to fetch projects");
    throw error;
  }
}

export const jenkinsCommand = new Command("jenkins")
  .description("Manage shared Jenkins CI/CD server")
  .addCommand(
    new Command("start")
      .description("Start Jenkins server")
      .option("--build", "Build custom image with plugins")
      .option("--reset", "Reset configuration to defaults")
      .action(startJenkins)
  )
  .addCommand(
    new Command("stop")
      .description("Stop Jenkins server")
      .action(stopJenkins)
  )
  .addCommand(
    new Command("status")
      .description("Show Jenkins status")
      .action(jenkinsStatus)
  )
  .addCommand(
    new Command("add-project")
      .description("Register a project with Jenkins")
      .argument("<name>", "Project name")
      .action(addProject)
  )
  .addCommand(
    new Command("build")
      .description("Trigger a build for a project")
      .argument("<name>", "Project name")
      .action(buildProject)
  )
  .addCommand(
    new Command("list")
      .description("List registered projects")
      .action(listProjects)
  );
