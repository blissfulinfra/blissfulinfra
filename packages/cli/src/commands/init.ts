import { Command } from "commander";
import inquirer from "inquirer";
import chalk from "chalk";
import { tenantCreateAction, tenantUpAction } from "./tenant.js";
import { projectCreateAction } from "./project.js";
import { serviceAddV2Action } from "./service-v2.js";
import { listTenants, listProjects, getTenantDir, getProjectDir, getService, getTenant } from "../utils/tenant-registry.js";
import { writeContext } from "../utils/context.js";
import fs from "node:fs/promises";

interface InitOptions {
  skipPrompts?: boolean;
  // Commander parses `--no-start` into `start: false` (truthy by default).
  start?: boolean;
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
    console.log(chalk.dim("  · a project (a domain inside the tenant — owns Kafka, Postgres, Redis, gateway)"));
    console.log(chalk.dim("  · a full-stack pair of services: a backend API and a frontend UI"));
    console.log();

    const tenantName = await pickOrCreateTenant(opts);
    const projectName = await pickOrCreateProject(tenantName, opts);
    const addedServices = await addDefaultFullStack(tenantName, projectName, opts);

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
      printNextStepsRunning(tenantName, projectName, addedServices);
    } else {
      printNextStepsScaffoldedOnly(tenantName, projectName, addedServices);
    }
  });

/**
 * Default full-stack scaffold: one backend + one frontend. Asks before each
 * (default yes for both) so the user can opt out of either; with
 * --skip-prompts both are created with conventional names + templates.
 */
async function addDefaultFullStack(
  tenant: string,
  project: string,
  opts: InitOptions,
): Promise<string[]> {
  const added: string[] = [];

  // Backend
  const addBackend = opts.skipPrompts ? true : await confirm("Add a backend service?", true);
  if (addBackend) {
    const backend = await collectBackendSpec(opts);
    console.log();
    console.log(chalk.dim(`Adding backend '${backend.name}' to ${tenant}/${project}...`));
    console.log();
    await serviceAddV2Action(tenant, project, backend.name, {
      type: "backend",
      template: backend.template,
      skipPrompts: opts.skipPrompts,
    });
    added.push(backend.name);
  }

  // Frontend
  const addFrontend = opts.skipPrompts ? true : await confirm("Add a frontend service?", true);
  if (addFrontend) {
    const frontend = await collectFrontendSpec(opts);
    console.log();
    console.log(chalk.dim(`Adding frontend '${frontend.name}' to ${tenant}/${project}...`));
    console.log();
    await serviceAddV2Action(tenant, project, frontend.name, {
      type: "frontend",
      template: frontend.template,
      skipPrompts: opts.skipPrompts,
    });
    added.push(frontend.name);
  }

  return added;
}

async function confirm(message: string, defaultValue: boolean): Promise<boolean> {
  const { answer } = (await inquirer.prompt([
    { type: "confirm", name: "answer", message, default: defaultValue },
  ] as never)) as { answer: boolean };
  return answer;
}

async function collectBackendSpec(opts: InitOptions): Promise<{ name: string; template: string }> {
  if (opts.skipPrompts) return { name: "api", template: "spring-boot" };
  const { name, template } = (await inquirer.prompt([
    {
      type: "input",
      name: "name",
      message: "Backend service name:",
      default: "api",
      validate: (v: string) => /^[a-z0-9-]+$/.test(v) || "Lowercase alphanumeric and hyphens only",
    },
    {
      type: "list",
      name: "template",
      message: "Backend template:",
      default: "spring-boot",
      choices: [
        { name: "spring-boot   — Kotlin + Spring Boot + Kafka + JPA",         value: "spring-boot" },
        { name: "lambda-python — Python serverless on floci/LocalStack",       value: "lambda-python" },
      ],
    },
  ] as never)) as { name: string; template: string };
  return { name, template };
}

async function collectFrontendSpec(opts: InitOptions): Promise<{ name: string; template: string }> {
  if (opts.skipPrompts) return { name: "web", template: "react-vite" };
  const { name, template } = (await inquirer.prompt([
    {
      type: "input",
      name: "name",
      message: "Frontend service name:",
      default: "web",
      validate: (v: string) => /^[a-z0-9-]+$/.test(v) || "Lowercase alphanumeric and hyphens only",
    },
    {
      type: "list",
      name: "template",
      message: "Frontend template:",
      default: "react-vite",
      choices: [
        { name: "react-vite — React 19 + Vite + TypeScript + Tailwind", value: "react-vite" },
      ],
    },
  ] as never)) as { name: string; template: string };
  return { name, template };
}

async function askWantsToStart(opts: InitOptions): Promise<boolean> {
  // Commander sets `opts.start = false` when the user passes `--no-start`.
  if (opts.start === false) return false;
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

async function printNextStepsRunning(tenant: string, project: string, services: string[]): Promise<void> {
  const t = await getTenant(tenant);
  console.log();
  console.log(chalk.green.bold("✓ Your POC is running."));
  console.log();
  console.log(chalk.dim("Current context:"));
  console.log(chalk.dim("  tenant  ") + chalk.cyan(tenant));
  console.log(chalk.dim("  project ") + chalk.cyan(project));
  if (services.length > 0) {
    console.log(chalk.dim("  services ") + chalk.cyan(services.join(", ")));
  }
  console.log();
  if (t) {
    console.log(chalk.dim("URLs:"));
    console.log(chalk.dim("  Dashboard ") + chalk.cyan(`http://localhost:${t.portBlock.dashboard}`));
    console.log(chalk.dim("  Grafana   ") + chalk.cyan(`http://localhost:${t.portBlock.grafana}`));
    console.log();
  }
  if (services.length > 0) {
    console.log(chalk.dim("Tail logs:"));
    for (const s of services) {
      console.log(chalk.cyan(`  blissful-infra service logs ${s}`));
    }
    console.log();
  }
  console.log(chalk.dim("Stop everything when you're done:"));
  console.log(chalk.cyan("  blissful-infra tenant down"));
  console.log();
}

function printNextStepsScaffoldedOnly(tenant: string, project: string, services: string[]): void {
  const summary = services.length > 0 ? ` with ${services.join(" + ")}` : "";
  console.log();
  console.log(chalk.green.bold(`✓ ${tenant}/${project}${summary} scaffolded.`));
  console.log();
  console.log(chalk.dim("Current context:"));
  console.log(chalk.dim("  tenant  ") + chalk.cyan(tenant));
  console.log(chalk.dim("  project ") + chalk.cyan(project));
  console.log();
  console.log(chalk.dim("One command brings everything up:"));
  console.log(chalk.cyan("  blissful-infra tenant up"));
  console.log();
}
