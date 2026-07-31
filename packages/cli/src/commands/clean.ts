import { Command } from "commander";
import chalk from "chalk";
import path from "node:path";
import { execa } from "execa";
import { listTenants, getTenant, getBlissfulHome } from "../utils/tenant-registry.js";
import { tenantRemoveAction } from "./tenant.js";
import { clusterName } from "../utils/kind.js";

const DEMO_TENANT = "demo";

/**
 * Tear a tenant all the way down: kind cluster first (fast and robust even
 * when terraform state is broken — the whole workspace dies with the tenant
 * dir anyway), then the tenant itself (compose down, registry entry, data
 * dir including the cluster workspace and gitops checkout).
 */
async function cleanTenant(name: string): Promise<void> {
  console.log(chalk.bold(`\nCleaning tenant '${name}'`));
  const kindResult = await execa("kind", ["delete", "cluster", "--name", clusterName(name)], {
    reject: false, stdio: "pipe",
  });
  if (kindResult.exitCode === 0) {
    console.log(chalk.dim(`  Cluster '${clusterName(name)}' deleted.`));
  }
  await tenantRemoveAction(name, { skipPrompts: true });
}

async function cleanDashboard(): Promise<void> {
  const composePath = path.join(getBlissfulHome(), "docker-compose.dashboard.yaml");
  const r = await execa("docker", ["compose", "-f", composePath, "down"], { reject: false, stdio: "pipe" });
  if (r.exitCode !== 0) {
    await execa("docker", ["rm", "-f", "blissful-dashboard"], { reject: false, stdio: "pipe" });
  }
  console.log(chalk.dim("  Host dashboard stopped."));
}

export async function cleanAction(
  tenantNames: string[],
  opts: { all?: boolean },
): Promise<void> {
  let targets: string[];
  if (opts.all) {
    targets = (await listTenants()).map(t => t.name);
    if (targets.length === 0) {
      console.log(chalk.dim("No tenants registered — nothing to clean."));
    }
  } else if (tenantNames.length > 0) {
    targets = tenantNames;
  } else {
    targets = (await getTenant(DEMO_TENANT)) ? [DEMO_TENANT] : [];
    if (targets.length === 0) {
      console.log(chalk.dim(`No '${DEMO_TENANT}' tenant to clean. Use \`clean <tenant>\` or \`clean --all\`.`));
      return;
    }
  }

  for (const name of targets) {
    if (!(await getTenant(name))) {
      console.log(chalk.yellow(`Tenant '${name}' not found — skipping.`));
      continue;
    }
    await cleanTenant(name);
  }

  if (opts.all) {
    await cleanDashboard();
  }

  console.log();
  console.log(chalk.green.bold("✓ Clean.") + chalk.dim("  Rebuild any time with ./demo.sh"));
  console.log();
}

export const cleanCommand = new Command("clean")
  .description("Tear down blissful-infra environments (default: the demo tenant; --all: every tenant + dashboard)")
  .argument("[tenants...]", "Tenant names to remove (default: demo)")
  .option("--all", "Remove every registered tenant and stop the host dashboard")
  .action(async (tenants: string[], opts: { all?: boolean }) => {
    await cleanAction(tenants, opts);
  });
