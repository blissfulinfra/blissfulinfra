import { Command } from "commander";
import chalk from "chalk";
import { readContext } from "../utils/context.js";
import {
  findServiceProject,
  getService,
  readProjectRuntime,
} from "../utils/tenant-registry.js";
import { DeployTargetError, PrereqMissingError, DeployFailedError } from "../deploy/errors.js";

export interface DeployCommandOptions {
  tenant?: string;
  project?: string;
  tag?: string;
  dryRun?: boolean;
}

export interface ServiceCoords {
  tenant: string;
  project: string;
  service: string;
}

/**
 * Resolve tenant/project for a service: flags win, then env, then the `use`
 * context. Project is optional — when absent (or when the context project
 * doesn't own the service) the registry is scanned for the owning project.
 */
async function resolveServiceCoords(
  serviceName: string | undefined,
  opts: { tenant?: string; project?: string },
): Promise<ServiceCoords> {
  if (!serviceName) {
    console.error(chalk.red("Missing service name."));
    console.error(chalk.cyan("  blissful-infra deploy <service>"));
    process.exit(1);
  }
  const ctx = await readContext();
  const tenant = opts.tenant ?? process.env.BLISSFUL_TENANT ?? ctx.tenant;
  if (!tenant) {
    console.error(chalk.red("Missing tenant. Pass --tenant, set BLISSFUL_TENANT, or run:"));
    console.error(chalk.cyan("  blissful-infra use <tenant>"));
    process.exit(1);
  }

  const candidate = opts.project ?? process.env.BLISSFUL_PROJECT ?? ctx.project;
  if (candidate && (await getService(tenant, candidate, serviceName))) {
    return { tenant, project: candidate, service: serviceName };
  }

  const found = await findServiceProject(tenant, serviceName);
  if (!found) {
    console.error(chalk.red(`Service '${serviceName}' not found in tenant '${tenant}'.`));
    console.error(chalk.cyan(`  blissful-infra service add ${serviceName} --type backend`));
    process.exit(1);
  }
  return { tenant, project: found.project, service: serviceName };
}

/**
 * Deploy a service. Routes on the parent project's runtime:
 *
 *   kubernetes → build image, kind-load it into the tenant's cluster, push
 *                rendered manifests to the tenant's gitops repo, ArgoCD syncs,
 *                the Rollout runs its canary steps.
 *   compose    → nothing to deploy; `service up` is the compose lifecycle.
 */
export async function deployAction(
  serviceName: string | undefined,
  opts: DeployCommandOptions,
): Promise<void> {
  const coords = await resolveServiceCoords(serviceName, opts);
  const runtime = await readProjectRuntime(coords.tenant, coords.project);

  try {
    if (runtime === "kubernetes") {
      const { deployKubernetes } = await import("../deploy/kubernetes.js");
      await deployKubernetes(coords, { tag: opts.tag, dryRun: opts.dryRun });
      return;
    }
    throw new DeployTargetError(
      `Project '${coords.project}' runs on the compose runtime — there is nothing to deploy.\n` +
      `Use the service lifecycle instead:\n` +
      `  blissful-infra service up ${coords.service}\n` +
      `Or create a kubernetes-runtime project (kind + ArgoCD + Argo Rollouts):\n` +
      `  blissful-infra project create <name> --runtime kubernetes`,
    );
  } catch (err) {
    if (err instanceof DeployTargetError || err instanceof PrereqMissingError) {
      console.error(chalk.red(err.message));
      process.exit(1);
    }
    if (err instanceof DeployFailedError) {
      console.error(chalk.red(`Deploy failed: ${err.message}`));
      if (err.stderr) console.error(chalk.dim(err.stderr));
      process.exit(err.exitCode ?? 1);
    }
    throw err;
  }
}

export { resolveServiceCoords };

export const deployCommand = new Command("deploy")
  .description("Deploy a service to the project's kubernetes runtime (kind + ArgoCD + Argo Rollouts)")
  .argument("[service]", "Service name (resolves through `use` context)")
  .option("--tenant <tenant>", "Tenant (defaults to context)")
  .option("--project <project>", "Project (defaults to context, falls back to registry scan)")
  .option("--tag <tag>", "Image tag (defaults to the service's git short SHA)")
  .option("--dry-run", "Show what would be deployed without making any changes")
  .action(async (service: string | undefined, opts: DeployCommandOptions) => {
    await deployAction(service, opts);
  });
