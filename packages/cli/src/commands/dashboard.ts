import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { createApiServer } from "../server/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JENKINS_DIR = path.join(__dirname, "..", "..", "templates", "jenkins");
const JENKINS_DATA_DIR = path.join(process.env.HOME || "~", ".blissful-infra", "jenkins");

async function isJenkinsRunning(): Promise<boolean> {
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

async function startJenkinsServer(): Promise<boolean> {
  // Check if already running
  if (await isJenkinsRunning()) {
    return true;
  }

  // Ensure data directory exists
  await fs.mkdir(JENKINS_DATA_DIR, { recursive: true });

  // Copy Jenkins templates to data directory if not exists
  const composeFile = path.join(JENKINS_DATA_DIR, "docker-compose.yaml");
  const exists = await fs.access(composeFile).then(() => true).catch(() => false);

  if (!exists) {
    try {
      const files = await fs.readdir(JENKINS_DIR);
      for (const file of files) {
        const src = path.join(JENKINS_DIR, file);
        const dest = path.join(JENKINS_DATA_DIR, file);
        await fs.copyFile(src, dest);
      }
    } catch {
      return false;
    }
  }

  // Start Jenkins
  try {
    await execa("docker", ["compose", "up", "-d"], {
      cwd: JENKINS_DATA_DIR,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      await execa("open", [url]);
    } else if (platform === "win32") {
      await execa("cmd", ["/c", "start", url]);
    } else {
      await execa("xdg-open", [url]);
    }
  } catch {
    // Silently fail if can't open browser
  }
}

export async function dashboardAction(opts: { port?: string; open?: boolean; dir?: string; noJenkins?: boolean } = {}): Promise<void> {
  // Use provided directory or current working directory
  const workingDir = opts.dir || process.cwd();

  const apiPort = parseInt(opts.port || "3002", 10);
  const dashboardPort = 5173;
  const shouldOpen = opts.open !== false;
  const startJenkins = opts.noJenkins !== true;

  // Start API server
  const spinner = ora("Starting dashboard...").start();

  const apiServer = createApiServer(workingDir, apiPort);
  await apiServer.start();

  spinner.succeed("Dashboard ready");

  // Start Jenkins if enabled
  let jenkinsStarted = false;
  if (startJenkins) {
    const jenkinsSpinner = ora("Starting Jenkins CI server...").start();
    jenkinsStarted = await startJenkinsServer();
    if (jenkinsStarted) {
      jenkinsSpinner.succeed("Jenkins CI server ready");
    } else {
      jenkinsSpinner.warn("Jenkins CI server could not be started (Docker may not be running)");
    }
  }

  console.log();
  console.log(chalk.green("Blissful Infra Orchestrator"));
  console.log(chalk.dim("  Dashboard:  ") + chalk.cyan(`http://localhost:${dashboardPort}`) + chalk.dim(" (Vite dev server)"));
  console.log(chalk.dim("  API:        ") + chalk.cyan(`http://localhost:${apiPort}`));
  console.log(chalk.dim("  Projects:   ") + chalk.cyan(workingDir));
  if (jenkinsStarted) {
    console.log(chalk.dim("  Jenkins:    ") + chalk.cyan("http://localhost:8081") + chalk.dim(" (admin/admin)"));
    console.log(chalk.dim("  Registry:   ") + chalk.cyan("localhost:5050"));
  }
  console.log();
  console.log(chalk.dim("Press Ctrl+C to stop"));
  console.log();

  // Start the Vite dev server for the dashboard
  const dashboardDir = path.join(__dirname, "..", "..", "..", "dashboard");

  try {
    await fs.access(dashboardDir);
  } catch {
    console.error(chalk.red("Dashboard package not found."));
    console.error(chalk.dim("The dashboard needs to be built. Run:"));
    console.error(chalk.cyan("  cd packages/dashboard && npm install && npm run dev"));
    process.exit(1);
  }

  // Open browser
  if (shouldOpen) {
    await openBrowser(`http://localhost:${dashboardPort}`);
  }

  // Run the dashboard dev server
  try {
    await execa("npm", ["run", "dev"], {
      cwd: dashboardDir,
      stdio: "inherit",
    });
  } catch (error) {
    // Check if it was a SIGINT
    if (error instanceof Error && "signal" in error && error.signal === "SIGINT") {
      // Normal exit
    } else {
      throw error;
    }
  } finally {
    // Cleanup
    const cleanupSpinner = ora("Shutting down...").start();
    await apiServer.stop();
    // Note: We don't stop Jenkins on exit so builds can continue
    cleanupSpinner.succeed("Stopped");
  }
}

export const dashboardCommand = new Command("dashboard")
  .description("Open the orchestrator dashboard with Jenkins CI server")
  .option("-p, --port <port>", "API server port", "3002")
  .option("--no-open", "Don't open browser automatically")
  .option("--no-jenkins", "Don't start Jenkins CI server")
  .option("-d, --dir <directory>", "Working directory for projects", process.cwd())
  .action(async (opts: { port: string; open: boolean; noJenkins: boolean; dir: string }) => {
    await dashboardAction(opts);
  });
