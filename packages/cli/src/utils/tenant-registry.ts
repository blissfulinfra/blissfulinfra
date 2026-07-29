import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import {
  ProjectConfigSchema,
  type ProjectConfig,
  type ProjectRuntime,
  ServiceConfigV2Schema,
  type ServiceConfigV2,
  TenantRegistrySchema,
  type TenantRegistry,
  type RegistryTenantEntry,
  type RegistryProjectEntry,
  type RegistryServiceEntry,
  type TenantPortBlock,
  type ProjectPortBlock,
  type ServicePorts,
  type ServiceType,
} from "@blissful-infra/shared";

// ─── Path helpers ────────────────────────────────────────────────────────────
// Resolved on every call so tests can override via BLISSFUL_HOME (mkdtemp).

export function getBlissfulHome(): string {
  return process.env.BLISSFUL_HOME ?? path.join(os.homedir(), ".blissful-infra");
}

export function getTenantsDir(): string {
  return path.join(getBlissfulHome(), "tenants");
}

export function getTenantDir(tenant: string): string {
  return path.join(getTenantsDir(), tenant);
}

export function getProjectsDir(tenant: string): string {
  return path.join(getTenantDir(tenant), "projects");
}

export function getProjectDir(tenant: string, project: string): string {
  return path.join(getProjectsDir(tenant), project);
}

export function getServicesDir(tenant: string, project: string): string {
  return path.join(getProjectDir(tenant, project), "services");
}

export function getServiceDir(tenant: string, project: string, service: string): string {
  return path.join(getServicesDir(tenant, project), service);
}

/** Terraform workspace for the tenant's kind cluster (ADR-0020). */
export function getClusterDir(tenant: string): string {
  return path.join(getTenantDir(tenant), "cluster");
}

function getRegistryPath(): string {
  return path.join(getBlissfulHome(), "registry.json");
}

// ─── Port math (pure) ────────────────────────────────────────────────────────
// Locked by ADR-0017. Each level sub-allocates inside its parent's slot so
// collisions are impossible below the documented caps:
//
//   10 tenants × 10 projects/tenant × 20 services/project

export const MAX_TENANTS = 10;
export const MAX_PROJECTS_PER_TENANT = 10;
export const MAX_SERVICES_PER_PROJECT = 20;

const TENANT_BASES = {
  dashboard:  3010,
  jenkins:    8081,
  grafana:    3000,
  prometheus: 9090,
  tempo:      3200,
  loki:       3100,
  // Kubernetes runtime (ADR-0020): kind API server, ArgoCD UI, Gitea.
  // Bases chosen clear of every existing range (grafana 3000s, dashboard
  // 3010s, loki 3100s, tempo 3200s, gateway 8080-8179, kafkaExporter 9308+,
  // service http 30000+) and of Docker Desktop's own 6443.
  kubeApi: 6550,
  argocd:  8440,
  gitea:   3300,
} as const;

const PROJECT_BASES = {
  kafka:    9092,
  postgres: 5432,
  redis:    6379,
  gateway:  8080,
  // Exporter sidecars — chosen at the standard upstream ports for each.
  postgresExporter: 9187,
  kafkaExporter:    9308,
  redisExporter:    9121,
} as const;

const SERVICE_BASES = {
  http:    30000,
  metrics: 34000,
} as const;

export function tenantPortBlock(tenant: string, tenantIndex: number): TenantPortBlock {
  if (tenantIndex < 0 || tenantIndex >= MAX_TENANTS) {
    throw new Error(`tenantIndex ${tenantIndex} out of range (0..${MAX_TENANTS - 1})`);
  }
  return {
    tenant,
    blockIndex: tenantIndex,
    dashboard:  TENANT_BASES.dashboard  + tenantIndex,
    jenkins:    TENANT_BASES.jenkins    + tenantIndex,
    grafana:    TENANT_BASES.grafana    + tenantIndex,
    prometheus: TENANT_BASES.prometheus + tenantIndex,
    tempo:      TENANT_BASES.tempo      + tenantIndex,
    loki:       TENANT_BASES.loki       + tenantIndex,
    kubeApi:    TENANT_BASES.kubeApi    + tenantIndex,
    argocd:     TENANT_BASES.argocd     + tenantIndex,
    gitea:      TENANT_BASES.gitea      + tenantIndex,
  };
}

/**
 * Cluster ports for a tenant, lazily backfilled: registry entries created
 * before the k8s runtime existed lack kubeApi/argocd/gitea — derive them from
 * the blockIndex, persist, and return the full block. Idempotent.
 */
export async function ensureClusterPorts(tenant: string): Promise<TenantPortBlock> {
  const registry = await loadRegistry();
  const entry = registry.tenants.find(t => t.name === tenant);
  if (!entry) {
    throw new Error(`Tenant '${tenant}' not found in registry.`);
  }
  const block = entry.portBlock;
  if (block.kubeApi && block.argocd && block.gitea) return block;

  block.kubeApi = TENANT_BASES.kubeApi + block.blockIndex;
  block.argocd  = TENANT_BASES.argocd  + block.blockIndex;
  block.gitea   = TENANT_BASES.gitea   + block.blockIndex;
  await saveRegistry(registry);
  return block;
}

export function projectPortBlock(
  tenant: string,
  project: string,
  tenantIndex: number,
  projectIndex: number,
): ProjectPortBlock {
  if (projectIndex < 0 || projectIndex >= MAX_PROJECTS_PER_TENANT) {
    throw new Error(`projectIndex ${projectIndex} out of range (0..${MAX_PROJECTS_PER_TENANT - 1})`);
  }
  const offset = tenantIndex * MAX_PROJECTS_PER_TENANT + projectIndex;
  return {
    tenant,
    project,
    projectIndex,
    kafka:    PROJECT_BASES.kafka    + offset,
    postgres: PROJECT_BASES.postgres + offset,
    redis:    PROJECT_BASES.redis    + offset,
    gateway:  PROJECT_BASES.gateway  + offset,
    postgresExporter: PROJECT_BASES.postgresExporter + offset,
    kafkaExporter:    PROJECT_BASES.kafkaExporter    + offset,
    redisExporter:    PROJECT_BASES.redisExporter    + offset,
  };
}

export function servicePorts(
  tenant: string,
  project: string,
  service: string,
  type: ServiceType,
  tenantIndex: number,
  projectIndex: number,
  serviceIndex: number,
): ServicePorts {
  if (serviceIndex < 0 || serviceIndex >= MAX_SERVICES_PER_PROJECT) {
    throw new Error(`serviceIndex ${serviceIndex} out of range (0..${MAX_SERVICES_PER_PROJECT - 1})`);
  }
  const offset =
    tenantIndex * MAX_PROJECTS_PER_TENANT * MAX_SERVICES_PER_PROJECT
    + projectIndex * MAX_SERVICES_PER_PROJECT
    + serviceIndex;

  // Workers usually don't expose HTTP; backend and frontend do. Metrics is
  // optional everywhere — we reserve a slot anyway so wiring it later
  // doesn't shift other ports.
  const ports: ServicePorts = { tenant, project, service };
  if (type === "backend" || type === "frontend") {
    ports.http = SERVICE_BASES.http + offset;
  }
  ports.metrics = SERVICE_BASES.metrics + offset;
  return ports;
}

// ─── Registry I/O ────────────────────────────────────────────────────────────

export async function loadRegistry(): Promise<TenantRegistry> {
  const file = getRegistryPath();
  try {
    const raw = await fs.readFile(file, "utf-8");
    return TenantRegistrySchema.parse(JSON.parse(raw));
  } catch {
    return TenantRegistrySchema.parse({ tenants: [] });
  }
}

export async function saveRegistry(registry: TenantRegistry): Promise<void> {
  const file = getRegistryPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const validated = TenantRegistrySchema.parse(registry);
  await fs.writeFile(file, JSON.stringify(validated, null, 2), "utf-8");
}

// ─── Registry mutation helpers ───────────────────────────────────────────────

/**
 * Find the next free tenantIndex. If the tenant already exists, returns its
 * existing index (idempotent).
 */
export function nextTenantIndex(registry: TenantRegistry, tenant: string): number {
  const existing = registry.tenants.find(t => t.name === tenant);
  if (existing) return existing.portBlock.blockIndex;
  const taken = new Set(registry.tenants.map(t => t.portBlock.blockIndex));
  for (let i = 0; i < MAX_TENANTS; i++) {
    if (!taken.has(i)) return i;
  }
  throw new Error(`No free tenant slot — cap is ${MAX_TENANTS}`);
}

export function nextProjectIndex(tenant: RegistryTenantEntry, project: string): number {
  const existing = tenant.projects.find(p => p.name === project);
  if (existing) return existing.portBlock.projectIndex;
  const taken = new Set(tenant.projects.map(p => p.portBlock.projectIndex));
  for (let i = 0; i < MAX_PROJECTS_PER_TENANT; i++) {
    if (!taken.has(i)) return i;
  }
  throw new Error(`No free project slot in tenant '${tenant.name}' — cap is ${MAX_PROJECTS_PER_TENANT}`);
}

export function nextServiceIndex(project: RegistryProjectEntry, service: string): number {
  const existing = project.services.findIndex(s => s.name === service);
  if (existing >= 0) return existing;
  // serviceIndex is the position in the array — since we don't store an
  // explicit index, the next free slot is just .length until we hit the cap.
  if (project.services.length >= MAX_SERVICES_PER_PROJECT) {
    throw new Error(`No free service slot in project '${project.name}' — cap is ${MAX_SERVICES_PER_PROJECT}`);
  }
  return project.services.length;
}

/**
 * Register a tenant, allocating its port block if it's new. Idempotent: if the
 * tenant already exists, returns the existing entry unchanged.
 */
export async function registerTenant(tenant: string): Promise<RegistryTenantEntry> {
  const registry = await loadRegistry();
  const existing = registry.tenants.find(t => t.name === tenant);
  if (existing) return existing;

  const tenantIndex = nextTenantIndex(registry, tenant);
  const entry: RegistryTenantEntry = {
    name: tenant,
    portBlock: tenantPortBlock(tenant, tenantIndex),
    projects: [],
  };
  registry.tenants.push(entry);
  await saveRegistry(registry);
  return entry;
}

export async function registerProject(tenant: string, project: string): Promise<RegistryProjectEntry> {
  const registry = await loadRegistry();
  const tenantEntry = registry.tenants.find(t => t.name === tenant);
  if (!tenantEntry) {
    throw new Error(`Tenant '${tenant}' not found. Create it first.`);
  }
  const existing = tenantEntry.projects.find(p => p.name === project);
  if (existing) return existing;

  const projectIndex = nextProjectIndex(tenantEntry, project);
  const entry: RegistryProjectEntry = {
    name: project,
    portBlock: projectPortBlock(tenant, project, tenantEntry.portBlock.blockIndex, projectIndex),
    services: [],
  };
  tenantEntry.projects.push(entry);
  await saveRegistry(registry);
  return entry;
}

export async function registerService(
  tenant: string,
  project: string,
  service: string,
  type: ServiceType,
): Promise<RegistryServiceEntry> {
  const registry = await loadRegistry();
  const tenantEntry = registry.tenants.find(t => t.name === tenant);
  if (!tenantEntry) throw new Error(`Tenant '${tenant}' not found.`);
  const projectEntry = tenantEntry.projects.find(p => p.name === project);
  if (!projectEntry) throw new Error(`Project '${project}' not found in tenant '${tenant}'.`);

  const existing = projectEntry.services.find(s => s.name === service);
  if (existing) return existing;

  const serviceIndex = nextServiceIndex(projectEntry, service);
  const entry: RegistryServiceEntry = {
    name: service,
    type,
    ports: servicePorts(
      tenant, project, service, type,
      tenantEntry.portBlock.blockIndex,
      projectEntry.portBlock.projectIndex,
      serviceIndex,
    ),
  };
  projectEntry.services.push(entry);
  await saveRegistry(registry);
  return entry;
}

export async function unregisterTenant(tenant: string): Promise<void> {
  const registry = await loadRegistry();
  registry.tenants = registry.tenants.filter(t => t.name !== tenant);
  await saveRegistry(registry);
}

export async function unregisterProject(tenant: string, project: string): Promise<void> {
  const registry = await loadRegistry();
  const tenantEntry = registry.tenants.find(t => t.name === tenant);
  if (!tenantEntry) return;
  tenantEntry.projects = tenantEntry.projects.filter(p => p.name !== project);
  await saveRegistry(registry);
}

export async function unregisterService(tenant: string, project: string, service: string): Promise<void> {
  const registry = await loadRegistry();
  const tenantEntry = registry.tenants.find(t => t.name === tenant);
  if (!tenantEntry) return;
  const projectEntry = tenantEntry.projects.find(p => p.name === project);
  if (!projectEntry) return;
  projectEntry.services = projectEntry.services.filter(s => s.name !== service);
  await saveRegistry(registry);
}

// ─── Lookup helpers ──────────────────────────────────────────────────────────

export async function listTenants(): Promise<RegistryTenantEntry[]> {
  const registry = await loadRegistry();
  return registry.tenants;
}

export async function getTenant(tenant: string): Promise<RegistryTenantEntry | null> {
  const registry = await loadRegistry();
  return registry.tenants.find(t => t.name === tenant) ?? null;
}

export async function listProjects(tenant: string): Promise<RegistryProjectEntry[]> {
  const t = await getTenant(tenant);
  return t?.projects ?? [];
}

export async function getProject(tenant: string, project: string): Promise<RegistryProjectEntry | null> {
  const projects = await listProjects(tenant);
  return projects.find(p => p.name === project) ?? null;
}

export async function listServices(tenant: string, project: string): Promise<RegistryServiceEntry[]> {
  const p = await getProject(tenant, project);
  return p?.services ?? [];
}

export async function getService(tenant: string, project: string, service: string): Promise<RegistryServiceEntry | null> {
  const services = await listServices(tenant, project);
  return services.find(s => s.name === service) ?? null;
}

/**
 * Find which project inside a tenant owns a service with this name.
 * Returns the first match (service names are unique per project, not per
 * tenant — ambiguity is resolved by passing an explicit project).
 */
export async function findServiceProject(
  tenant: string,
  service: string,
): Promise<{ project: string; service: RegistryServiceEntry } | null> {
  for (const p of await listProjects(tenant)) {
    const match = p.services.find(s => s.name === service);
    if (match) return { project: p.name, service: match };
  }
  return null;
}

/** Parse projects/<project>/project.yaml (throws if missing or invalid). */
export async function readProjectConfig(tenant: string, project: string): Promise<ProjectConfig> {
  const raw = await fs.readFile(path.join(getProjectDir(tenant, project), "project.yaml"), "utf-8");
  return ProjectConfigSchema.parse(yaml.load(raw));
}

/** Parse services/<service>/service.yaml (throws if missing or invalid). */
export async function readServiceConfig(
  tenant: string,
  project: string,
  service: string,
): Promise<ServiceConfigV2> {
  const raw = await fs.readFile(path.join(getServiceDir(tenant, project, service), "service.yaml"), "utf-8");
  return ServiceConfigV2Schema.parse(yaml.load(raw));
}

/** Rewrite service.yaml, preserving every field the caller didn't change. */
export async function writeServiceConfig(config: ServiceConfigV2): Promise<void> {
  const file = path.join(getServiceDir(config.tenant, config.project, config.name), "service.yaml");
  await fs.writeFile(file, yaml.dump(ServiceConfigV2Schema.parse(config)), "utf-8");
}

/** The project's runtime; defaults to compose when the config is unreadable. */
export async function readProjectRuntime(tenant: string, project: string): Promise<ProjectRuntime> {
  try {
    return (await readProjectConfig(tenant, project)).runtime;
  } catch {
    return "compose";
  }
}
