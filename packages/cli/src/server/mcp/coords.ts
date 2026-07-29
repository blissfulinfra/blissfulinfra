/**
 * Coordinate resolution for MCP tools.
 *
 * Every tool takes optional `tenant` / `project` / `service` arguments and
 * fills the gaps from the `use` context. Unlike the CLI's `resolveArgs`, which
 * exits the process on failure, these throw with a message that tells the
 * calling agent exactly which names ARE valid — an agent cannot see the
 * terminal, so an error is its only chance to self-correct.
 *
 * Context is read on every call (never cached): the user can run
 * `blissful-infra use <other-tenant>` while the MCP server is still running.
 */

import { readContext } from "../../utils/context.js";
import {
  findServiceProject,
  getProject,
  getService,
  getTenant,
  listProjects,
  listServices,
  listTenants,
  readProjectRuntime,
} from "../../utils/tenant-registry.js";
import type { ProjectRuntime } from "@blissful-infra/shared";

export class CoordinateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoordinateError";
  }
}

function nameList(names: string[]): string {
  return names.length ? names.map(n => `'${n}'`).join(", ") : "(none)";
}

export interface TenantCoord {
  tenant: string;
}

export interface ProjectCoord extends TenantCoord {
  project: string;
}

export interface ServiceCoord extends ProjectCoord {
  service: string;
}

/**
 * Tenant precedence: explicit arg → BLISSFUL_TENANT → `use` context → the sole
 * registered tenant. A single-tenant setup should never need to name itself.
 */
export async function resolveTenant(explicit?: string): Promise<string> {
  const candidate = explicit ?? process.env.BLISSFUL_TENANT ?? (await readContext()).tenant;
  const tenants = await listTenants();

  if (candidate) {
    if (await getTenant(candidate)) return candidate;
    throw new CoordinateError(
      `Tenant '${candidate}' is not in the registry. Known tenants: ${nameList(tenants.map(t => t.name))}.\n` +
      `Create it with the create_tenant tool, or pass one of the names above.`,
    );
  }

  if (tenants.length === 1) return tenants[0].name;
  if (tenants.length === 0) {
    throw new CoordinateError(
      "No tenants exist yet. Create one with the create_tenant tool before calling this.",
    );
  }
  throw new CoordinateError(
    `No tenant selected and ${tenants.length} exist: ${nameList(tenants.map(t => t.name))}.\n` +
    `Pass the 'tenant' argument explicitly, or set a default with the set_context tool.`,
  );
}

/**
 * Project precedence: explicit arg → BLISSFUL_PROJECT → context (only when it
 * belongs to the resolved tenant) → the tenant's sole project.
 */
export async function resolveProject(explicitTenant?: string, explicitProject?: string): Promise<ProjectCoord> {
  const tenant = await resolveTenant(explicitTenant);
  const projects = await listProjects(tenant);

  if (explicitProject) {
    if (await getProject(tenant, explicitProject)) return { tenant, project: explicitProject };
    throw new CoordinateError(
      `Project '${explicitProject}' does not exist in tenant '${tenant}'. ` +
      `Known projects: ${nameList(projects.map(p => p.name))}.`,
    );
  }

  const ctx = await readContext();
  const fromContext = process.env.BLISSFUL_PROJECT ?? (ctx.tenant === tenant ? ctx.project : undefined);
  if (fromContext && (await getProject(tenant, fromContext))) return { tenant, project: fromContext };

  if (projects.length === 1) return { tenant, project: projects[0].name };
  if (projects.length === 0) {
    throw new CoordinateError(
      `Tenant '${tenant}' has no projects. Create one with the create_project tool.`,
    );
  }
  throw new CoordinateError(
    `No project selected and tenant '${tenant}' has ${projects.length}: ${nameList(projects.map(p => p.name))}.\n` +
    `Pass the 'project' argument explicitly.`,
  );
}

/**
 * Resolve a service to full coordinates.
 *
 * A service name is unique enough to search on: when `project` is omitted (or
 * names a project that doesn't own the service) the tenant is scanned. This is
 * the fix for the old behaviour, where a project name passed to a
 * service-scoped endpoint silently resolved to a nonexistent directory and
 * returned an empty success payload.
 */
export async function resolveService(
  service: string,
  explicitTenant?: string,
  explicitProject?: string,
): Promise<ServiceCoord> {
  const tenant = await resolveTenant(explicitTenant);

  if (explicitProject) {
    if (!(await getProject(tenant, explicitProject))) {
      const projects = await listProjects(tenant);
      throw new CoordinateError(
        `Project '${explicitProject}' does not exist in tenant '${tenant}'. ` +
        `Known projects: ${nameList(projects.map(p => p.name))}.`,
      );
    }
    if (await getService(tenant, explicitProject, service)) {
      return { tenant, project: explicitProject, service };
    }
  }

  const ctx = await readContext();
  const contextProject = ctx.tenant === tenant ? ctx.project : undefined;
  if (contextProject && (await getService(tenant, contextProject, service))) {
    return { tenant, project: contextProject, service };
  }

  const found = await findServiceProject(tenant, service);
  if (found) return { tenant, project: found.project, service };

  const projects = await listProjects(tenant);
  const all: string[] = [];
  for (const p of projects) {
    for (const s of await listServices(tenant, p.name)) all.push(`${p.name}/${s.name}`);
  }
  throw new CoordinateError(
    `No service named '${service}' in tenant '${tenant}'.\n` +
    `Known services (project/service): ${nameList(all)}.\n` +
    `Note: this argument takes a SERVICE name, not a project name. ` +
    `Use the get_context tool to see the full tenant/project/service tree.`,
  );
}

/** Runtime of the project owning a service — routes deploy and canary tools. */
export async function serviceRuntime(coords: ServiceCoord): Promise<ProjectRuntime> {
  return readProjectRuntime(coords.tenant, coords.project);
}

export function formatCoords(c: ServiceCoord): string {
  return `${c.tenant}/${c.project}/${c.service}`;
}
