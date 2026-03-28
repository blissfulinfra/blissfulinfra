import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { execa } from "execa";
import { loadConfig, findProjectDir, type ProjectConfig } from "../utils/config.js";

interface EnvironmentStatus {
  name: string;
  version: string;
  status: "Synced" | "OutOfSync" | "Unknown" | "Progressing" | "Degraded" | "Healthy" | "Missing";
  health: "Healthy" | "Progressing" | "Degraded" | "Missing" | "Unknown";
  replicas: string;
}

async function checkArgoCDAvailable(): Promise<boolean> {
  try {
    await execa("argocd", ["version", "--client"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function checkKubectlAvailable(): Promise<boolean> {
  try {
    await execa("kubectl", ["version", "--client"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function getArgoCDStatus(projectName: string): Promise<EnvironmentStatus[]> {
  const environments = ["staging", "production"];
  const statuses: EnvironmentStatus[] = [];

  for (const env of environments) {
    const appName = `${projectName}-${env}`;
    try {
      const { stdout } = await execa("argocd", [
        "app",
        "get",
        appName,
        "-o",
        "json",
      ], { stdio: "pipe" });

      const app = JSON.parse(stdout);
      statuses.push({
        name: env,
        version: app.status?.sync?.revision?.substring(0, 7) || "unknown",
        status: app.status?.sync?.status || "Unknown",
        health: app.status?.health?.status || "Unknown",
        replicas: "-",
      });
    } catch {
      statuses.push({
        name: env,
        version: "-",
        status: "Missing",
        health: "Missing",
        replicas: "-",
      });
    }
  }

  // Check for ephemeral environments
  try {
    const { stdout } = await execa("argocd", [
      "app",
      "list",
      "-o",
      "json",
    ], { stdio: "pipe" });

    const apps = JSON.parse(stdout);
    const ephemeralApps = apps.filter((app: { metadata: { name: string } }) =>
      app.metadata.name.startsWith(`${projectName}-pr-`)
    );

    for (const app of ephemeralApps) {
      const prNumber = app.metadata.name.replace(`${projectName}-pr-`, "");
      statuses.push({
        name: `PR #${prNumber}`,
        version: app.status?.sync?.revision?.substring(0, 7) || "unknown",
        status: app.status?.sync?.status || "Unknown",
        health: app.status?.health?.status || "Unknown",
        replicas: "-",
      });
    }
  } catch {
    // No ephemeral environments
  }

  return statuses;
}

async function getKubectlStatus(projectName: string): Promise<EnvironmentStatus[]> {
  const environments = ["staging", "production"];
  const statuses: EnvironmentStatus[] = [];

  for (const env of environments) {
    const namespace = `${projectName}-${env}`;
    try {
      const { stdout } = await execa("kubectl", [
        "get",
        "deployment",
        projectName,
        "-n",
        namespace,
        "-o",
        "json",
      ], { stdio: "pipe" });

      const deployment = JSON.parse(stdout);
      const available = deployment.status?.availableReplicas || 0;
      const desired = deployment.spec?.replicas || 0;

      statuses.push({
        name: env,
        version: deployment.spec?.template?.spec?.containers?.[0]?.image?.split(":")[1]?.substring(0, 7) || "latest",
        status: available === desired ? "Synced" : "Progressing",
        health: available === desired ? "Healthy" : "Progressing",
        replicas: `${available}/${desired}`,
      });
    } catch {
      statuses.push({
        name: env,
        version: "-",
        status: "Missing",
        health: "Missing",
        replicas: "-",
      });
    }
  }

  // Check for ephemeral namespaces
  try {
    const { stdout } = await execa("kubectl", [
      "get",
      "namespaces",
      "-l",
      "ephemeral=true",
      "-o",
      "jsonpath={.items[*].metadata.name}",
    ], { stdio: "pipe" });

    const namespaces = stdout.split(" ").filter((n: string) => n.startsWith(`${projectName}-pr-`));

    for (const ns of namespaces) {
      const prNumber = ns.replace(`${projectName}-pr-`, "");
      try {
        const { stdout: depOutput } = await execa("kubectl", [
          "get",
          "deployment",
          projectName,
          "-n",
          ns,
          "-o",
          "json",
        ], { stdio: "pipe" });

        const deployment = JSON.parse(depOutput);
        const available = deployment.status?.availableReplicas || 0;
        const desired = deployment.spec?.replicas || 0;

        statuses.push({
          name: `PR #${prNumber}`,
          version: deployment.spec?.template?.spec?.containers?.[0]?.image?.split(":")[1]?.substring(0, 7) || "latest",
          status: available === desired ? "Synced" : "Progressing",
          health: available === desired ? "Healthy" : "Progressing",
          replicas: `${available}/${desired}`,
        });
      } catch {
        // Skip if deployment not found
      }
    }
  } catch {
    // No ephemeral namespaces
  }

  return statuses;
}

async function getLocalStatus(config: ProjectConfig, projectDir: string): Promise<EnvironmentStatus | null> {
  try {
    const { stdout } = await execa("docker", ["compose", "ps", "--format", "json"], {
      cwd: projectDir,
      stdio: "pipe",
    });

    const containers = stdout.trim().split("\n").filter(Boolean).map((line: string) => JSON.parse(line));
    const appContainer = containers.find((c: { Name: string }) =>
      c.Name.includes(`${config.name}-app`) || c.Name.includes(`${config.name}-frontend`)
    );

    if (appContainer) {
      return {
        name: "local",
        version: "dev",
        status: appContainer.State === "running" ? "Synced" : "OutOfSync",
        health: appContainer.State === "running" ? "Healthy" : "Degraded",
        replicas: appContainer.State === "running" ? "1/1" : "0/1",
      };
    }
  } catch {
    // Docker not running or no containers
  }
  return null;
}

function formatStatus(status: string): string {
  switch (status) {
    case "Synced":
    case "Healthy":
      return chalk.green(`✓ ${status}`);
    case "Progressing":
      return chalk.yellow(`◐ ${status}`);
    case "OutOfSync":
    case "Degraded":
      return chalk.red(`✗ ${status}`);
    case "Missing":
      return chalk.dim(`- ${status}`);
    default:
      return chalk.dim(`? ${status}`);
  }
}

export async function statusAction(name?: string): Promise<void> {
  const spinner = ora("Fetching deployment status...").start();

  // Find project directory
  const projectDir = await findProjectDir(name);
  if (!projectDir) {
    spinner.stop();
    if (name) {
      console.error(chalk.red(`Project '${name}' not found.`));
    } else {
      console.error(chalk.red("No blissful-infra.yaml found."));
      console.error(chalk.dim("Run from project directory or specify project name:"));
      console.error(chalk.cyan("  blissful-infra status my-app"));
    }
    process.exit(1);
  }

  // Load project config
  const config = await loadConfig(projectDir);
  if (!config) {
    spinner.stop();
    console.error(chalk.red("No blissful-infra.yaml found."));
    process.exit(1);
  }

  const statuses: EnvironmentStatus[] = [];

  // Get local status
  const localStatus = await getLocalStatus(config, projectDir);
  if (localStatus) {
    statuses.push(localStatus);
  }

  // Get cluster status if not local-only
  if ((config.deploy?.target ?? "local-only") !== "local-only") {
    const hasArgoCD = await checkArgoCDAvailable();
    const hasKubectl = await checkKubectlAvailable();

    if (hasArgoCD) {
      const clusterStatuses = await getArgoCDStatus(config.name);
      statuses.push(...clusterStatuses);
    } else if (hasKubectl) {
      const clusterStatuses = await getKubectlStatus(config.name);
      statuses.push(...clusterStatuses);
    }
  }

  spinner.stop();

  // Display status table
  console.log();
  console.log(chalk.bold(`Deployment Status: ${config.name}`));
  console.log();

  if (statuses.length === 0) {
    console.log(chalk.dim("No deployments found."));
    console.log();
    console.log(chalk.dim("Start local environment:"));
    console.log(chalk.cyan("  blissful-infra up"));
    console.log();
    if ((config.deploy?.target ?? "local-only") !== "local-only") {
      console.log(chalk.dim("Deploy to staging:"));
      console.log(chalk.cyan("  blissful-infra deploy --env staging"));
    }
    return;
  }

  // Print header
  console.log(
    chalk.dim("Environment".padEnd(14)) +
    chalk.dim("Version".padEnd(10)) +
    chalk.dim("Status".padEnd(18)) +
    chalk.dim("Replicas")
  );
  console.log(chalk.dim("─".repeat(55)));

  // Print rows
  for (const status of statuses) {
    console.log(
      status.name.padEnd(14) +
      status.version.padEnd(10) +
      formatStatus(status.status).padEnd(27) +  // Extra padding for color codes
      status.replicas
    );
  }

  console.log();
}

export const statusCommand = new Command("status")
  .description("Show deployment status across all environments")
  .argument("[name]", "Project name (if running from parent directory)")
  .action(async (name: string | undefined) => {
    await statusAction(name);
  });
