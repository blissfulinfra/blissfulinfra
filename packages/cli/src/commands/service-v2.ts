import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import {
  ServiceConfigV2Schema,
  ProjectConfigSchema,
  type ServiceConfigV2,
  type ProjectConfig,
  type ServiceType,
  type BackendTemplate,
  type FrontendTemplate,
  type WorkerRuntime,
} from "@blissful-infra/shared";
import {
  registerService,
  unregisterService,
  getTenant,
  getProject,
  getService,
  getProjectDir,
  getServiceDir,
} from "../utils/tenant-registry.js";
import { copyTemplate } from "../utils/template.js";
import { writeServiceCompose } from "../utils/service-compose-v2.js";
import {
  writeProjectCompose,
  serviceComposeIncludePath,
  serviceComposePath,
} from "../utils/project-compose.js";
import { toExecError } from "../utils/errors.js";
import { resolveOrExit } from "../utils/context.js";

// ─── service add ────────────────────────────────────────────────────────────

interface ServiceAddV2Options {
  type?: ServiceType;
  template?: string;     // spring-boot / lambda-python (backend) | react-vite (frontend)
  runtime?: WorkerRuntime; // worker only
  noDatabase?: boolean;
  skipPrompts?: boolean;
}

const DEFAULT_BACKEND_TEMPLATE: BackendTemplate = "spring-boot";
const DEFAULT_FRONTEND_TEMPLATE: FrontendTemplate = "react-vite";
const DEFAULT_WORKER_RUNTIME: WorkerRuntime = "python";

export async function serviceAddV2Action(
  tenantName: string,
  projectName: string,
  serviceName: string,
  opts: ServiceAddV2Options,
): Promise<void> {
  console.log();
  console.log(
    chalk.bold("blissful-infra service add"),
    chalk.cyan(`${tenantName}/${projectName}/${serviceName}`),
  );
  console.log();

  if (!/^[a-z0-9-]+$/.test(serviceName)) {
    console.error(chalk.red("Service name must be lowercase alphanumeric with hyphens"));
    process.exit(1);
  }
  if (!opts.type) {
    console.error(chalk.red("--type is required (backend, frontend, or worker)"));
    process.exit(1);
  }

  // Verify parent tenant + project exist
  const tenant = await getTenant(tenantName);
  if (!tenant) {
    console.error(chalk.red(`Tenant '${tenantName}' not found.`));
    console.error(chalk.cyan(`  blissful-infra tenant create ${tenantName}`));
    process.exit(1);
  }
  const project = await getProject(tenantName, projectName);
  if (!project) {
    console.error(chalk.red(`Project '${projectName}' not found in tenant '${tenantName}'.`));
    console.error(chalk.cyan(`  blissful-infra project create ${tenantName} ${projectName}`));
    process.exit(1);
  }

  const existing = await getService(tenantName, projectName, serviceName);
  if (existing) {
    console.error(chalk.red(`Service '${serviceName}' already exists in ${tenantName}/${projectName}.`));
    process.exit(1);
  }

  // Build the ServiceConfigV2. Each type has exactly one nested block.
  const serviceType = opts.type;
  let config: ServiceConfigV2;
  try {
    config = ServiceConfigV2Schema.parse(buildServiceConfig({
      tenant: tenantName,
      project: projectName,
      service: serviceName,
      type: serviceType,
      template: opts.template,
      runtime: opts.runtime,
      projectHasPostgres: project.portBlock !== undefined && tenant !== null
        && (await projectHasPostgresEnabled(tenantName, projectName))
        && !opts.noDatabase
        && serviceType !== "frontend",
    }));
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }

  // Register in the global registry (allocates ports)
  const spinner = ora("Allocating service ports...").start();
  let registryEntry;
  try {
    registryEntry = await registerService(tenantName, projectName, serviceName, serviceType);
  } catch (err) {
    spinner.fail("Could not allocate service slot");
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
  spinner.succeed(`Service registered ${registryEntry.ports.http ? `(http :${registryEntry.ports.http})` : ""}`);

  // Scaffold the service directory
  const dirSpinner = ora("Scaffolding service...").start();
  const serviceDir = getServiceDir(tenantName, projectName, serviceName);
  await fs.mkdir(serviceDir, { recursive: true });

  try {
    await scaffoldServiceSource(serviceDir, config, tenantName);
    dirSpinner.succeed(`Service scaffolded at ${serviceDir}`);
  } catch (err) {
    dirSpinner.fail("Scaffolding failed");
    // Roll back registry on disk failure to keep state consistent
    await unregisterService(tenantName, projectName, serviceName).catch(() => { /* best effort */ });
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }

  await fs.writeFile(
    path.join(serviceDir, "service.yaml"),
    yaml.dump(config, { lineWidth: 120 }),
  );

  // Update parent project.yaml services list
  await appendServiceToProjectYaml(tenantName, projectName, serviceName, serviceType);

  // Generate the per-service docker-compose.yaml + regenerate the parent
  // project compose so it `include:`s this new service.
  const projectConfig = await readProjectConfig(tenantName, projectName);
  await writeServiceCompose(config, projectConfig, registryEntry.ports);
  await regenerateProjectCompose(tenantName, projectName);

  console.log();
  console.log(chalk.green.bold(`✓ Service '${serviceName}' added to ${tenantName}/${projectName}.`));
  console.log();
  console.log(chalk.dim(`  Type:    ${serviceType}`));
  if (registryEntry.ports.http) {
    console.log(chalk.dim("  HTTP:    ") + chalk.cyan(`http://localhost:${registryEntry.ports.http}`));
  }
  if (config.database) {
    console.log(chalk.dim("  DB:      ") + chalk.cyan(`postgres schema '${config.database.schema}'`) + chalk.dim(" (auto-allocated)"));
  }
  console.log();
  console.log(chalk.dim("Service is scaffolded. Bring it up when ready:"));
  console.log(chalk.cyan(`  blissful-infra service up ${tenantName} ${projectName} ${serviceName}`));
  console.log();
}

interface BuildServiceConfigInput {
  tenant: string;
  project: string;
  service: string;
  type: ServiceType;
  template?: string;
  runtime?: WorkerRuntime;
  projectHasPostgres: boolean;
}

function buildServiceConfig(input: BuildServiceConfigInput): unknown {
  const base = {
    type: "service" as const,
    name: input.service,
    tenant: input.tenant,
    project: input.project,
    serviceType: input.type,
    plugins: [] as string[],
  };

  // DDD: backends and workers get their own dedicated Postgres schema by
  // default. The schema name defaults to the service name; the user can
  // override later in service.yaml.
  const database = input.projectHasPostgres
    ? { schema: input.service.replace(/-/g, "_"), migrations: true }
    : undefined;

  switch (input.type) {
    case "backend": {
      const template = (input.template as BackendTemplate | undefined) ?? DEFAULT_BACKEND_TEMPLATE;
      if (!["spring-boot", "lambda-python"].includes(template)) {
        throw new Error(`Unknown backend template '${template}' (expected spring-boot or lambda-python)`);
      }
      return { ...base, backend: { template }, database };
    }
    case "frontend": {
      const template = (input.template as FrontendTemplate | undefined) ?? DEFAULT_FRONTEND_TEMPLATE;
      if (!["react-vite"].includes(template)) {
        throw new Error(`Unknown frontend template '${template}' (expected react-vite)`);
      }
      return { ...base, frontend: { template } };
    }
    case "worker": {
      const runtime = input.runtime ?? DEFAULT_WORKER_RUNTIME;
      if (!["python", "node", "go"].includes(runtime)) {
        throw new Error(`Unknown worker runtime '${runtime}' (expected python, node, or go)`);
      }
      return { ...base, worker: { runtime }, database };
    }
  }
}

async function scaffoldServiceSource(
  serviceDir: string,
  config: ServiceConfigV2,
  tenantName: string,
): Promise<void> {
  // Templates expect a "projectName" variable that drives package names,
  // image tags, app names, etc. In the new model the service name maps to
  // that role.
  const vars = {
    projectName: config.name,
    database: config.database ? "postgres" : "none",
    deployTarget: "local-only",
    clientName: tenantName, // legacy var name some templates still read
  };

  if (config.serviceType === "backend" && config.backend) {
    await copyTemplate(config.backend.template, serviceDir, vars);
  } else if (config.serviceType === "frontend" && config.frontend) {
    await copyTemplate(config.frontend.template, serviceDir, vars);
  } else if (config.serviceType === "worker" && config.worker) {
    // No worker template exists yet; scaffold a minimal placeholder so the
    // directory is real and the user can iterate. Phase 5 (compose) needs at
    // least a Dockerfile here; we ship a skeletal one.
    await writeWorkerSkeleton(serviceDir, config.worker.runtime, config.name);
  }
}

async function writeWorkerSkeleton(
  dir: string,
  runtime: WorkerRuntime,
  serviceName: string,
): Promise<void> {
  // Minimum viable worker scaffold. Phase 5 wires the Dockerfile + compose
  // entry; until then this gives the user a starting point.
  if (runtime === "python") {
    await fs.writeFile(path.join(dir, "main.py"), `# ${serviceName} worker — placeholder.
# Phase 5 will add Kafka consumer wiring against the project's event bus.

def main():
    print("worker '${serviceName}' booted")

if __name__ == "__main__":
    main()
`);
    await fs.writeFile(path.join(dir, "requirements.txt"), "# add deps here\n");
  } else if (runtime === "node") {
    await fs.writeFile(path.join(dir, "index.js"), `// ${serviceName} worker — placeholder.
console.log("worker '${serviceName}' booted");
`);
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({
      name: serviceName,
      version: "0.1.0",
      type: "module",
      main: "index.js",
    }, null, 2) + "\n");
  } else if (runtime === "go") {
    await fs.writeFile(path.join(dir, "main.go"), `package main

import "fmt"

func main() {
\tfmt.Println("worker '${serviceName}' booted")
}
`);
    await fs.writeFile(path.join(dir, "go.mod"), `module ${serviceName}\n\ngo 1.22\n`);
  }
  await fs.writeFile(path.join(dir, "README.md"), `# ${serviceName}

Worker service (${runtime}). Placeholder scaffold — the Phase 5 compose
generator will add Kafka consumer wiring against the project's event bus.
`);
}

async function projectHasPostgresEnabled(tenant: string, project: string): Promise<boolean> {
  try {
    const parsed = await readProjectConfig(tenant, project);
    return parsed.infrastructure.postgres === true;
  } catch {
    return false;
  }
}

async function readProjectConfig(tenant: string, project: string): Promise<ProjectConfig> {
  const yamlPath = path.join(getProjectDir(tenant, project), "project.yaml");
  const raw = await fs.readFile(yamlPath, "utf-8");
  return ProjectConfigSchema.parse(yaml.load(raw));
}

/**
 * Regenerate the project's docker-compose.project.yaml + postgres init script
 * so they reflect the current set of registered services (includes + schemas).
 * Called whenever services are added/removed.
 */
async function regenerateProjectCompose(tenant: string, project: string): Promise<void> {
  const projectEntry = await getProject(tenant, project);
  if (!projectEntry) return;
  const config = await readProjectConfig(tenant, project);

  // Walk each registered service to figure out which need DB schemas + their
  // include paths. We read service.yaml because it has the database block —
  // the registry only stores ports + service type.
  const includes: string[] = [];
  const schemas: string[] = [];
  for (const s of projectEntry.services) {
    includes.push(serviceComposeIncludePath(s.name));
    try {
      const svcYamlPath = path.join(getServiceDir(tenant, project, s.name), "service.yaml");
      const svc = ServiceConfigV2Schema.parse(yaml.load(await fs.readFile(svcYamlPath, "utf-8")));
      if (svc.database) schemas.push(svc.database.schema);
    } catch {
      // service.yaml missing — skip (it's been deleted out-of-band)
    }
  }

  await writeProjectCompose(tenant, project, config, projectEntry.portBlock, includes, schemas);
}

async function appendServiceToProjectYaml(
  tenant: string,
  project: string,
  service: string,
  type: ServiceType,
): Promise<void> {
  const projectYamlPath = path.join(getProjectDir(tenant, project), "project.yaml");
  const raw = await fs.readFile(projectYamlPath, "utf-8");
  const parsed = ProjectConfigSchema.parse(yaml.load(raw));
  if (!parsed.services.find(s => s.name === service)) {
    parsed.services.push({ name: service, path: `services/${service}`, type });
    await fs.writeFile(projectYamlPath, yaml.dump(parsed, { lineWidth: 120 }));
  }
}

// ─── service remove ─────────────────────────────────────────────────────────

async function serviceRemoveV2Action(
  tenantName: string,
  projectName: string,
  serviceName: string,
): Promise<void> {
  const svc = await getService(tenantName, projectName, serviceName);
  if (!svc) {
    console.error(chalk.red(`Service '${serviceName}' not found in ${tenantName}/${projectName}.`));
    process.exit(1);
  }

  // Best-effort: stop + remove just this service's container if it's running.
  const serviceDir = getServiceDir(tenantName, projectName, serviceName);
  try {
    await execa("docker", ["compose", "-f", "docker-compose.yaml", "down"], {
      cwd: serviceDir, stdio: "pipe",
    });
  } catch {
    // ignore — container may not be running
  }
  await fs.rm(serviceDir, { recursive: true, force: true });
  await unregisterService(tenantName, projectName, serviceName);
  await removeFromProjectYaml(tenantName, projectName, serviceName);
  // Regenerate the project compose so it no longer includes this service.
  await regenerateProjectCompose(tenantName, projectName);
  console.log(chalk.green(`✓ Service '${tenantName}/${projectName}/${serviceName}' removed.`));
}

async function removeFromProjectYaml(tenant: string, project: string, service: string): Promise<void> {
  const projectYamlPath = path.join(getProjectDir(tenant, project), "project.yaml");
  try {
    const raw = await fs.readFile(projectYamlPath, "utf-8");
    const parsed = ProjectConfigSchema.parse(yaml.load(raw));
    parsed.services = parsed.services.filter(s => s.name !== service);
    await fs.writeFile(projectYamlPath, yaml.dump(parsed, { lineWidth: 120 }));
  } catch {
    // project.yaml missing — registry is the source of truth anyway
  }
}

// ─── service up / down / logs ───────────────────────────────────────────────
// All three operate via the project compose, not the per-service one, so they
// run inside the same Docker Compose project as kafka/postgres/gateway (proper
// dependency resolution + shared network).

async function serviceUpV2Action(t: string, p: string, s: string): Promise<void> {
  if (!await getService(t, p, s)) {
    console.error(chalk.red(`Service '${s}' not found in ${t}/${p}.`));
    process.exit(1);
  }
  const projectDir = getProjectDir(t, p);
  // Build & start ONLY this service's container family. Compose will resolve
  // its depends_on (postgres/kafka) and bring those up too if not already running.
  try {
    await execa("docker", [
      "compose", "-f", "docker-compose.project.yaml", "up", "-d", "--build", s,
    ], { cwd: projectDir, stdio: "inherit" });
    console.log(chalk.green(`✓ Service '${t}/${p}/${s}' is up.`));
  } catch (err) {
    const e = toExecError(err);
    if (e.stderr) console.error(chalk.red(e.stderr));
    process.exit(1);
  }
}

async function serviceDownV2Action(t: string, p: string, s: string): Promise<void> {
  if (!await getService(t, p, s)) {
    console.error(chalk.red(`Service '${s}' not found in ${t}/${p}.`));
    process.exit(1);
  }
  const projectDir = getProjectDir(t, p);
  try {
    await execa("docker", [
      "compose", "-f", "docker-compose.project.yaml", "stop", s,
    ], { cwd: projectDir, stdio: "inherit" });
    console.log(chalk.green(`✓ Service '${t}/${p}/${s}' is stopped.`));
  } catch (err) {
    const e = toExecError(err);
    if (e.stderr) console.error(chalk.red(e.stderr));
    process.exit(1);
  }
}

async function serviceLogsV2Action(t: string, p: string, s: string): Promise<void> {
  if (!await getService(t, p, s)) {
    console.error(chalk.red(`Service '${s}' not found in ${t}/${p}.`));
    process.exit(1);
  }
  const projectDir = getProjectDir(t, p);
  // Stream logs interactively. User Ctrl-C's out.
  try {
    await execa("docker", [
      "compose", "-f", "docker-compose.project.yaml", "logs", "-f", "--tail=100", s,
    ], { cwd: projectDir, stdio: "inherit" });
  } catch {
    // Ctrl-C exits with non-zero — swallow
  }
}

// ─── command registration ───────────────────────────────────────────────────

export const serviceCommandV2 = new Command("service")
  .description("Manage services (atomic processes inside a project — one container family each)");

// All service commands accept the trailing args; missing prefixes fill from
// context. `service add my-api --type backend` works after `use acme/web`.

serviceCommandV2
  .command("add")
  .description("Add a service to a project. Use --type backend|frontend|worker.")
  .argument("[arg1]", "Service name, or tenant/project name when followed by more args")
  .argument("[arg2]", "Service name, or project name when followed by more args")
  .argument("[arg3]", "Service name (when tenant + project are also given)")
  .requiredOption("-t, --type <type>", "Service type: backend, frontend, or worker")
  .option("--template <name>", "Backend: spring-boot|lambda-python | Frontend: react-vite")
  .option("--runtime <runtime>", "Worker runtime: python|node|go")
  .option("--no-database", "Skip the auto-allocated Postgres schema (backends/workers only)")
  .option("-y, --skip-prompts", "Skip prompts; accept defaults")
  .action(async (arg1: string | undefined, arg2: string | undefined, arg3: string | undefined, opts: ServiceAddV2Options) => {
    const { tenant, project, service } = await resolveOrExit([arg1, arg2, arg3], ["tenant", "project", "service"]);
    await serviceAddV2Action(tenant!, project!, service!, opts);
  });

serviceCommandV2
  .command("remove")
  .description("Remove a service from a project")
  .argument("[arg1]", "Service name (or tenant/project leading into it)")
  .argument("[arg2]")
  .argument("[arg3]")
  .action(async (arg1?: string, arg2?: string, arg3?: string) => {
    const { tenant, project, service } = await resolveOrExit([arg1, arg2, arg3], ["tenant", "project", "service"]);
    await serviceRemoveV2Action(tenant!, project!, service!);
  });

serviceCommandV2
  .command("up")
  .description("Start a service")
  .argument("[arg1]", "Service name (or tenant/project leading into it)")
  .argument("[arg2]")
  .argument("[arg3]")
  .action(async (arg1?: string, arg2?: string, arg3?: string) => {
    const { tenant, project, service } = await resolveOrExit([arg1, arg2, arg3], ["tenant", "project", "service"]);
    await serviceUpV2Action(tenant!, project!, service!);
  });

serviceCommandV2
  .command("down")
  .description("Stop a service")
  .argument("[arg1]", "Service name (or tenant/project leading into it)")
  .argument("[arg2]")
  .argument("[arg3]")
  .action(async (arg1?: string, arg2?: string, arg3?: string) => {
    const { tenant, project, service } = await resolveOrExit([arg1, arg2, arg3], ["tenant", "project", "service"]);
    await serviceDownV2Action(tenant!, project!, service!);
  });

serviceCommandV2
  .command("logs")
  .description("Tail service logs")
  .argument("[arg1]", "Service name (or tenant/project leading into it)")
  .argument("[arg2]")
  .argument("[arg3]")
  .action(async (arg1?: string, arg2?: string, arg3?: string) => {
    const { tenant, project, service } = await resolveOrExit([arg1, arg2, arg3], ["tenant", "project", "service"]);
    await serviceLogsV2Action(tenant!, project!, service!);
  });
