import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { resolveServiceCoords } from "./deploy.js";
import { readProjectRuntime } from "../utils/tenant-registry.js";
import {
  ensureRolloutsAvailable,
  getRolloutHistory,
  undoRollout,
  getRolloutStatus,
} from "../utils/rollouts.js";

interface RollbackOptions {
  tenant?: string;
  project?: string;
  revision?: string;
  dryRun?: boolean;
}

/**
 * Roll a service back on the kubernetes runtime.
 *
 * The Rollout keeps its own revision history, so `--revision <n>` maps to
 * `kubectl argo rollouts undo --to-revision=<n>`; omitting it shows the
 * history. GitOps-revert rollback (git revert in the tenant's gitops repo so
 * ArgoCD converges back) lands with the deploy pipeline — this command is the
 * immediate, imperative escape hatch.
 */
export async function rollbackAction(
  serviceName: string | undefined,
  opts: RollbackOptions,
): Promise<void> {
  const coords = await resolveServiceCoords(serviceName, opts);
  const runtime = await readProjectRuntime(coords.tenant, coords.project);

  if (runtime !== "kubernetes") {
    console.error(chalk.red(`Project '${coords.project}' runs on the compose runtime — nothing to roll back.`));
    console.error(chalk.dim("Compose services redeploy from source:"));
    console.error(chalk.cyan(`  blissful-infra service up ${coords.service}`));
    process.exit(1);
  }

  if (!(await ensureRolloutsAvailable())) process.exit(1);
  const namespace = coords.project;

  if (!opts.revision) {
    const history = await getRolloutHistory(coords.service, namespace);
    if (!history) {
      console.error(chalk.red(`No rollout history for '${coords.service}' in namespace '${namespace}'.`));
      console.error(chalk.dim("Has the service been deployed?  blissful-infra deploy " + coords.service));
      process.exit(1);
    }
    console.log(chalk.bold(`\nRollout history for ${coords.service} (namespace ${namespace}):\n`));
    console.log(history);
    console.log();
    console.log(chalk.dim("To roll back:"));
    console.log(chalk.cyan(`  blissful-infra rollback ${coords.service} --revision <n>`));
    return;
  }

  if (opts.dryRun) {
    console.log(chalk.dim(`Dry run — would execute: kubectl argo rollouts undo ${coords.service} -n ${namespace} --to-revision=${opts.revision}`));
    return;
  }

  const spinner = ora(`Rolling back ${coords.service} to revision ${opts.revision}...`).start();
  const ok = await undoRollout(coords.service, namespace, opts.revision === "0" ? undefined : opts.revision);
  if (!ok) {
    spinner.fail("Rollback failed");
    process.exit(1);
  }
  spinner.succeed(`Rolled back ${coords.service} to revision ${opts.revision}`);
  const status = await getRolloutStatus(coords.service, namespace);
  if (status) {
    console.log(chalk.dim("Status:"), status.status);
  }
  console.log(chalk.yellow("\nNote: this is an imperative rollback. If ArgoCD auto-sync is on, the"));
  console.log(chalk.yellow("gitops repo still points at the rolled-back-from tag and will re-sync it."));
}

export const rollbackCommand = new Command("rollback")
  .description("Roll a kubernetes-runtime service back to a previous Rollout revision")
  .argument("[service]", "Service name (resolves through `use` context)")
  .option("--tenant <tenant>", "Tenant (defaults to context)")
  .option("--project <project>", "Project (defaults to context, falls back to registry scan)")
  .option("-r, --revision <id>", "Revision to roll back to (omit to see history)")
  .option("--dry-run", "Show what would be rolled back without applying")
  .action(async (service: string | undefined, opts: RollbackOptions) => {
    await rollbackAction(service, opts);
  });
