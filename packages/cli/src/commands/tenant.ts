import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import {
  TenantConfigSchema,
  type TenantConfig,
} from "@blissful-infra/shared";
import {
  registerTenant,
  unregisterTenant,
  listTenants,
  getTenant,
  getTenantDir,
} from "../utils/tenant-registry.js";
import { writeTenantCompose, projectComposeIncludePath } from "../utils/tenant-compose.js";
import { ensureJenkinsImage } from "../utils/infra-images.js";
import { toExecError } from "../utils/errors.js";
import { resolveOrExit, writeContext } from "../utils/context.js";

// ─── tenant create ───────────────────────────────────────────────────────────

interface TenantCreateOptions {
  skipPrompts?: boolean;
  jenkins?: boolean;
  prometheus?: boolean;
  grafana?: boolean;
  tempo?: boolean;
  loki?: boolean;
  skipProjectPrompt?: boolean;
}

export async function tenantCreateAction(name: string, opts: TenantCreateOptions): Promise<void> {
  console.log();
  console.log(chalk.bold("blissful-infra tenant create"), chalk.cyan(name));
  console.log();

  if (!/^[a-z0-9-]+$/.test(name)) {
    console.error(chalk.red("Tenant name must be lowercase alphanumeric with hyphens"));
    process.exit(1);
  }

  const existing = await getTenant(name);
  if (existing) {
    console.error(chalk.red(`Tenant '${name}' already exists.`));
    console.error(chalk.dim("Use a different name, or `blissful-infra tenant remove " + name + "` first."));
    process.exit(1);
  }

  const useDefaults = opts.skipPrompts || !process.stdout.isTTY;
  let config: TenantConfig;

  if (useDefaults) {
    config = TenantConfigSchema.parse({
      type: "tenant",
      name,
      infrastructure: {
        jenkins: opts.jenkins !== false,
        observability: {
          prometheus: opts.prometheus !== false,
          grafana:    opts.grafana    !== false,
          tempo:      opts.tempo      !== false,
          loki:       opts.loki       !== false,
        },
      },
      projects: [],
    });
  } else {
    const answers = await inquirer.prompt([
      {
        type: "checkbox",
        name: "components",
        message: "Tenant-level infrastructure (Kafka/Postgres live at the project level)",
        choices: [
          { name: "Jenkins (CI/CD)",            value: "jenkins",    checked: opts.jenkins    !== false },
          { name: "Prometheus (metrics)",       value: "prometheus", checked: opts.prometheus !== false },
          { name: "Grafana (dashboards)",       value: "grafana",    checked: opts.grafana    !== false },
          { name: "Tempo (tracing)",            value: "tempo",      checked: opts.tempo      !== false },
          { name: "Loki + Promtail (logs)",     value: "loki",       checked: opts.loki       !== false },
        ],
      },
    ] as never) as { components: string[] };

    config = TenantConfigSchema.parse({
      type: "tenant",
      name,
      infrastructure: {
        jenkins: answers.components.includes("jenkins"),
        observability: {
          prometheus: answers.components.includes("prometheus"),
          grafana:    answers.components.includes("grafana"),
          tempo:      answers.components.includes("tempo"),
          loki:       answers.components.includes("loki"),
        },
      },
      projects: [],
    });
  }

  const spinner = ora("Allocating tenant port block...").start();
  let registryEntry;
  try {
    registryEntry = await registerTenant(name);
  } catch (err) {
    spinner.fail("Could not allocate tenant slot");
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
  spinner.succeed(`Tenant block ${registryEntry.portBlock.blockIndex} allocated`);

  const dirSpinner = ora("Creating tenant directory...").start();
  const tenantDir = getTenantDir(name);
  await fs.mkdir(tenantDir, { recursive: true });
  await fs.mkdir(path.join(tenantDir, "projects"), { recursive: true });
  await fs.writeFile(
    path.join(tenantDir, "tenant.yaml"),
    yaml.dump(config, { lineWidth: 120 }),
  );
  // Generate the tenant compose + observability configs. No project includes
  // yet — they get added as projects are created.
  await writeTenantCompose(config, registryEntry.portBlock, []);
  dirSpinner.succeed(`Tenant scaffolded at ${tenantDir}`);

  console.log();
  console.log(chalk.green.bold(`✓ Tenant '${name}' created.`));
  console.log();
  console.log(chalk.dim("Port block ") + chalk.cyan(`#${registryEntry.portBlock.blockIndex}`));
  console.log(chalk.dim("  Dashboard:  ") + chalk.cyan(`http://localhost:${registryEntry.portBlock.dashboard}`));
  if (config.infrastructure.jenkins) {
    console.log(chalk.dim("  Jenkins:    ") + chalk.cyan(`http://localhost:${registryEntry.portBlock.jenkins}`));
  }
  if (config.infrastructure.observability.grafana) {
    console.log(chalk.dim("  Grafana:    ") + chalk.cyan(`http://localhost:${registryEntry.portBlock.grafana}`));
  }
  // Convenience: select this tenant as the current context so follow-up
  // commands don't need to retype the name.
  await writeContext({ tenant: name });

  console.log();
  console.log(chalk.dim("Tenant is scaffolded and selected as current context."));
  console.log(chalk.dim("Next:"));
  console.log(chalk.cyan(`  blissful-infra project create <project>`) + chalk.dim("   uses tenant from context"));
  console.log(chalk.cyan(`  blissful-infra tenant up`) + chalk.dim("                  start containers"));
  console.log();
}

// ─── tenant list ─────────────────────────────────────────────────────────────

async function tenantListAction(): Promise<void> {
  const tenants = await listTenants();
  if (tenants.length === 0) {
    console.log(chalk.dim("No tenants found."));
    console.log(chalk.dim("Create one with: blissful-infra tenant create <name>"));
    return;
  }
  console.log();
  console.log(chalk.bold("Tenants:"));
  console.log();
  for (const t of tenants) {
    const projectCount = t.projects.length;
    const serviceCount = t.projects.reduce((sum, p) => sum + p.services.length, 0);
    console.log(
      `  ${chalk.bold(t.name).padEnd(24)} ` +
      chalk.dim(`#${t.portBlock.blockIndex}  `) +
      chalk.dim(`${projectCount} project${projectCount === 1 ? "" : "s"}, ${serviceCount} service${serviceCount === 1 ? "" : "s"}`),
    );
  }
  console.log();
}

// ─── tenant status ───────────────────────────────────────────────────────────

async function tenantStatusAction(name: string): Promise<void> {
  const t = await getTenant(name);
  if (!t) {
    console.error(chalk.red(`Tenant '${name}' not found.`));
    process.exit(1);
  }
  console.log();
  console.log(chalk.bold(`Tenant: ${name}`));
  console.log(chalk.dim(`  Block #${t.portBlock.blockIndex}`));
  console.log(chalk.dim(`  Dashboard:  http://localhost:${t.portBlock.dashboard}`));
  console.log(chalk.dim(`  Jenkins:    http://localhost:${t.portBlock.jenkins}`));
  console.log(chalk.dim(`  Grafana:    http://localhost:${t.portBlock.grafana}`));
  console.log();
  if (t.projects.length === 0) {
    console.log(chalk.dim("No projects yet."));
    console.log(chalk.cyan(`  blissful-infra project create ${name} <project>`));
  } else {
    console.log(chalk.bold("Projects:"));
    for (const p of t.projects) {
      console.log(`  ${chalk.bold(p.name)}  ${chalk.dim(`(${p.services.length} services)`)}`);
      for (const s of p.services) {
        const port = s.ports.http ? ` :${s.ports.http}` : "";
        console.log(`    ${chalk.dim("·")} ${s.name} ${chalk.dim(`[${s.type}]${port}`)}`);
      }
    }
  }
  console.log();
}

// ─── tenant remove ───────────────────────────────────────────────────────────

async function tenantRemoveAction(name: string, opts: { skipPrompts?: boolean }): Promise<void> {
  const t = await getTenant(name);
  if (!t) {
    console.error(chalk.red(`Tenant '${name}' not found.`));
    process.exit(1);
  }

  if (!opts.skipPrompts && process.stdout.isTTY) {
    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: `Remove tenant '${name}' and ALL its projects/services (this deletes ${t.projects.length} project(s))?`,
        default: false,
      },
    ] as never) as { confirm: boolean };
    if (!confirm) {
      console.log(chalk.dim("Aborted."));
      return;
    }
  }

  // Best-effort docker compose down before deleting — surfaces issues but
  // doesn't block removal if the compose file is broken.
  const tenantDir = getTenantDir(name);
  try {
    await execa("docker", [
      "compose", "-f", "docker-compose.tenant.yaml", "down", "-v",
    ], { cwd: tenantDir, stdio: "pipe" });
  } catch {
    // ignore — could be that containers were already down or docker is off
  }
  await fs.rm(tenantDir, { recursive: true, force: true });
  await unregisterTenant(name);
  console.log(chalk.green(`✓ Tenant '${name}' removed.`));
}

// ─── tenant up / down ───────────────────────────────────────────────────────

export async function tenantUpAction(name: string): Promise<void> {
  const t = await getTenant(name);
  if (!t) {
    console.error(chalk.red(`Tenant '${name}' not found.`));
    process.exit(1);
  }

  // Dashboard image is no longer in the tenant compose (host-level control
  // plane lives separately). Only Jenkins still needs a one-time local build.
  const tenantYamlPath = path.join(getTenantDir(name), "tenant.yaml");
  try {
    const cfg = TenantConfigSchema.parse(yaml.load(await fs.readFile(tenantYamlPath, "utf-8")));
    if (cfg.infrastructure.jenkins) {
      await ensureJenkinsImage();
    }
  } catch {
    // tenant.yaml missing — registry is the source of truth and tenantDir
    // existence was already confirmed by getTenant; press on.
  }

  const tenantDir = getTenantDir(name);
  console.log(chalk.dim(`Starting tenant '${name}'...`));
  try {
    await execa("docker", [
      "compose", "-f", "docker-compose.tenant.yaml", "up", "-d", "--build",
    ], { cwd: tenantDir, stdio: "inherit" });
    console.log(chalk.green(`✓ Tenant '${name}' is up.`));
    console.log(chalk.dim(`  Dashboard: http://localhost:${t.portBlock.dashboard}`));
  } catch (err) {
    const e = toExecError(err);
    if (e.stderr) console.error(chalk.red(e.stderr));
    process.exit(1);
  }
}

async function tenantDownAction(name: string): Promise<void> {
  const t = await getTenant(name);
  if (!t) {
    console.error(chalk.red(`Tenant '${name}' not found.`));
    process.exit(1);
  }
  const tenantDir = getTenantDir(name);
  console.log(chalk.dim(`Stopping tenant '${name}'...`));
  try {
    await execa("docker", [
      "compose", "-f", "docker-compose.tenant.yaml", "down",
    ], { cwd: tenantDir, stdio: "inherit" });
    console.log(chalk.green(`✓ Tenant '${name}' is down.`));
  } catch (err) {
    const e = toExecError(err);
    if (e.stderr) console.error(chalk.red(e.stderr));
    process.exit(1);
  }
}

// ─── command registration ───────────────────────────────────────────────────

export const tenantCommand = new Command("tenant")
  .description("Manage tenants (the top level of the hierarchy — owns dashboard, jenkins, observability)");

tenantCommand
  .command("create")
  .description("Create a new tenant")
  .argument("<name>", "Tenant name (lowercase alphanumeric with hyphens)")
  .option("-y, --skip-prompts", "Skip prompts, use defaults")
  .option("--no-jenkins", "Disable Jenkins")
  .option("--no-prometheus", "Disable Prometheus")
  .option("--no-grafana", "Disable Grafana")
  .option("--no-tempo", "Disable Tempo")
  .option("--no-loki", "Disable Loki")
  .action(tenantCreateAction);

tenantCommand
  .command("list")
  .description("List all tenants")
  .action(tenantListAction);

tenantCommand
  .command("status")
  .description("Show tenant detail (projects, services, ports)")
  .argument("[name]", "Tenant name (uses current context if omitted)")
  .action(async (name?: string) => {
    const { tenant } = await resolveOrExit([name], ["tenant"]);
    await tenantStatusAction(tenant!);
  });

tenantCommand
  .command("remove")
  .description("Remove a tenant and ALL its projects + services")
  .argument("[name]", "Tenant name (uses current context if omitted)")
  .option("-y, --skip-prompts", "Skip confirmation")
  .action(async (name: string | undefined, opts: { skipPrompts?: boolean }) => {
    const { tenant } = await resolveOrExit([name], ["tenant"]);
    await tenantRemoveAction(tenant!, opts);
  });

tenantCommand
  .command("up")
  .description("Start a tenant's infrastructure")
  .argument("[name]", "Tenant name (uses current context if omitted)")
  .action(async (name?: string) => {
    const { tenant } = await resolveOrExit([name], ["tenant"]);
    await tenantUpAction(tenant!);
  });

tenantCommand
  .command("down")
  .description("Stop a tenant's infrastructure")
  .argument("[name]", "Tenant name (uses current context if omitted)")
  .action(async (name?: string) => {
    const { tenant } = await resolveOrExit([name], ["tenant"]);
    await tenantDownAction(tenant!);
  });
