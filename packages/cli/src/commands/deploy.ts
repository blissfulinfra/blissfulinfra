import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { loadConfig, findProjectDir, type ProjectConfig } from "../utils/config.js";

interface DeployOptions {
  env: string;
  image?: string;
  dryRun?: boolean;
  timeout?: number;
  canary?: boolean;
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

async function deployWithArgoCD(
  config: ProjectConfig,
  projectDir: string,
  opts: DeployOptions
): Promise<void> {
  const appName = `${config.name}-${opts.env}`;
  const spinner = ora(`Deploying ${config.name} to ${opts.env}...`).start();

  try {
    if (opts.dryRun) {
      spinner.info("Dry run - would sync:");
      console.log(chalk.dim(`  argocd app sync ${appName}`));
      return;
    }

    // Sync the application
    spinner.text = `Syncing ${appName} via Argo CD...`;
    await execa("argocd", [
      "app",
      "sync",
      appName,
      "--timeout",
      String(opts.timeout || 300),
    ], {
      cwd: projectDir,
      stdio: "pipe",
    });

    // Wait for healthy status
    spinner.text = `Waiting for ${appName} to become healthy...`;
    await execa("argocd", [
      "app",
      "wait",
      appName,
      "--health",
      "--timeout",
      String(opts.timeout || 300),
    ], {
      cwd: projectDir,
      stdio: "pipe",
    });

    spinner.succeed(`Deployed ${config.name} to ${opts.env}`);

    // Get and display status
    const { stdout } = await execa("argocd", [
      "app",
      "get",
      appName,
      "-o",
      "json",
    ], { stdio: "pipe" });

    const status = JSON.parse(stdout);
    console.log();
    console.log(chalk.dim("Status:"), chalk.green(status.status?.sync?.status || "Unknown"));
    console.log(chalk.dim("Health:"), chalk.green(status.status?.health?.status || "Unknown"));
    console.log(chalk.dim("Revision:"), status.status?.sync?.revision?.substring(0, 7) || "Unknown");
  } catch (error) {
    spinner.fail(`Failed to deploy to ${opts.env}`);
    throw error;
  }
}

async function deployWithKubectl(
  config: ProjectConfig,
  projectDir: string,
  opts: DeployOptions
): Promise<void> {
  const namespace = `${config.name}-${opts.env}`;
  const overlayPath = path.join(projectDir, "k8s", "overlays", opts.env);
  const spinner = ora(`Deploying ${config.name} to ${opts.env}...`).start();

  try {
    // Check if overlay exists
    try {
      await fs.access(overlayPath);
    } catch {
      spinner.fail(`Overlay not found: k8s/overlays/${opts.env}`);
      console.error(chalk.dim("Available overlays: staging, production, ephemeral"));
      process.exit(1);
    }

    if (opts.dryRun) {
      spinner.info("Dry run - would apply:");
      const { stdout } = await execa("kubectl", [
        "apply",
        "-k",
        overlayPath,
        "-n",
        namespace,
        "--dry-run=client",
        "-o",
        "yaml",
      ], { stdio: "pipe" });
      console.log(stdout);
      return;
    }

    // Create namespace if it doesn't exist
    spinner.text = `Creating namespace ${namespace}...`;
    await execa("kubectl", [
      "create",
      "namespace",
      namespace,
      "--dry-run=client",
      "-o",
      "yaml",
    ], { stdio: "pipe" }).then(({ stdout }) =>
      execa("kubectl", ["apply", "-f", "-"], { input: stdout, stdio: "pipe" })
    );

    // Apply kustomize manifests
    spinner.text = `Applying manifests to ${namespace}...`;
    await execa("kubectl", [
      "apply",
      "-k",
      overlayPath,
      "-n",
      namespace,
    ], {
      cwd: projectDir,
      stdio: "pipe",
    });

    // Wait for rollout
    spinner.text = `Waiting for deployment rollout...`;
    await execa("kubectl", [
      "rollout",
      "status",
      `deployment/${config.name}`,
      "-n",
      namespace,
      `--timeout=${opts.timeout || 300}s`,
    ], {
      cwd: projectDir,
      stdio: "pipe",
    });

    spinner.succeed(`Deployed ${config.name} to ${opts.env}`);

    // Get deployment status
    const { stdout } = await execa("kubectl", [
      "get",
      "deployment",
      config.name,
      "-n",
      namespace,
      "-o",
      "jsonpath={.status.availableReplicas}/{.spec.replicas}",
    ], { stdio: "pipe" });

    console.log();
    console.log(chalk.dim("Namespace:"), chalk.cyan(namespace));
    console.log(chalk.dim("Replicas:"), chalk.green(stdout || "0/0"));
  } catch (error) {
    spinner.fail(`Failed to deploy to ${opts.env}`);
    throw error;
  }
}

export async function deployAction(
  name: string | undefined,
  opts: DeployOptions
): Promise<void> {
  // Find project directory
  const projectDir = await findProjectDir(name);
  if (!projectDir) {
    if (name) {
      console.error(chalk.red(`Project '${name}' not found.`));
    } else {
      console.error(chalk.red("No blissful-infra.yaml found."));
      console.error(chalk.dim("Run from project directory or specify project name:"));
      console.error(chalk.cyan("  blissful-infra deploy my-app --env staging"));
    }
    process.exit(1);
  }

  // Load project config
  const config = await loadConfig(projectDir);
  if (!config) {
    console.error(chalk.red("No blissful-infra.yaml found."));
    process.exit(1);
  }

  // Check deploy target
  if ((config.deploy?.target ?? "local-only") === "local-only") {
    console.error(chalk.red("Deploy requires kubernetes or cloud target."));
    console.error(chalk.dim("Update deploy_target in blissful-infra.yaml to 'kubernetes' or 'cloud'"));
    process.exit(1);
  }

  // Validate environment
  const validEnvs = ["staging", "production", "ephemeral"];
  if (!validEnvs.includes(opts.env)) {
    console.error(chalk.red(`Invalid environment: ${opts.env}`));
    console.error(chalk.dim("Valid environments: staging, production, ephemeral"));
    process.exit(1);
  }

  // Production deployment warning
  if (opts.env === "production" && !opts.dryRun) {
    console.log(chalk.yellow("Warning: Deploying to production!"));
    console.log(chalk.dim("Use --dry-run to preview changes first."));
    console.log();
  }

  // Check for Argo CD or kubectl
  const hasArgoCD = await checkArgoCDAvailable();
  const hasKubectl = await checkKubectlAvailable();

  if (!hasArgoCD && !hasKubectl) {
    console.error(chalk.red("Neither argocd nor kubectl CLI found."));
    console.error(chalk.dim("Install argocd: brew install argocd"));
    console.error(chalk.dim("Install kubectl: brew install kubernetes-cli"));
    process.exit(1);
  }

  // Deploy using available tool
  if (hasArgoCD) {
    await deployWithArgoCD(config, projectDir, opts);
  } else {
    await deployWithKubectl(config, projectDir, opts);
  }

  console.log();
  console.log(chalk.dim("Run"), chalk.cyan("blissful-infra status"), chalk.dim("to view all environments"));
}

export const deployCommand = new Command("deploy")
  .description("Deploy to environment via Argo CD or kubectl")
  .argument("[name]", "Project name (if running from parent directory)")
  .option("-e, --env <environment>", "Target environment (staging, production, ephemeral)", "staging")
  .option("-i, --image <tag>", "Specific image tag to deploy")
  .option("--dry-run", "Show what would be deployed without applying")
  .option("--canary", "Deploy using canary strategy (Argo Rollouts)")
  .option("-t, --timeout <seconds>", "Deployment timeout in seconds", "300")
  .action(async (name: string | undefined, opts: DeployOptions) => {
    if (opts.canary) {
      console.log(chalk.blue.bold("Deploying with canary strategy (Argo Rollouts)"));
      console.log(chalk.gray("This will use the Rollout resource instead of Deployment."));
      console.log(chalk.gray("Monitor with: blissful-infra canary status"));
    }
    await deployAction(name, opts);
  });
