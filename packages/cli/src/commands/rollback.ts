import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { execa } from "execa";
import { loadConfig, findProjectDir, type ProjectConfig } from "../utils/config.js";

interface RollbackOptions {
  env: string;
  revision?: string;
  dryRun?: boolean;
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

async function getArgoCDHistory(appName: string): Promise<Array<{ id: string; revision: string; deployedAt: string }>> {
  try {
    const { stdout } = await execa("argocd", [
      "app",
      "history",
      appName,
      "-o",
      "json",
    ], { stdio: "pipe" });

    const history = JSON.parse(stdout);
    return history.map((item: { id: number; revision: string; deployedAt: string }) => ({
      id: String(item.id),
      revision: item.revision?.substring(0, 7) || "unknown",
      deployedAt: item.deployedAt || "unknown",
    }));
  } catch {
    return [];
  }
}

async function rollbackWithArgoCD(
  config: ProjectConfig,
  opts: RollbackOptions
): Promise<void> {
  const appName = `${config.name}-${opts.env}`;
  const spinner = ora(`Rolling back ${config.name} in ${opts.env}...`).start();

  try {
    // Get history
    spinner.text = "Fetching deployment history...";
    const history = await getArgoCDHistory(appName);

    if (history.length === 0) {
      spinner.fail("No deployment history found");
      return;
    }

    // Show history if no revision specified
    if (!opts.revision) {
      spinner.stop();
      console.log(chalk.bold(`\nDeployment history for ${appName}:\n`));
      console.log(chalk.dim("  ID    Revision   Deployed At"));
      console.log(chalk.dim("  ────  ─────────  ────────────────────"));
      for (const item of history.slice(0, 10)) {
        console.log(`  ${item.id.padEnd(4)}  ${item.revision.padEnd(9)}  ${item.deployedAt}`);
      }
      console.log();
      console.log(chalk.dim("To rollback, specify a revision:"));
      console.log(chalk.cyan(`  blissful-infra rollback --env ${opts.env} --revision <ID>`));
      return;
    }

    if (opts.dryRun) {
      spinner.info("Dry run - would rollback to:");
      console.log(chalk.dim(`  argocd app rollback ${appName} ${opts.revision}`));
      return;
    }

    // Perform rollback
    spinner.text = `Rolling back to revision ${opts.revision}...`;
    await execa("argocd", [
      "app",
      "rollback",
      appName,
      opts.revision,
    ], { stdio: "pipe" });

    // Wait for sync
    spinner.text = "Waiting for rollback to complete...";
    await execa("argocd", [
      "app",
      "wait",
      appName,
      "--sync",
      "--timeout",
      "300",
    ], { stdio: "pipe" });

    spinner.succeed(`Rolled back ${config.name} to revision ${opts.revision}`);

    // Get new status
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
  } catch (error) {
    spinner.fail("Rollback failed");
    throw error;
  }
}

async function rollbackWithKubectl(
  config: ProjectConfig,
  opts: RollbackOptions
): Promise<void> {
  const namespace = `${config.name}-${opts.env}`;
  const spinner = ora(`Rolling back ${config.name} in ${opts.env}...`).start();

  try {
    // Get rollout history
    spinner.text = "Fetching rollout history...";
    const { stdout: historyOutput } = await execa("kubectl", [
      "rollout",
      "history",
      `deployment/${config.name}`,
      "-n",
      namespace,
    ], { stdio: "pipe" });

    if (!opts.revision) {
      spinner.stop();
      console.log(chalk.bold(`\nRollout history for ${config.name}:\n`));
      console.log(historyOutput);
      console.log();
      console.log(chalk.dim("To rollback to a specific revision:"));
      console.log(chalk.cyan(`  blissful-infra rollback --env ${opts.env} --revision <number>`));
      console.log();
      console.log(chalk.dim("To rollback to previous revision:"));
      console.log(chalk.cyan(`  blissful-infra rollback --env ${opts.env} --revision 0`));
      return;
    }

    if (opts.dryRun) {
      spinner.info("Dry run - would rollback deployment");
      return;
    }

    // Perform rollback
    spinner.text = `Rolling back to revision ${opts.revision}...`;

    const rollbackArgs = [
      "rollout",
      "undo",
      `deployment/${config.name}`,
      "-n",
      namespace,
    ];

    // Revision 0 means previous, otherwise specify the revision
    if (opts.revision !== "0") {
      rollbackArgs.push(`--to-revision=${opts.revision}`);
    }

    await execa("kubectl", rollbackArgs, { stdio: "pipe" });

    // Wait for rollout
    spinner.text = "Waiting for rollback to complete...";
    await execa("kubectl", [
      "rollout",
      "status",
      `deployment/${config.name}`,
      "-n",
      namespace,
      "--timeout=300s",
    ], { stdio: "pipe" });

    spinner.succeed(`Rolled back ${config.name} in ${opts.env}`);

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
    console.log(chalk.dim("Replicas:"), chalk.green(stdout || "0/0"));
  } catch (error) {
    spinner.fail("Rollback failed");
    throw error;
  }
}

export async function rollbackAction(
  name: string | undefined,
  opts: RollbackOptions
): Promise<void> {
  // Find project directory
  const projectDir = await findProjectDir(name);
  if (!projectDir) {
    if (name) {
      console.error(chalk.red(`Project '${name}' not found.`));
    } else {
      console.error(chalk.red("No blissful-infra.yaml found."));
      console.error(chalk.dim("Run from project directory or specify project name:"));
      console.error(chalk.cyan("  blissful-infra rollback my-app --env staging"));
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
    console.error(chalk.red("Rollback requires kubernetes or cloud target."));
    process.exit(1);
  }

  // Validate environment
  const validEnvs = ["staging", "production"];
  if (!validEnvs.includes(opts.env)) {
    console.error(chalk.red(`Invalid environment for rollback: ${opts.env}`));
    console.error(chalk.dim("Valid environments: staging, production"));
    process.exit(1);
  }

  // Production rollback warning
  if (opts.env === "production" && !opts.dryRun) {
    console.log(chalk.yellow("Warning: Rolling back production!"));
    console.log(chalk.dim("Use --dry-run to preview first."));
    console.log();
  }

  // Check for Argo CD or kubectl
  const hasArgoCD = await checkArgoCDAvailable();
  const hasKubectl = await checkKubectlAvailable();

  if (!hasArgoCD && !hasKubectl) {
    console.error(chalk.red("Neither argocd nor kubectl CLI found."));
    process.exit(1);
  }

  // Rollback using available tool
  if (hasArgoCD) {
    await rollbackWithArgoCD(config, opts);
  } else {
    await rollbackWithKubectl(config, opts);
  }
}

export const rollbackCommand = new Command("rollback")
  .description("Rollback to a previous deployment revision")
  .argument("[name]", "Project name (if running from parent directory)")
  .option("-e, --env <environment>", "Target environment (staging, production)", "staging")
  .option("-r, --revision <id>", "Revision ID to rollback to (omit to see history)")
  .option("--dry-run", "Show what would be rolled back without applying")
  .action(async (name: string | undefined, opts: RollbackOptions) => {
    await rollbackAction(name, opts);
  });
