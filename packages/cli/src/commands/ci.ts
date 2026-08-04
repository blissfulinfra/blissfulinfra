import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execa } from "execa";
import { resolveServiceCoords } from "./deploy.js";
import { ensureClusterPorts, getServiceDir, getTenant } from "../utils/tenant-registry.js";
import { clusterExists, kubeContext, clusterName } from "../utils/kind.js";
import { getTemplateDir } from "../utils/template.js";
import {
  ensureGiteaReachable,
  ensureSourceRepo,
  getRunnerRegistrationToken,
  listWorkflowRuns,
  sourceWebUrl,
} from "../utils/gitea.js";
import { PrereqMissingError } from "../deploy/errors.js";
import { toExecError } from "../utils/errors.js";

async function requireCluster(tenant: string): Promise<number> {
  if (!(await clusterExists(tenant))) {
    throw new PrereqMissingError(
      "cluster",
      `Tenant '${tenant}' has no kind cluster (CI runs in it).\n  blissful-infra cluster up ${tenant}`,
    );
  }
  const ports = await ensureClusterPorts(tenant);
  return ports.gitea!;
}

/**
 * Register the tenant's Actions runner: fetch a registration token from the
 * running Gitea, render the runner manifest and apply it. Idempotent — a
 * rerun re-registers with a fresh token, which is also the repair path after
 * a cluster recreate.
 */
export async function ciSetupAction(tenantName: string): Promise<void> {
  const giteaPort = await requireCluster(tenantName);

  const spinner = ora("Requesting an Actions runner token from Gitea...").start();
  let token: string;
  try {
    await ensureGiteaReachable(giteaPort);
    token = await getRunnerRegistrationToken(giteaPort);
  } catch (err) {
    spinner.fail("Could not reach Gitea Actions");
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
  spinner.succeed("Runner token issued");

  const manifestSrc = path.join(getTemplateDir("cluster/actions"), "act-runner.yaml");
  const rendered = (await fs.readFile(manifestSrc, "utf-8"))
    .replace(/\{\{RUNNER_TOKEN\}\}/g, token)
    .replace(/\{\{TENANT_NAME\}\}/g, tenantName);
  const tmp = path.join(os.tmpdir(), `blissful-act-runner-${tenantName}.yaml`);
  await fs.writeFile(tmp, rendered, { mode: 0o600 });

  const applySpinner = ora("Deploying the Actions runner...").start();
  try {
    await execa("kubectl", ["--context", kubeContext(tenantName), "apply", "-f", tmp], { stdio: "pipe" });
    // A token change only reaches the pod on restart.
    await execa("kubectl", [
      "--context", kubeContext(tenantName), "-n", "gitea",
      "rollout", "restart", "deployment/act-runner",
    ], { stdio: "pipe", reject: false });
    await execa("kubectl", [
      "--context", kubeContext(tenantName), "-n", "gitea",
      "rollout", "status", "deployment/act-runner", "--timeout=180s",
    ], { stdio: "pipe" });
    applySpinner.succeed("Actions runner is up");
  } catch (err) {
    applySpinner.fail("Runner failed to start");
    const e = toExecError(err);
    if (e.stderr) console.error(chalk.dim(e.stderr.slice(-1500)));
    console.error(chalk.dim(`  kubectl --context ${kubeContext(tenantName)} -n gitea logs deployment/act-runner`));
    process.exit(1);
  } finally {
    await fs.rm(tmp, { force: true });
  }

  console.log();
  console.log(chalk.green.bold("✓ CI is ready."));
  console.log(chalk.dim("  Push a service to run its pipeline: ") + chalk.cyan("blissful-infra ci push <service>"));
  console.log();
}

/**
 * Mirror the service's working directory into its Gitea source repo. The
 * push is what triggers the workflow — same as any git host.
 */
export async function ciPushAction(
  serviceName: string | undefined,
  opts: { tenant?: string; project?: string; message?: string },
): Promise<void> {
  const coords = await resolveServiceCoords(serviceName, opts);
  const giteaPort = await requireCluster(coords.tenant);
  await ensureGiteaReachable(giteaPort);

  const serviceDir = getServiceDir(coords.tenant, coords.project, coords.service);
  const workflow = path.join(serviceDir, ".gitea", "workflows", "ci.yml");
  try {
    await fs.access(workflow);
  } catch {
    console.error(chalk.yellow(`No .gitea/workflows/ci.yml in ${coords.service} — nothing for CI to run.`));
    console.error(chalk.dim("Services scaffolded before ADR-0023 predate the workflow template; add one by hand."));
  }

  const spinner = ora(`Pushing ${coords.service} to Gitea...`).start();
  try {
    const pushUrl = await ensureSourceRepo(coords.tenant, coords.project, coords.service, giteaPort);
    const git = (args: string[]) => execa("git", ["-C", serviceDir, ...args], { stdio: "pipe" });

    // The service dir may already be a git repo (scaffolds often are) — reuse
    // it if so, otherwise make one. Either way we only add our own remote.
    try {
      await fs.access(path.join(serviceDir, ".git"));
    } catch {
      await git(["init", "-b", "main"]);
    }
    await git(["config", "user.email", "ci@blissful-infra.local"]);
    await git(["config", "user.name", "blissful-infra"]);
    await execa("git", ["-C", serviceDir, "remote", "remove", "gitea"], { reject: false, stdio: "pipe" });
    await git(["remote", "add", "gitea", pushUrl]);
    await git(["add", "-A"]);
    const status = await git(["status", "--porcelain"]);
    if (status.stdout.trim()) {
      await git(["commit", "-m", opts.message ?? `ci: ${coords.service} source`]);
    }
    await git(["push", "-u", "--force", "gitea", "HEAD:main"]);
    spinner.succeed(`Pushed — the workflow is running`);
  } catch (err) {
    spinner.fail("Push failed");
    const e = toExecError(err);
    console.error(chalk.red(e.stderr || e.message));
    process.exit(1);
  }

  console.log();
  console.log(chalk.dim("  Watch it: ") + chalk.cyan(`${sourceWebUrl(coords.tenant, coords.project, coords.service, giteaPort)}/actions`));
  console.log(chalk.dim("  Or:       ") + chalk.cyan(`blissful-infra ci status ${coords.service}`));
  console.log();
}

export async function ciStatusAction(
  serviceName: string | undefined,
  opts: { tenant?: string; project?: string },
): Promise<void> {
  const coords = await resolveServiceCoords(serviceName, opts);
  const giteaPort = await requireCluster(coords.tenant);

  const runs = await listWorkflowRuns(coords.tenant, coords.project, coords.service, giteaPort);
  console.log();
  console.log(chalk.bold(`CI: ${coords.tenant}/${coords.project}/${coords.service}`));
  console.log(chalk.dim(`  ${sourceWebUrl(coords.tenant, coords.project, coords.service, giteaPort)}/actions`));
  console.log();
  if (runs.length === 0) {
    console.log(chalk.dim("No workflow runs yet."));
    console.log(chalk.cyan(`  blissful-infra ci push ${coords.service}`) + chalk.dim("   push the source to trigger one"));
    console.log();
    return;
  }
  for (const run of runs.slice(0, 10)) {
    const outcome = run.conclusion ?? run.status;
    const color = outcome === "success" ? chalk.green
      : outcome === "failure" ? chalk.red
      : chalk.yellow;
    console.log(`  #${String(run.run_number).padEnd(4)} ${color(outcome.padEnd(10))} ${chalk.dim(run.name)}`);
  }
  console.log();
}

async function ciRunnerLogsAction(tenantName: string): Promise<void> {
  await requireCluster(tenantName);
  await execa("kubectl", [
    "--context", kubeContext(tenantName), "-n", "gitea",
    "logs", "deployment/act-runner", "--tail=100", "-c", "runner",
  ], { stdio: "inherit", reject: false });
}

export const ciCommand = new Command("ci")
  .description("Gitea Actions CI: GitHub-Actions-compatible pipelines running in the tenant's cluster");

ciCommand
  .command("setup")
  .description("Register the tenant's Actions runner (idempotent; rerun after a cluster recreate)")
  .argument("[tenant]", "Tenant (defaults to context)")
  .action(async (tenantArg?: string) => {
    const { resolveOrExit } = await import("../utils/context.js");
    const { tenant } = await resolveOrExit([tenantArg], ["tenant"]);
    await ciSetupAction(tenant!);
  });

ciCommand
  .command("push")
  .description("Push a service's source to Gitea, triggering its workflow")
  .argument("[service]", "Service name (resolves through `use` context)")
  .option("--tenant <tenant>", "Tenant (defaults to context)")
  .option("--project <project>", "Project (defaults to context)")
  .option("-m, --message <message>", "Commit message")
  .action(async (service: string | undefined, opts: { tenant?: string; project?: string; message?: string }) => {
    await ciPushAction(service, opts);
  });

ciCommand
  .command("status")
  .description("Show recent workflow runs for a service")
  .argument("[service]", "Service name (resolves through `use` context)")
  .option("--tenant <tenant>", "Tenant (defaults to context)")
  .option("--project <project>", "Project (defaults to context)")
  .action(async (service: string | undefined, opts: { tenant?: string; project?: string }) => {
    await ciStatusAction(service, opts);
  });

ciCommand
  .command("logs")
  .description("Tail the Actions runner's logs")
  .argument("[tenant]", "Tenant (defaults to context)")
  .action(async (tenantArg?: string) => {
    const { resolveOrExit } = await import("../utils/context.js");
    const { tenant } = await resolveOrExit([tenantArg], ["tenant"]);
    await ciRunnerLogsAction(tenant!);
  });
