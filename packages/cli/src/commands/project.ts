import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import {
  ProjectConfigSchema,
  TenantConfigSchema,
  type ProjectConfig,
} from "@blissful-infra/shared";
import {
  registerProject,
  unregisterProject,
  getTenant,
  getProject,
  getTenantDir,
  getProjectDir,
} from "../utils/tenant-registry.js";
import { writeProjectCompose, serviceComposeIncludePath } from "../utils/project-compose.js";
import { writeTenantCompose, projectComposeIncludePath } from "../utils/tenant-compose.js";
import { toExecError } from "../utils/errors.js";
import { resolveOrExit, writeContext } from "../utils/context.js";

// ─── project create ──────────────────────────────────────────────────────────

interface ProjectCreateOptions {
  skipPrompts?: boolean;
  kafka?: boolean;
  postgres?: boolean;
  redis?: boolean;
  gateway?: boolean;
}

export async function projectCreateAction(
  tenantName: string,
  projectName: string,
  opts: ProjectCreateOptions,
): Promise<void> {
  console.log();
  console.log(chalk.bold("blissful-infra project create"), chalk.cyan(`${tenantName}/${projectName}`));
  console.log();

  if (!/^[a-z0-9-]+$/.test(projectName)) {
    console.error(chalk.red("Project name must be lowercase alphanumeric with hyphens"));
    process.exit(1);
  }

  const tenant = await getTenant(tenantName);
  if (!tenant) {
    console.error(chalk.red(`Tenant '${tenantName}' not found.`));
    console.error(chalk.cyan(`  blissful-infra tenant create ${tenantName}`));
    process.exit(1);
  }

  const existing = await getProject(tenantName, projectName);
  if (existing) {
    console.error(chalk.red(`Project '${projectName}' already exists in tenant '${tenantName}'.`));
    process.exit(1);
  }

  const useDefaults = opts.skipPrompts || !process.stdout.isTTY;
  let config: ProjectConfig;

  if (useDefaults) {
    config = ProjectConfigSchema.parse({
      type: "project",
      name: projectName,
      tenant: tenantName,
      infrastructure: {
        kafka:    opts.kafka    !== false,
        postgres: opts.postgres !== false,
        redis:    opts.redis    !== false,
        gateway:  opts.gateway  !== false,
      },
      services: [],
    });
  } else {
    const answers = await inquirer.prompt([
      {
        type: "checkbox",
        name: "components",
        message: "Project-level infrastructure (each service inside the project shares these)",
        choices: [
          { name: "Kafka (event bus, topics namespaced by project)", value: "kafka",    checked: opts.kafka    !== false },
          { name: "Postgres (one instance, per-service schemas)",    value: "postgres", checked: opts.postgres !== false },
          { name: "Redis (shared cache + pub/sub)",                  value: "redis",    checked: opts.redis    !== false },
          { name: "API Gateway (single ingress)",                    value: "gateway",  checked: opts.gateway  !== false },
        ],
      },
    ] as never) as { components: string[] };

    config = ProjectConfigSchema.parse({
      type: "project",
      name: projectName,
      tenant: tenantName,
      infrastructure: {
        kafka:    answers.components.includes("kafka"),
        postgres: answers.components.includes("postgres"),
        redis:    answers.components.includes("redis"),
        gateway:  answers.components.includes("gateway"),
      },
      services: [],
    });
  }

  const spinner = ora("Allocating project port block...").start();
  let projectEntry;
  try {
    projectEntry = await registerProject(tenantName, projectName);
  } catch (err) {
    spinner.fail("Could not allocate project slot");
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
  spinner.succeed(`Project block ${projectEntry.portBlock.projectIndex} allocated`);

  // Create the project directory tree and write project.yaml
  const dirSpinner = ora("Creating project directory...").start();
  const projectDir = getProjectDir(tenantName, projectName);
  await fs.mkdir(projectDir, { recursive: true });
  await fs.mkdir(path.join(projectDir, "services"), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, "project.yaml"),
    yaml.dump(config, { lineWidth: 120 }),
  );

  // Generate the project compose + supporting config (postgres init, Caddyfile).
  // No services yet — service add adds includes incrementally.
  await writeProjectCompose(tenantName, projectName, config, projectEntry.portBlock, [], []);
  dirSpinner.succeed(`Project scaffolded at ${projectDir}`);

  // Update parent tenant.yaml + regenerate tenant compose so it includes this project.
  await updateTenantProjectsList(tenantName, projectName);
  await regenerateTenantCompose(tenantName);

  // Select this project in the current context so `service add` etc. don't
  // need to retype the tenant + project path.
  await writeContext({ tenant: tenantName, project: projectName });

  console.log();
  console.log(chalk.green.bold(`✓ Project '${projectName}' created.`));
  console.log();
  console.log(chalk.dim("Ports"));
  if (config.infrastructure.kafka) {
    console.log(chalk.dim("  Kafka:    ") + chalk.cyan(`localhost:${projectEntry.portBlock.kafka}`));
  }
  if (config.infrastructure.postgres) {
    console.log(chalk.dim("  Postgres: ") + chalk.cyan(`localhost:${projectEntry.portBlock.postgres}`));
  }
  if (config.infrastructure.redis) {
    console.log(chalk.dim("  Redis:    ") + chalk.cyan(`localhost:${projectEntry.portBlock.redis}`));
  }
  if (config.infrastructure.gateway) {
    console.log(chalk.dim("  Gateway:  ") + chalk.cyan(`http://localhost:${projectEntry.portBlock.gateway}`));
  }
  console.log();
  console.log(chalk.dim("Add a service:"));
  console.log(chalk.cyan(`  blissful-infra service add ${tenantName} ${projectName} <service> --type backend`));
  console.log();
}

async function updateTenantProjectsList(tenantName: string, projectName: string): Promise<void> {
  const yamlPath = path.join(getTenantDir(tenantName), "tenant.yaml");
  const raw = await fs.readFile(yamlPath, "utf-8");
  const parsed = TenantConfigSchema.parse(yaml.load(raw));
  if (!parsed.projects.find(p => p.name === projectName)) {
    parsed.projects.push({ name: projectName, path: `projects/${projectName}` });
    await fs.writeFile(yamlPath, yaml.dump(parsed, { lineWidth: 120 }));
  }
}

/** Regenerate the tenant's docker-compose.tenant.yaml so it `include:`s every
 *  currently-registered project. Called whenever projects are added/removed.
 *  Also rebuilds the Grafana overview dashboard with only the panels that
 *  match the actually-enabled infrastructure across all projects. */
async function regenerateTenantCompose(tenantName: string): Promise<void> {
  const tenant = await getTenant(tenantName);
  if (!tenant) return;
  const yamlPath = path.join(getTenantDir(tenantName), "tenant.yaml");
  const parsed = TenantConfigSchema.parse(yaml.load(await fs.readFile(yamlPath, "utf-8")));
  const includes = tenant.projects.map(p => projectComposeIncludePath(p.name));

  // Walk each project's YAML to know which DB/broker panels to render. A
  // missing file just means "no infra info" — we treat that as everything off
  // for the dashboard rather than crashing the regen.
  const projectsForDashboard = await Promise.all(
    tenant.projects.map(async p => {
      try {
        const ppath = path.join(getProjectDir(tenantName, p.name), "project.yaml");
        const pcfg = ProjectConfigSchema.parse(yaml.load(await fs.readFile(ppath, "utf-8")));
        return {
          name: p.name,
          hasKafka: pcfg.infrastructure.kafka === true,
          hasPostgres: pcfg.infrastructure.postgres === true,
          hasRedis: pcfg.infrastructure.redis === true,
        };
      } catch {
        return { name: p.name, hasKafka: false, hasPostgres: false, hasRedis: false };
      }
    }),
  );

  await writeTenantCompose(parsed, tenant.portBlock, includes, projectsForDashboard);
}

// ─── project list ───────────────────────────────────────────────────────────

async function projectListAction(tenantName: string): Promise<void> {
  const tenant = await getTenant(tenantName);
  if (!tenant) {
    console.error(chalk.red(`Tenant '${tenantName}' not found.`));
    process.exit(1);
  }
  if (tenant.projects.length === 0) {
    console.log(chalk.dim(`No projects in '${tenantName}' yet.`));
    console.log(chalk.cyan(`  blissful-infra project create ${tenantName} <project>`));
    return;
  }
  console.log();
  console.log(chalk.bold(`Projects in '${tenantName}':`));
  console.log();
  for (const p of tenant.projects) {
    console.log(
      `  ${chalk.bold(p.name).padEnd(24)} ` +
      chalk.dim(`#${p.portBlock.projectIndex}  `) +
      chalk.dim(`kafka :${p.portBlock.kafka}  postgres :${p.portBlock.postgres}  redis :${p.portBlock.redis}  ${p.services.length} service${p.services.length === 1 ? "" : "s"}`),
    );
  }
  console.log();
}

// ─── project status ─────────────────────────────────────────────────────────

async function projectStatusAction(tenantName: string, projectName: string): Promise<void> {
  const p = await getProject(tenantName, projectName);
  if (!p) {
    console.error(chalk.red(`Project '${projectName}' not found in tenant '${tenantName}'.`));
    process.exit(1);
  }
  console.log();
  console.log(chalk.bold(`Project: ${tenantName}/${projectName}`));
  console.log(chalk.dim(`  Block #${p.portBlock.projectIndex}`));
  console.log(chalk.dim(`  Kafka:    localhost:${p.portBlock.kafka}`));
  console.log(chalk.dim(`  Postgres: localhost:${p.portBlock.postgres}`));
  console.log(chalk.dim(`  Redis:    localhost:${p.portBlock.redis}`));
  console.log(chalk.dim(`  Gateway:  http://localhost:${p.portBlock.gateway}`));
  console.log();
  if (p.services.length === 0) {
    console.log(chalk.dim("No services yet."));
    console.log(chalk.cyan(`  blissful-infra service add ${tenantName} ${projectName} <service> --type backend`));
  } else {
    console.log(chalk.bold("Services:"));
    for (const s of p.services) {
      const port = s.ports.http ? ` :${s.ports.http}` : "";
      console.log(`  ${chalk.bold(s.name).padEnd(24)} ${chalk.dim(`[${s.type}]${port}`)}`);
    }
  }
  console.log();
}

// ─── project remove ─────────────────────────────────────────────────────────

async function projectRemoveAction(
  tenantName: string,
  projectName: string,
  opts: { skipPrompts?: boolean },
): Promise<void> {
  const p = await getProject(tenantName, projectName);
  if (!p) {
    console.error(chalk.red(`Project '${projectName}' not found in tenant '${tenantName}'.`));
    process.exit(1);
  }

  if (!opts.skipPrompts && process.stdout.isTTY) {
    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: `Remove project '${tenantName}/${projectName}' (drops ${p.services.length} service(s) too)?`,
        default: false,
      },
    ] as never) as { confirm: boolean };
    if (!confirm) {
      console.log(chalk.dim("Aborted."));
      return;
    }
  }

  // Best-effort docker compose down before deleting the directory.
  const projectDir = getProjectDir(tenantName, projectName);
  try {
    await execa("docker", [
      "compose", "-f", "docker-compose.project.yaml", "down", "-v",
    ], { cwd: projectDir, stdio: "pipe" });
  } catch {
    // ignore — containers may already be down or docker is off
  }
  await fs.rm(projectDir, { recursive: true, force: true });
  await unregisterProject(tenantName, projectName);
  await removeFromTenantProjectsList(tenantName, projectName);
  await regenerateTenantCompose(tenantName);
  console.log(chalk.green(`✓ Project '${tenantName}/${projectName}' removed.`));
}

async function removeFromTenantProjectsList(tenantName: string, projectName: string): Promise<void> {
  const yamlPath = path.join(getTenantDir(tenantName), "tenant.yaml");
  try {
    const raw = await fs.readFile(yamlPath, "utf-8");
    const parsed = TenantConfigSchema.parse(yaml.load(raw));
    parsed.projects = parsed.projects.filter(p => p.name !== projectName);
    await fs.writeFile(yamlPath, yaml.dump(parsed, { lineWidth: 120 }));
  } catch {
    // tenant.yaml missing or unreadable — registry is the source of truth anyway
  }
}

// ─── project up / down ──────────────────────────────────────────────────────

async function projectUpAction(tenantName: string, projectName: string): Promise<void> {
  const p = await getProject(tenantName, projectName);
  if (!p) {
    console.error(chalk.red(`Project '${projectName}' not found in tenant '${tenantName}'.`));
    process.exit(1);
  }
  const projectDir = getProjectDir(tenantName, projectName);
  console.log(chalk.dim(`Starting project '${tenantName}/${projectName}'...`));
  try {
    await execa("docker", [
      "compose", "-f", "docker-compose.project.yaml", "up", "-d", "--build",
    ], { cwd: projectDir, stdio: "inherit" });
    console.log(chalk.green(`✓ Project is up.`));
    if (p.portBlock.gateway) {
      console.log(chalk.dim(`  Gateway: http://localhost:${p.portBlock.gateway}`));
    }
  } catch (err) {
    const e = toExecError(err);
    if (e.stderr) console.error(chalk.red(e.stderr));
    process.exit(1);
  }
}

async function projectDownAction(tenantName: string, projectName: string): Promise<void> {
  const p = await getProject(tenantName, projectName);
  if (!p) {
    console.error(chalk.red(`Project '${projectName}' not found in tenant '${tenantName}'.`));
    process.exit(1);
  }
  const projectDir = getProjectDir(tenantName, projectName);
  console.log(chalk.dim(`Stopping project '${tenantName}/${projectName}'...`));
  try {
    await execa("docker", [
      "compose", "-f", "docker-compose.project.yaml", "down",
    ], { cwd: projectDir, stdio: "inherit" });
    console.log(chalk.green(`✓ Project is down.`));
  } catch (err) {
    const e = toExecError(err);
    if (e.stderr) console.error(chalk.red(e.stderr));
    process.exit(1);
  }
}

// ─── command registration ───────────────────────────────────────────────────

export const projectCommand = new Command("project")
  .description("Manage projects (a domain inside a tenant — owns Kafka, Postgres, API gateway, isolated network)");

// Project commands accept `[tenant] <project>` or `<project>` alone (tenant
// pulled from context). The action handlers below expand args via resolveOrExit.

projectCommand
  .command("create")
  .description("Create a new project inside a tenant")
  .argument("[arg1]", "Project name, or tenant name when followed by another arg")
  .argument("[arg2]", "Project name (when tenant is also given)")
  .option("-y, --skip-prompts", "Skip prompts, use defaults")
  .option("--no-kafka", "Disable Kafka")
  .option("--no-postgres", "Disable Postgres")
  .option("--no-redis", "Disable Redis")
  .option("--no-gateway", "Disable API gateway")
  .action(async (arg1: string | undefined, arg2: string | undefined, opts: ProjectCreateOptions) => {
    const { tenant, project } = await resolveOrExit([arg1, arg2], ["tenant", "project"]);
    await projectCreateAction(tenant!, project!, opts);
  });

projectCommand
  .command("list")
  .description("List projects in a tenant")
  .argument("[tenant]", "Tenant name (uses current context if omitted)")
  .action(async (tenantArg?: string) => {
    const { tenant } = await resolveOrExit([tenantArg], ["tenant"]);
    await projectListAction(tenant!);
  });

projectCommand
  .command("status")
  .description("Show project detail (services, ports)")
  .argument("[arg1]", "Project name, or tenant name when followed by another arg")
  .argument("[arg2]", "Project name (when tenant is also given)")
  .action(async (arg1?: string, arg2?: string) => {
    const { tenant, project } = await resolveOrExit([arg1, arg2], ["tenant", "project"]);
    await projectStatusAction(tenant!, project!);
  });

projectCommand
  .command("remove")
  .description("Remove a project and all its services")
  .argument("[arg1]", "Project name, or tenant name when followed by another arg")
  .argument("[arg2]", "Project name (when tenant is also given)")
  .option("-y, --skip-prompts", "Skip confirmation")
  .action(async (arg1: string | undefined, arg2: string | undefined, opts: { skipPrompts?: boolean }) => {
    const { tenant, project } = await resolveOrExit([arg1, arg2], ["tenant", "project"]);
    await projectRemoveAction(tenant!, project!, opts);
  });

projectCommand
  .command("up")
  .description("Start a project's infrastructure")
  .argument("[arg1]", "Project name, or tenant name when followed by another arg")
  .argument("[arg2]", "Project name (when tenant is also given)")
  .action(async (arg1?: string, arg2?: string) => {
    const { tenant, project } = await resolveOrExit([arg1, arg2], ["tenant", "project"]);
    await projectUpAction(tenant!, project!);
  });

projectCommand
  .command("down")
  .description("Stop a project's infrastructure")
  .argument("[arg1]", "Project name, or tenant name when followed by another arg")
  .argument("[arg2]", "Project name (when tenant is also given)")
  .action(async (arg1?: string, arg2?: string) => {
    const { tenant, project } = await resolveOrExit([arg1, arg2], ["tenant", "project"]);
    await projectDownAction(tenant!, project!);
  });
