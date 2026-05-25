import { Command } from "commander";
import chalk from "chalk";
import { execa } from "execa";
import {
  listTenants,
  getTenant,
  getProject,
} from "../utils/tenant-registry.js";
import { readContext } from "../utils/context.js";
import type {
  RegistryTenantEntry,
  RegistryProjectEntry,
  RegistryServiceEntry,
} from "@blissful-infra/shared";

/**
 * `blissful-infra status` — context-aware overview.
 *
 * Three modes based on what the current context (or args) targets:
 *   - no context → list every tenant with rollup counts
 *   - tenant context → show that tenant's projects + counts
 *   - tenant + project context → show full tenant/project/service tree
 *
 * Container running state is queried once via `docker ps` and joined to the
 * registry data so the user sees "is this thing actually running" at a glance.
 */

interface ContainerInfo {
  name: string;
  state: string;
  status: string;
}

async function dockerPsAll(): Promise<ContainerInfo[]> {
  try {
    const { stdout } = await execa("docker", [
      "ps", "-a", "--no-trunc",
      "--format", "{{.Names}}|{{.State}}|{{.Status}}",
    ], { reject: false });
    return stdout.trim().split("\n").filter(Boolean).map(line => {
      const [name, state, status] = line.split("|");
      return { name, state, status };
    });
  } catch {
    return [];
  }
}

/** Count running infra containers for a tenant (anything matching `<tenant>-*`). */
function countTenantInfra(containers: ContainerInfo[], tenant: string): { running: number; total: number } {
  const matches = containers.filter(c => c.name.startsWith(`${tenant}-`));
  const running = matches.filter(c => c.state === "running").length;
  return { running, total: matches.length };
}

function serviceContainerName(tenant: string, project: string, service: string): string {
  return `${tenant}-${project}-${service}`;
}

function dot(state: "running" | "stopped" | "unknown"): string {
  if (state === "running") return chalk.green("●");
  if (state === "stopped") return chalk.red("●");
  return chalk.gray("●");
}

function projectInfraContainerStates(containers: ContainerInfo[], tenant: string, project: string): { running: number; total: number } {
  const prefix = `${tenant}-${project}-`;
  const matches = containers.filter(c => c.name.startsWith(prefix));
  const running = matches.filter(c => c.state === "running").length;
  return { running, total: matches.length };
}

export async function statusAction(name?: string): Promise<void> {
  const containers = await dockerPsAll();

  // Resolve which tenant + project to show, in priority order:
  //   1. explicit `name` arg (for backwards-compat with the legacy
  //      project-first invocation — treated as a tenant name)
  //   2. context file
  //   3. nothing → tenant-list overview
  const ctx = await readContext();
  const targetTenant = name ?? ctx.tenant;
  const targetProject = name ? undefined : ctx.project;

  if (!targetTenant) {
    await showAllTenants(containers);
    return;
  }

  const tenant = await getTenant(targetTenant);
  if (!tenant) {
    console.error(chalk.red(`Tenant '${targetTenant}' not found.`));
    console.error(chalk.dim("List known tenants:"));
    console.error(chalk.cyan("  blissful-infra tenant list"));
    process.exit(1);
  }

  if (!targetProject) {
    await showTenantDetail(tenant, containers);
    return;
  }

  const project = await getProject(targetTenant, targetProject);
  if (!project) {
    console.error(chalk.red(`Project '${targetProject}' not found in tenant '${targetTenant}'.`));
    process.exit(1);
  }

  await showProjectDetail(tenant, project, containers);
}

async function showAllTenants(containers: ContainerInfo[]): Promise<void> {
  const tenants = await listTenants();
  console.log();
  if (tenants.length === 0) {
    console.log(chalk.dim("No tenants registered."));
    console.log(chalk.dim("Get started with:"));
    console.log(chalk.cyan("  blissful-infra init"));
    console.log();
    return;
  }

  console.log(chalk.bold("Tenants:"));
  console.log();
  for (const t of tenants) {
    const counts = countTenantInfra(containers, t.name);
    const services = t.projects.reduce((sum, p) => sum + p.services.length, 0);
    const projects = t.projects.length;
    const stateDot = counts.total === 0 ? dot("unknown")
                   : counts.running === counts.total ? dot("running")
                   : counts.running === 0 ? dot("stopped")
                   : chalk.yellow("●");
    console.log(
      `  ${stateDot} ${chalk.bold(t.name).padEnd(24)} ` +
      chalk.dim(`block #${t.portBlock.blockIndex}  `) +
      chalk.dim(`${projects} project${projects === 1 ? "" : "s"}, ${services} service${services === 1 ? "" : "s"}  `) +
      chalk.dim(`${counts.running}/${counts.total} containers running`),
    );
  }
  console.log();
  console.log(chalk.dim("Select one for detail:"));
  console.log(chalk.cyan("  blissful-infra use <tenant>") + chalk.dim("       then `blissful-infra status`"));
  console.log(chalk.cyan("  blissful-infra status <tenant>") + chalk.dim("    one-shot"));
  console.log();
}

async function showTenantDetail(tenant: RegistryTenantEntry, containers: ContainerInfo[]): Promise<void> {
  const counts = countTenantInfra(containers, tenant.name);
  const totalServices = tenant.projects.reduce((sum, p) => sum + p.services.length, 0);

  console.log();
  console.log(chalk.bold(`Tenant: `) + chalk.cyan(tenant.name));
  console.log(chalk.dim(`  block #${tenant.portBlock.blockIndex}  ·  dashboard :${tenant.portBlock.dashboard}`));
  console.log(chalk.dim(`  containers ${counts.running}/${counts.total} running`));
  console.log();

  if (tenant.projects.length === 0) {
    console.log(chalk.dim("No projects yet."));
    console.log(chalk.cyan("  blissful-infra project create <name>"));
    console.log();
    return;
  }

  console.log(chalk.bold(`Projects (${tenant.projects.length}, ${totalServices} services):`));
  console.log();
  for (const p of tenant.projects) {
    const projectCounts = projectInfraContainerStates(containers, tenant.name, p.name);
    const stateDot = projectCounts.total === 0 ? dot("unknown")
                   : projectCounts.running === projectCounts.total ? dot("running")
                   : projectCounts.running === 0 ? dot("stopped")
                   : chalk.yellow("●");
    console.log(
      `  ${stateDot} ${chalk.bold(p.name).padEnd(24)} ` +
      chalk.dim(`kafka :${p.portBlock.kafka}  postgres :${p.portBlock.postgres}  redis :${p.portBlock.redis}  `) +
      chalk.dim(`${p.services.length} service${p.services.length === 1 ? "" : "s"}  `) +
      chalk.dim(`${projectCounts.running}/${projectCounts.total} running`),
    );
  }
  console.log();
  console.log(chalk.dim("Drill into one:"));
  console.log(chalk.cyan(`  blissful-infra use ${tenant.name}/<project>`) + chalk.dim("   then `blissful-infra status`"));
  console.log();
}

async function showProjectDetail(
  tenant: RegistryTenantEntry,
  project: RegistryProjectEntry,
  containers: ContainerInfo[],
): Promise<void> {
  console.log();
  console.log(chalk.bold("Tenant:  ") + chalk.cyan(tenant.name) + chalk.dim(`  · dashboard :${tenant.portBlock.dashboard}`));
  console.log(chalk.bold("Project: ") + chalk.cyan(project.name) + chalk.dim(`  · kafka :${project.portBlock.kafka}  postgres :${project.portBlock.postgres}  redis :${project.portBlock.redis}  gateway :${project.portBlock.gateway}`));
  console.log();

  // Project-level infra containers
  const infraContainers = ["kafka", "postgres", "redis", "gateway"]
    .map(role => ({
      role,
      container: containers.find(c => c.name === `${tenant.name}-${project.name}-${role}`),
    }));

  console.log(chalk.bold("Project infra:"));
  for (const { role, container } of infraContainers) {
    if (!container) {
      console.log(`  ${dot("unknown")} ${role.padEnd(18)} ${chalk.dim("not found")}`);
    } else {
      const state = container.state === "running" ? "running" : "stopped";
      console.log(`  ${dot(state)} ${role.padEnd(18)} ${chalk.dim(container.status)}`);
    }
  }
  console.log();

  if (project.services.length === 0) {
    console.log(chalk.dim("No services yet."));
    console.log(chalk.cyan("  blissful-infra service add <name> --type backend"));
    console.log();
    return;
  }

  console.log(chalk.bold(`Services (${project.services.length}):`));
  for (const s of project.services) {
    renderServiceLine(tenant, project, s, containers);
  }
  console.log();
}

function renderServiceLine(
  tenant: RegistryTenantEntry,
  project: RegistryProjectEntry,
  service: RegistryServiceEntry,
  containers: ContainerInfo[],
): void {
  const container = containers.find(c => c.name === serviceContainerName(tenant.name, project.name, service.name));
  const state = !container ? "unknown" : container.state === "running" ? "running" : "stopped";
  const port = service.ports.http ? `:${service.ports.http}` : "";
  console.log(
    `  ${dot(state)} ${chalk.bold(service.name).padEnd(20)} ` +
    chalk.dim(`[${service.type}]`.padEnd(12)) +
    chalk.dim(port.padEnd(8)) +
    chalk.dim(container?.status ?? "not running"),
  );
}

export const statusCommand = new Command("status")
  .description("Show context-aware status — tenants, projects, services with health")
  .argument("[name]", "Optional tenant name (one-shot, doesn't change context)")
  .action(async (name?: string) => {
    await statusAction(name);
  });
