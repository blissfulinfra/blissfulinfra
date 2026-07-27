import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { resolveServiceCoords, type ServiceCoords } from "./deploy.js";
import {
  ensureRolloutsAvailable,
  getRolloutStatus,
  getRolloutDetails,
  promoteRollout,
  abortRollout,
  pauseRollout,
  resumeRollout,
} from "../utils/rollouts.js";

// Namespace convention (ADR-0017 k8s runtime): one namespace per project,
// one Rollout per service, both named after their registry entries.

// --- Canary Status ---

async function showCanaryStatus(coords: ServiceCoords): Promise<void> {
  if (!(await ensureRolloutsAvailable())) {
    process.exitCode = 1;
    return;
  }

  console.log(chalk.blue.bold(`\nCanary Status: ${coords.service}`));
  console.log(chalk.gray(`Tenant: ${coords.tenant}  Namespace: ${coords.project}\n`));

  const status = await getRolloutStatus(coords.service, coords.project);
  if (!status) {
    console.log(chalk.yellow("No active rollout found."));
    console.log(chalk.gray(`Deploy with: blissful-infra deploy ${coords.service}`));
    return;
  }

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

  console.log();
  const details = await getRolloutDetails(coords.service, coords.project);
  if (details) {
    console.log(chalk.gray(details));
  }
}

// --- Mutations (promote / abort / pause / resume) ---

async function runCanaryMutation(
  coords: ServiceCoords,
  mutate: (name: string, namespace: string) => Promise<boolean>,
  progress: string,
  success: string,
  failure: string,
): Promise<void> {
  if (!(await ensureRolloutsAvailable())) {
    process.exitCode = 1;
    return;
  }
  const spinner = ora(progress).start();
  const ok = await mutate(coords.service, coords.project);
  if (ok) {
    spinner.succeed(success);
  } else {
    spinner.fail(failure);
    process.exitCode = 1;
  }
}

const promoteCanary = (coords: ServiceCoords, full: boolean) =>
  runCanaryMutation(
    coords,
    (n, ns) => promoteRollout(n, ns, full),
    full ? "Fully promoting canary..." : "Promoting to next step...",
    full ? "Canary fully promoted to 100%" : "Promoted to next step",
    "Failed to promote canary",
  );

const abortCanary = (coords: ServiceCoords) =>
  runCanaryMutation(coords, abortRollout,
    "Aborting canary rollout...", "Canary aborted - traffic shifted to stable", "Failed to abort canary");

const pauseCanary = (coords: ServiceCoords) =>
  runCanaryMutation(coords, pauseRollout,
    "Pausing canary rollout...", "Canary paused", "Failed to pause canary");

const resumeCanary = (coords: ServiceCoords) =>
  runCanaryMutation(coords, resumeRollout,
    "Resuming canary rollout...", "Canary resumed", "Failed to resume canary");

// --- Canary Test (rollback drill) ---

async function testCanary(
  coords: ServiceCoords,
  options: { simulateFailure?: string; value?: string; fullDrill?: boolean },
): Promise<void> {
  if (!(await ensureRolloutsAvailable())) {
    process.exitCode = 1;
    return;
  }

  console.log(chalk.blue.bold(`\nCanary Rollback Test: ${coords.service}\n`));

  if (options.fullDrill) {
    console.log(chalk.white("Running full rollback drill...\n"));

    let spinner = ora("Checking current rollout state...").start();
    const status = await getRolloutStatus(coords.service, coords.project);
    if (!status) {
      spinner.fail(`No active rollout found. Deploy first with: blissful-infra deploy ${coords.service}`);
      process.exitCode = 1;
      return;
    }
    spinner.succeed(`Current state: ${status.status} (weight: ${status.currentWeight}%)`);

    spinner = ora("Simulating failure detection - triggering rollback...").start();
    const aborted = await abortRollout(coords.service, coords.project);
    if (!aborted) {
      spinner.fail("Failed to trigger rollback");
      process.exitCode = 1;
      return;
    }
    spinner.succeed("Rollback triggered");

    spinner = ora("Waiting for rollback to complete...").start();
    const startTime = Date.now();
    let recovered = false;

    for (let i = 0; i < 60; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const currentStatus = await getRolloutStatus(coords.service, coords.project);
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

  if (options.simulateFailure) {
    console.log(chalk.yellow(`Simulating failure: ${options.simulateFailure} = ${options.value || "threshold exceeded"}`));
    console.log(chalk.gray("Note: In a real scenario, this would inject bad metrics into the Prometheus query"));
    console.log(chalk.gray("that the AnalysisTemplate monitors, triggering auto-rollback.\n"));

    console.log(chalk.white("To test rollback manually:"));
    console.log(chalk.gray(`  1. Deploy: blissful-infra deploy ${coords.service}`));
    console.log(chalk.gray(`  2. Run: blissful-infra canary abort ${coords.service}`));
    console.log(chalk.gray(`  3. Or run full drill: blissful-infra canary test ${coords.service} --full-drill`));
    return;
  }

  console.log(chalk.gray("Usage:"));
  console.log(chalk.gray("  blissful-infra canary test <service> --full-drill"));
  console.log(chalk.gray("  blissful-infra canary test <service> --simulate-failure error-rate --value 5%"));
}

// --- Main Command ---

interface CanaryCliOptions {
  tenant?: string;
  project?: string;
}

function canarySubcommand(name: string, description: string) {
  return canaryCommand
    .command(name)
    .argument("[service]", "Service name (resolves through `use` context)")
    .option("--tenant <tenant>", "Tenant (defaults to context)")
    .option("--project <project>", "Project (defaults to context, falls back to registry scan)")
    .description(description);
}

export const canaryCommand = new Command("canary")
  .description("Manage canary deployments (Argo Rollouts on the tenant's kind cluster)");

canarySubcommand("status", "Show canary rollout status")
  .action(async (service: string | undefined, opts: CanaryCliOptions) => {
    await showCanaryStatus(await resolveServiceCoords(service, opts));
  });

canarySubcommand("promote", "Promote canary to next step (or fully with --full)")
  .option("--full", "Skip remaining steps and promote to 100%")
  .action(async (service: string | undefined, opts: CanaryCliOptions & { full?: boolean }) => {
    await promoteCanary(await resolveServiceCoords(service, opts), !!opts.full);
  });

canarySubcommand("abort", "Abort canary rollout and rollback to stable")
  .action(async (service: string | undefined, opts: CanaryCliOptions) => {
    await abortCanary(await resolveServiceCoords(service, opts));
  });

canarySubcommand("pause", "Pause canary rollout at current step")
  .action(async (service: string | undefined, opts: CanaryCliOptions) => {
    await pauseCanary(await resolveServiceCoords(service, opts));
  });

canarySubcommand("resume", "Resume paused canary rollout")
  .action(async (service: string | undefined, opts: CanaryCliOptions) => {
    await resumeCanary(await resolveServiceCoords(service, opts));
  });

canarySubcommand("test", "Test canary rollback behavior")
  .option("--simulate-failure <metric>", "Simulate metric failure (error-rate, p95-latency)")
  .option("--value <value>", "Simulated metric value")
  .option("--full-drill", "Run complete rollback drill")
  .action(async (
    service: string | undefined,
    opts: CanaryCliOptions & { simulateFailure?: string; value?: string; fullDrill?: boolean },
  ) => {
    await testCanary(await resolveServiceCoords(service, opts), opts);
  });

/** Programmatic entry used by the API server's canary endpoints. */
export async function canaryAction(
  coords: ServiceCoords,
  subcommand: string,
  options: Record<string, unknown> = {},
): Promise<void> {
  switch (subcommand) {
    case "status":
      await showCanaryStatus(coords);
      break;
    case "promote":
      await promoteCanary(coords, !!options.full);
      break;
    case "abort":
      await abortCanary(coords);
      break;
    case "pause":
      await pauseCanary(coords);
      break;
    case "resume":
      await resumeCanary(coords);
      break;
    case "test":
      await testCanary(coords, options as { simulateFailure?: string; value?: string; fullDrill?: boolean });
      break;
    default:
      console.log(chalk.red(`Unknown canary subcommand: ${subcommand}`));
  }
}
