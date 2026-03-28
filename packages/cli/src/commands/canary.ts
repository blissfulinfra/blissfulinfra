import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import path from "node:path";
import { loadConfig, findProjectDir, type ProjectConfig } from "../utils/config.js";
import {
  ensureRolloutsAvailable,
  getRolloutStatus,
  getRolloutDetails,
  promoteRollout,
  abortRollout,
  pauseRollout,
  resumeRollout,
} from "../utils/rollouts.js";

function getNamespace(config: ProjectConfig | null): string {
  return config?.name || "default";
}

function getProjectName(config: ProjectConfig | null, projectDir: string): string {
  return config?.name || path.basename(projectDir);
}

// --- Canary Status ---

async function showCanaryStatus(projectDir: string): Promise<void> {
  const config = await loadConfig(projectDir);
  const projectName = getProjectName(config, projectDir);
  const namespace = getNamespace(config);

  if (!(await ensureRolloutsAvailable())) {
    process.exitCode = 1;
    return;
  }

  console.log(chalk.blue.bold(`\nCanary Status: ${projectName}`));
  console.log(chalk.gray(`Namespace: ${namespace}\n`));

  const status = await getRolloutStatus(projectName, namespace);
  if (!status) {
    console.log(chalk.yellow("No active rollout found."));
    console.log(chalk.gray("Deploy with: blissful-infra deploy --canary"));
    return;
  }

  // Status display
  const statusColor = status.status === "Healthy" ? chalk.green :
    status.status === "Progressing" ? chalk.cyan :
    status.status === "Paused" ? chalk.yellow :
    status.status === "Degraded" ? chalk.red : chalk.gray;

  console.log(chalk.white("Rollout: ") + chalk.white.bold(status.name));
  console.log(chalk.white("Status:  ") + statusColor(status.status));

  if (status.currentWeight > 0 && status.currentWeight < 100) {
    console.log(chalk.white("Weight:  ") + chalk.cyan(`${status.currentWeight}% canary / ${100 - status.currentWeight}% stable`));
  }

  if (status.totalSteps > 0) {
    console.log(chalk.white("Step:    ") + chalk.cyan(`${status.step}/${status.totalSteps}`));
  }

  if (status.message) {
    console.log(chalk.white("Message: ") + chalk.gray(status.message));
  }

  // Detailed rollout info
  console.log();
  const details = await getRolloutDetails(projectName, namespace);
  if (details) {
    console.log(chalk.gray(details));
  }
}

// --- Canary Promote ---

async function promoteCanary(projectDir: string, full: boolean): Promise<void> {
  const config = await loadConfig(projectDir);
  const projectName = getProjectName(config, projectDir);
  const namespace = getNamespace(config);

  if (!(await ensureRolloutsAvailable())) {
    process.exitCode = 1;
    return;
  }

  const spinner = ora(full ? "Fully promoting canary..." : "Promoting to next step...").start();

  const success = await promoteRollout(projectName, namespace, full);
  if (success) {
    spinner.succeed(full ? "Canary fully promoted to 100%" : "Promoted to next step");
  } else {
    spinner.fail("Failed to promote canary");
    process.exitCode = 1;
  }
}

// --- Canary Abort ---

async function abortCanary(projectDir: string): Promise<void> {
  const config = await loadConfig(projectDir);
  const projectName = getProjectName(config, projectDir);
  const namespace = getNamespace(config);

  if (!(await ensureRolloutsAvailable())) {
    process.exitCode = 1;
    return;
  }

  const spinner = ora("Aborting canary rollout...").start();

  const success = await abortRollout(projectName, namespace);
  if (success) {
    spinner.succeed("Canary aborted - traffic shifted to stable");
  } else {
    spinner.fail("Failed to abort canary");
    process.exitCode = 1;
  }
}

// --- Canary Pause ---

async function pauseCanary(projectDir: string): Promise<void> {
  const config = await loadConfig(projectDir);
  const projectName = getProjectName(config, projectDir);
  const namespace = getNamespace(config);

  if (!(await ensureRolloutsAvailable())) {
    process.exitCode = 1;
    return;
  }

  const spinner = ora("Pausing canary rollout...").start();

  const success = await pauseRollout(projectName, namespace);
  if (success) {
    spinner.succeed("Canary paused");
  } else {
    spinner.fail("Failed to pause canary");
    process.exitCode = 1;
  }
}

// --- Canary Resume ---

async function resumeCanary(projectDir: string): Promise<void> {
  const config = await loadConfig(projectDir);
  const projectName = getProjectName(config, projectDir);
  const namespace = getNamespace(config);

  if (!(await ensureRolloutsAvailable())) {
    process.exitCode = 1;
    return;
  }

  const spinner = ora("Resuming canary rollout...").start();

  const success = await resumeRollout(projectName, namespace);
  if (success) {
    spinner.succeed("Canary resumed");
  } else {
    spinner.fail("Failed to resume canary");
    process.exitCode = 1;
  }
}

// --- Canary Test (simulate failure) ---

async function testCanary(
  projectDir: string,
  options: { simulateFailure?: string; value?: string; fullDrill?: boolean }
): Promise<void> {
  const config = await loadConfig(projectDir);
  const projectName = getProjectName(config, projectDir);
  const namespace = getNamespace(config);

  if (!(await ensureRolloutsAvailable())) {
    process.exitCode = 1;
    return;
  }

  console.log(chalk.blue.bold(`\nCanary Rollback Test: ${projectName}\n`));

  if (options.fullDrill) {
    console.log(chalk.white("Running full rollback drill...\n"));

    // Step 1: Check current state
    let spinner = ora("Checking current rollout state...").start();
    const status = await getRolloutStatus(projectName, namespace);
    if (!status) {
      spinner.fail("No active rollout found. Deploy first with: blissful-infra deploy --canary");
      process.exitCode = 1;
      return;
    }
    spinner.succeed(`Current state: ${status.status} (weight: ${status.currentWeight}%)`);

    // Step 2: Trigger abort (simulating failure detection)
    spinner = ora("Simulating failure detection - triggering rollback...").start();
    const aborted = await abortRollout(projectName, namespace);
    if (!aborted) {
      spinner.fail("Failed to trigger rollback");
      process.exitCode = 1;
      return;
    }
    spinner.succeed("Rollback triggered");

    // Step 3: Wait for rollback to complete
    spinner = ora("Waiting for rollback to complete...").start();
    const startTime = Date.now();
    let recovered = false;

    for (let i = 0; i < 60; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const currentStatus = await getRolloutStatus(projectName, namespace);
      if (currentStatus?.status === "Healthy" || currentStatus?.status === "Degraded") {
        recovered = true;
        break;
      }
    }

    const recoveryTime = Date.now() - startTime;

    if (recovered) {
      spinner.succeed(`Rollback completed in ${(recoveryTime / 1000).toFixed(1)}s`);
      console.log();
      console.log(chalk.green.bold("Test Result: PASSED"));
      console.log(chalk.gray("  - Rollback triggered successfully"));
      console.log(chalk.gray("  - Traffic shifted to stable"));
      console.log(chalk.gray(`  - Recovery time: ${(recoveryTime / 1000).toFixed(1)}s`));

      if (recoveryTime < 30000) {
        console.log(chalk.green(`  - Within SLO (< 30s)`));
      } else {
        console.log(chalk.yellow(`  - Exceeds SLO target (< 30s)`));
      }
    } else {
      spinner.fail("Rollback did not complete within timeout");
      console.log();
      console.log(chalk.red.bold("Test Result: FAILED"));
      console.log(chalk.red("  - Rollback did not complete within 120s"));
      process.exitCode = 1;
    }
    return;
  }

  // Single metric simulation
  if (options.simulateFailure) {
    console.log(chalk.yellow(`Simulating failure: ${options.simulateFailure} = ${options.value || "threshold exceeded"}`));
    console.log(chalk.gray("Note: In a real scenario, this would inject bad metrics into the Prometheus query"));
    console.log(chalk.gray("that the AnalysisTemplate monitors, triggering auto-rollback.\n"));

    console.log(chalk.white("To test rollback manually:"));
    console.log(chalk.gray(`  1. Deploy a canary: blissful-infra deploy --canary`));
    console.log(chalk.gray(`  2. Run: blissful-infra canary abort`));
    console.log(chalk.gray(`  3. Or run full drill: blissful-infra canary test --full-drill`));
    return;
  }

  console.log(chalk.gray("Usage:"));
  console.log(chalk.gray("  blissful-infra canary test --full-drill"));
  console.log(chalk.gray("  blissful-infra canary test --simulate-failure error-rate --value 5%"));
}

// --- Main Command ---

export const canaryCommand = new Command("canary")
  .description("Manage canary deployments (Argo Rollouts)");

canaryCommand
  .command("status")
  .argument("[name]", "Project name")
  .description("Show canary rollout status")
  .action(async (name?: string) => {
    const projectDir = await findProjectDir(name);
    if (!projectDir) {
      console.log(chalk.red("Error: Not in a blissful-infra project directory."));
      process.exit(1);
    }
    await showCanaryStatus(projectDir);
  });

canaryCommand
  .command("promote")
  .argument("[name]", "Project name")
  .description("Promote canary to next step (or fully with --full)")
  .option("--full", "Skip remaining steps and promote to 100%")
  .action(async (name: string | undefined, options: { full?: boolean }) => {
    const projectDir = await findProjectDir(name);
    if (!projectDir) {
      console.log(chalk.red("Error: Not in a blissful-infra project directory."));
      process.exit(1);
    }
    await promoteCanary(projectDir, !!options.full);
  });

canaryCommand
  .command("abort")
  .argument("[name]", "Project name")
  .description("Abort canary rollout and rollback to stable")
  .action(async (name?: string) => {
    const projectDir = await findProjectDir(name);
    if (!projectDir) {
      console.log(chalk.red("Error: Not in a blissful-infra project directory."));
      process.exit(1);
    }
    await abortCanary(projectDir);
  });

canaryCommand
  .command("pause")
  .argument("[name]", "Project name")
  .description("Pause canary rollout at current step")
  .action(async (name?: string) => {
    const projectDir = await findProjectDir(name);
    if (!projectDir) {
      console.log(chalk.red("Error: Not in a blissful-infra project directory."));
      process.exit(1);
    }
    await pauseCanary(projectDir);
  });

canaryCommand
  .command("resume")
  .argument("[name]", "Project name")
  .description("Resume paused canary rollout")
  .action(async (name?: string) => {
    const projectDir = await findProjectDir(name);
    if (!projectDir) {
      console.log(chalk.red("Error: Not in a blissful-infra project directory."));
      process.exit(1);
    }
    await resumeCanary(projectDir);
  });

canaryCommand
  .command("test")
  .argument("[name]", "Project name")
  .description("Test canary rollback behavior")
  .option("--simulate-failure <metric>", "Simulate metric failure (error-rate, p95-latency)")
  .option("--value <value>", "Simulated metric value")
  .option("--full-drill", "Run complete rollback drill")
  .action(async (name: string | undefined, options: { simulateFailure?: string; value?: string; fullDrill?: boolean }) => {
    const projectDir = await findProjectDir(name);
    if (!projectDir) {
      console.log(chalk.red("Error: Not in a blissful-infra project directory."));
      process.exit(1);
    }
    await testCanary(projectDir, options);
  });

export async function canaryAction(
  name: string,
  subcommand: string,
  options: Record<string, any> = {}
): Promise<void> {
  const projectDir = await findProjectDir(name);
  if (!projectDir) {
    console.log(chalk.red(`Error: Project '${name}' not found.`));
    return;
  }

  switch (subcommand) {
    case "status":
      await showCanaryStatus(projectDir);
      break;
    case "promote":
      await promoteCanary(projectDir, !!options.full);
      break;
    case "abort":
      await abortCanary(projectDir);
      break;
    case "pause":
      await pauseCanary(projectDir);
      break;
    case "resume":
      await resumeCanary(projectDir);
      break;
    case "test":
      await testCanary(projectDir, options);
      break;
    default:
      console.log(chalk.red(`Unknown canary subcommand: ${subcommand}`));
  }
}
