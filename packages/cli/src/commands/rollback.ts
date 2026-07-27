import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { resolveServiceCoords } from "./deploy.js";
import { readProjectRuntime, ensureClusterPorts } from "../utils/tenant-registry.js";
import { kubeContext } from "../utils/kind.js";
import { ensureGiteaReachable, ensureOrgRepo } from "../utils/gitea.js";
import { ensureCheckout, revertLastDeploy } from "../utils/gitops.js";
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
  immediate?: boolean;
  dryRun?: boolean;
}

/**
 * Roll a kubernetes-runtime service back.
 *
 * Default path is GitOps: revert the last deploy commit for the service in
 * the tenant's gitops repo and push — ArgoCD (auto-sync + selfHeal) converges
 * the cluster back to the previous state. This is the only rollback that
 * *sticks* while selfHeal is on.
 *
 * `--immediate` is the imperative escape hatch: `kubectl argo rollouts undo`
 * shifts traffic now, but ArgoCD will re-sync the repo state afterwards —
 * use it to stop the bleeding, then land the git revert.
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

  if (opts.immediate) {
    await immediateRollback(coords.service, coords.project, kubeContext(coords.tenant), opts);
    return;
  }

  if (opts.dryRun) {
    console.log(chalk.dim(
      `Dry run — would git-revert the last deploy commit for projects/${coords.project}/${coords.service} ` +
      `in the '${coords.tenant}-gitops' repo and push (ArgoCD syncs the cluster back).`,
    ));
    return;
  }

  const spinner = ora(`Reverting last deploy of ${coords.project}/${coords.service} in the gitops repo...`).start();
  try {
    const ports = await ensureClusterPorts(coords.tenant);
    await ensureGiteaReachable(ports.gitea!);
    const { pushUrl } = await ensureOrgRepo(coords.tenant, ports.gitea!);
    await ensureCheckout(coords.tenant, pushUrl);
    const reverted = await revertLastDeploy(coords);
    if (!reverted) {
      spinner.fail(`No deploy commits found for ${coords.project}/${coords.service} — nothing to roll back.`);
      process.exit(1);
    }
    spinner.succeed(`Reverted deploy commit ${reverted.slice(0, 7)} and pushed — ArgoCD is syncing back.`);
    console.log(chalk.dim("  Watch: ") + chalk.cyan(`blissful-infra canary status ${coords.service}`));
  } catch (err) {
    spinner.fail("GitOps rollback failed");
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
}

async function immediateRollback(service: string, namespace: string, context: string, opts: RollbackOptions): Promise<void> {
  if (!(await ensureRolloutsAvailable())) process.exit(1);

  if (!opts.revision) {
    const history = await getRolloutHistory(service, namespace, context);
    if (!history) {
      console.error(chalk.red(`No rollout history for '${service}' in namespace '${namespace}'.`));
      process.exit(1);
    }
    console.log(chalk.bold(`\nRollout history for ${service} (namespace ${namespace}):\n`));
    console.log(history);
    console.log(chalk.dim("\nTo roll back immediately:"));
    console.log(chalk.cyan(`  blissful-infra rollback ${service} --immediate --revision <n>`));
    return;
  }

  if (opts.dryRun) {
    console.log(chalk.dim(`Dry run — would execute: kubectl argo rollouts undo ${service} -n ${namespace} --to-revision=${opts.revision}`));
    return;
  }

  const spinner = ora(`Rolling back ${service} to revision ${opts.revision}...`).start();
  const ok = await undoRollout(service, namespace, opts.revision === "0" ? undefined : opts.revision, context);
  if (!ok) {
    spinner.fail("Rollback failed");
    process.exit(1);
  }
  spinner.succeed(`Rolled back ${service} to revision ${opts.revision}`);
  const status = await getRolloutStatus(service, namespace, context);
  if (status) {
    console.log(chalk.dim("Status:"), status.status);
  }
  console.log(chalk.yellow("\nNote: ArgoCD selfHeal will re-sync the gitops state. Land the durable"));
  console.log(chalk.yellow(`rollback too:  blissful-infra rollback ${service}`));
}

export const rollbackCommand = new Command("rollback")
  .description("Roll a kubernetes-runtime service back (git revert in the gitops repo; ArgoCD syncs)")
  .argument("[service]", "Service name (resolves through `use` context)")
  .option("--tenant <tenant>", "Tenant (defaults to context)")
  .option("--project <project>", "Project (defaults to context, falls back to registry scan)")
  .option("--immediate", "Imperative kubectl-argo-rollouts undo (does not survive ArgoCD selfHeal)")
  .option("-r, --revision <id>", "Rollout revision for --immediate (omit to see history)")
  .option("--dry-run", "Show what would be rolled back without applying")
  .action(async (service: string | undefined, opts: RollbackOptions) => {
    await rollbackAction(service, opts);
  });
