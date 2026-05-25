import { Command } from "commander";
import inquirer from "inquirer";
import chalk from "chalk";
import { tenantCreateAction, tenantUpAction } from "./tenant.js";
import { projectCreateAction } from "./project.js";
import { serviceAddV2Action } from "./service-v2.js";
import { listTenants, listProjects, getTenantDir, getProjectDir, getService, getTenant } from "../utils/tenant-registry.js";
import { writeContext } from "../utils/context.js";
import type { ServiceType } from "@blissful-infra/shared";
import fs from "node:fs/promises";

interface InitOptions {
  skipPrompts?: boolean;
  noStart?: boolean;
}

/**
 * `blissful-infra init` — the front door for new users. Walks through the
 * three levels of the hierarchy in one prompt-driven flow:
 *
 *   1. Pick / create a tenant (organization)
 *   2. Pick / create a project (domain)
 *   3. Optionally add a first service (atomic process)
 *
 * Delegates the detailed infra pickers to tenantCreateAction +
 * projectCreateAction so question logic isn't duplicated. The wizard owns
 * orchestration only.
 */
export const initCommand = new Command("init")
  .description("Walk through setting up your first tenant, project, and service — and bring it all up")
  .option("-y, --skip-prompts", "Accept all defaults — creates tenant 'dev', project 'main', service 'api' (spring-boot backend) and starts everything")
  .option("--no-start", "Just scaffold; don't run `tenant up` at the end")
  .action(async (opts: InitOptions) => {
    console.log();
    console.log(chalk.bold("👋 Welcome to blissful-infra"));
    console.log();
    console.log(chalk.dim("This will set up:"));
    console.log(chalk.dim("  · a tenant (your isolated environment — owns dashboard + observability)"));
    console.log(chalk.dim("  · a project (a domain inside the tenant — owns Kafka, Postgres, gateway)"));
    console.log(chalk.dim("  · optionally, a first service (one process inside the project)"));
    console.log();

    const tenantName = await pickOrCreateTenant(opts);
    const projectName = await pickOrCreateProject(tenantName, opts);
    const wantsService = await askWantsService(opts);

    let serviceName: string | undefined;
    if (wantsService) {
      const spec = await collectServiceSpec(opts);
      serviceName = spec.serviceName;

      console.log();
      console.log(chalk.dim(`Adding service '${serviceName}' to ${tenantName}/${projectName}...`));
      console.log();
      await serviceAddV2Action(tenantName, projectName, serviceName, {
        type: spec.serviceType,
        template: spec.template,
        runtime: spec.runtime,
        skipPrompts: opts.skipPrompts,
      });
    }

    // serviceAddV2Action doesn't touch context; reassert.
    await writeContext({ tenant: tenantName, project: projectName });

    // The whole point of `init` is "POC up in one command". Ask (or just do
    // it, with --skip-prompts) at the end. The user can opt out with --no-start.
    const shouldStart = await askWantsToStart(opts);
    if (shouldStart) {
      console.log();
      console.log(chalk.bold(`Starting tenant '${tenantName}'...`));
      console.log(chalk.dim("This brings up the tenant, project, AND every service in one go via the compose include chain."));
      console.log(chalk.dim("First run takes a few minutes (image builds + pulls). Subsequent runs are seconds."));
      console.log();
      await tenantUpAction(tenantName);
      printNextStepsRunning(tenantName, projectName, serviceName);
    } else {
      printNextStepsScaffoldedOnly(tenantName, projectName, serviceName);
    }
  });

async function askWantsToStart(opts: InitOptions): Promise<boolean> {
  if (opts.noStart) return false;
  if (opts.skipPrompts) return true;
  const { start } = (await inquirer.prompt([
    {
      type: "confirm",
      name: "start",
      message: "Bring everything up now (tenant + project + services)?",
      default: true,
    },
  ] as never)) as { start: boolean };
  return start;
}

async function pickOrCreateTenant(opts: InitOptions): Promise<string> {
  const existing = await listTenants();

  if (opts.skipPrompts) {
    if (existing.find(t => t.name === "dev")) return "dev";
    await tenantCreateAction("dev", { skipPrompts: true });
    return "dev";
  }

  let chosen: string;
  if (existing.length === 0) {
    const { name } = (await inquirer.prompt([
      {
        type: "input",
        name: "name",
        message: "Tenant name:",
        default: "dev",
        validate: (v: string) => /^[a-z0-9-]+$/.test(v) || "Lowercase alphanumeric and hyphens only",
      },
    ] as never)) as { name: string };
    chosen = name;
  } else {
    const { selected } = (await inquirer.prompt([
      {
        type: "list",
        name: "selected",
        message: "Pick a tenant or create a new one:",
        choices: [
          ...existing.map(t => ({ name: `${t.name} (existing)`, value: t.name })),
          { name: "Create new tenant...", value: "__new__" },
        ],
      },
    ] as never)) as { selected: string };

    if (selected === "__new__") {
      const { name } = (await inquirer.prompt([
        {
          type: "input",
          name: "name",
          message: "New tenant name:",
          default: "dev",
          validate: (v: string) => /^[a-z0-9-]+$/.test(v) || "Lowercase alphanumeric and hyphens only",
        },
      ] as never)) as { name: string };
      chosen = name;
    } else {
      chosen = selected;
    }
  }

  // Only run the create flow if this tenant doesn't exist yet. The create
  // action prompts for infra components.
  if (!(await tenantExists(chosen))) {
    await tenantCreateAction(chosen, { skipPrompts: opts.skipPrompts });
  }
  return chosen;
}

async function pickOrCreateProject(tenantName: string, opts: InitOptions): Promise<string> {
  const existing = await listProjects(tenantName);

  if (opts.skipPrompts) {
    if (existing.find(p => p.name === "main")) return "main";
    await projectCreateAction(tenantName, "main", { skipPrompts: true });
    return "main";
  }

  let chosen: string;
  if (existing.length === 0) {
    const { name } = (await inquirer.prompt([
      {
        type: "input",
        name: "name",
        message: "Project name (a domain — think 'ecommerce', 'logistics', or just 'main'):",
        default: "main",
        validate: (v: string) => /^[a-z0-9-]+$/.test(v) || "Lowercase alphanumeric and hyphens only",
      },
    ] as never)) as { name: string };
    chosen = name;
  } else {
    const { selected } = (await inquirer.prompt([
      {
        type: "list",
        name: "selected",
        message: `Pick a project in '${tenantName}' or create a new one:`,
        choices: [
          ...existing.map(p => ({ name: `${p.name} (existing)`, value: p.name })),
          { name: "Create new project...", value: "__new__" },
        ],
      },
    ] as never)) as { selected: string };

    if (selected === "__new__") {
      const { name } = (await inquirer.prompt([
        {
          type: "input",
          name: "name",
          message: "New project name:",
          default: "main",
          validate: (v: string) => /^[a-z0-9-]+$/.test(v) || "Lowercase alphanumeric and hyphens only",
        },
      ] as never)) as { name: string };
      chosen = name;
    } else {
      chosen = selected;
    }
  }

  if (!(await projectExists(tenantName, chosen))) {
    await projectCreateAction(tenantName, chosen, { skipPrompts: opts.skipPrompts });
  }
  return chosen;
}

async function askWantsService(opts: InitOptions): Promise<boolean> {
  if (opts.skipPrompts) return true;
  const { add } = (await inquirer.prompt([
    {
      type: "confirm",
      name: "add",
      message: "Add a first service now?",
      default: true,
    },
  ] as never)) as { add: boolean };
  return add;
}

interface ServiceSpec {
  serviceName: string;
  serviceType: ServiceType;
  template?: string;
  runtime?: "python" | "node" | "go";
}

async function collectServiceSpec(opts: InitOptions): Promise<ServiceSpec> {
  if (opts.skipPrompts) {
    return { serviceName: "api", serviceType: "backend", template: "spring-boot" };
  }

  const { serviceName, serviceType } = (await inquirer.prompt([
    {
      type: "input",
      name: "serviceName",
      message: "Service name:",
      default: "api",
      validate: (v: string) => /^[a-z0-9-]+$/.test(v) || "Lowercase alphanumeric and hyphens only",
    },
    {
      type: "list",
      name: "serviceType",
      message: "Service type:",
      default: "backend",
      choices: [
        { name: "backend  — API / server process",         value: "backend" },
        { name: "frontend — UI / web app",                  value: "frontend" },
        { name: "worker   — headless event / job processor", value: "worker" },
      ],
    },
  ] as never)) as { serviceName: string; serviceType: ServiceType };

  let template: string | undefined;
  let runtime: "python" | "node" | "go" | undefined;

  if (serviceType === "backend") {
    const { t } = (await inquirer.prompt([
      {
        type: "list",
        name: "t",
        message: "Backend template:",
        default: "spring-boot",
        choices: [
          { name: "spring-boot   — Kotlin + Spring Boot + Kafka",        value: "spring-boot" },
          { name: "lambda-python — Python serverless on floci/LocalStack", value: "lambda-python" },
        ],
      },
    ] as never)) as { t: string };
    template = t;
  } else if (serviceType === "frontend") {
    template = "react-vite";
  } else if (serviceType === "worker") {
    const { r } = (await inquirer.prompt([
      {
        type: "list",
        name: "r",
        message: "Worker runtime:",
        default: "python",
        choices: ["python", "node", "go"],
      },
    ] as never)) as { r: "python" | "node" | "go" };
    runtime = r;
  }

  return { serviceName, serviceType, template, runtime };
}

async function tenantExists(name: string): Promise<boolean> {
  try {
    await fs.access(getTenantDir(name));
    return true;
  } catch {
    return false;
  }
}

async function projectExists(tenant: string, project: string): Promise<boolean> {
  try {
    await fs.access(getProjectDir(tenant, project));
    return true;
  } catch {
    return false;
  }
}

// Suppress unused — kept exported for callers (none yet).
void getService;

async function printNextStepsRunning(tenant: string, project: string, service?: string): Promise<void> {
  const t = await getTenant(tenant);
  console.log();
  console.log(chalk.green.bold("✓ Your POC is running."));
  console.log();
  console.log(chalk.dim("Current context:"));
  console.log(chalk.dim("  tenant  ") + chalk.cyan(tenant));
  console.log(chalk.dim("  project ") + chalk.cyan(project));
  console.log();
  if (t) {
    console.log(chalk.dim("URLs:"));
    console.log(chalk.dim("  Dashboard ") + chalk.cyan(`http://localhost:${t.portBlock.dashboard}`));
    console.log(chalk.dim("  Grafana   ") + chalk.cyan(`http://localhost:${t.portBlock.grafana}`));
    console.log();
  }
  if (service) {
    console.log(chalk.dim("Tail logs:"));
    console.log(chalk.cyan(`  blissful-infra service logs ${service}`));
    console.log();
  }
  console.log(chalk.dim("Stop everything when you're done:"));
  console.log(chalk.cyan("  blissful-infra tenant down"));
  console.log();
}

function printNextStepsScaffoldedOnly(tenant: string, project: string, service?: string): void {
  console.log();
  console.log(chalk.green.bold(`✓ ${tenant}/${project}${service ? `/${service}` : ""} is scaffolded.`));
  console.log();
  console.log(chalk.dim("Current context:"));
  console.log(chalk.dim("  tenant  ") + chalk.cyan(tenant));
  console.log(chalk.dim("  project ") + chalk.cyan(project));
  console.log();
  console.log(chalk.dim("One command brings everything up:"));
  console.log(chalk.cyan("  blissful-infra tenant up"));
  console.log();
}
