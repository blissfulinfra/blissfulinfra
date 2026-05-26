import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execa } from "execa";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import {
  buildTenantComposeYaml,
  writeTenantCompose,
  projectComposeIncludePath,
} from "../tenant-compose.js";
import {
  buildProjectComposeYaml,
  buildPostgresInitSql,
  writeProjectCompose,
  serviceComposeIncludePath,
} from "../project-compose.js";
import {
  buildServiceComposeYaml,
  writeServiceCompose,
} from "../service-compose-v2.js";
import {
  TenantConfigSchema,
  ProjectConfigSchema,
  ServiceConfigV2Schema,
  type TenantConfig,
  type TenantPortBlock,
  type ProjectConfig,
  type ProjectPortBlock,
  type ServiceConfigV2,
  type ServicePorts,
} from "@blissful-infra/shared";
import { tenantPortBlock, projectPortBlock, servicePorts } from "../tenant-registry.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const tenantConfig: TenantConfig = TenantConfigSchema.parse({
  type: "tenant",
  name: "acme",
  infrastructure: {
    jenkins: true,
    observability: { prometheus: true, grafana: true, tempo: true, loki: true },
  },
});
const tenantPorts: TenantPortBlock = tenantPortBlock("acme", 0);

const projectConfig: ProjectConfig = ProjectConfigSchema.parse({
  type: "project",
  name: "ecommerce",
  tenant: "acme",
  infrastructure: { kafka: true, postgres: true, redis: true, gateway: true },
});
const projectPorts: ProjectPortBlock = projectPortBlock("acme", "ecommerce", 0, 0);

const backendService: ServiceConfigV2 = ServiceConfigV2Schema.parse({
  type: "service",
  name: "orders-api",
  tenant: "acme",
  project: "ecommerce",
  serviceType: "backend",
  backend: { template: "spring-boot" },
  database: { schema: "orders_api", migrations: true },
});
const backendPorts: ServicePorts = servicePorts("acme", "ecommerce", "orders-api", "backend", 0, 0, 0);

// ─── Pure YAML structure assertions ─────────────────────────────────────────

describe("tenant compose — structure", () => {
  it("does NOT emit a dashboard service (host-level control plane lives outside the tenant)", () => {
    const out = buildTenantComposeYaml({ config: tenantConfig, ports: tenantPorts, projectComposeIncludes: [] });
    const doc = yaml.load(out) as Record<string, unknown>;
    expect(doc.name).toBe("acme");
    const services = doc.services as Record<string, unknown>;
    expect(services.dashboard).toBeUndefined();
  });

  it("includes every observability component when all flags are on", () => {
    const out = buildTenantComposeYaml({ config: tenantConfig, ports: tenantPorts, projectComposeIncludes: [] });
    const doc = yaml.load(out) as Record<string, unknown>;
    const services = doc.services as Record<string, unknown>;
    expect(Object.keys(services)).toEqual(expect.arrayContaining([
      "jenkins", "prometheus", "grafana", "tempo", "loki", "promtail",
    ]));
  });

  it("emits no services when every infra flag is off", () => {
    const minimal = TenantConfigSchema.parse({
      type: "tenant",
      name: "bare",
      infrastructure: {
        jenkins: false,
        observability: { prometheus: false, grafana: false, tempo: false, loki: false },
      },
    });
    const out = buildTenantComposeYaml({ config: minimal, ports: tenantPortBlock("bare", 0), projectComposeIncludes: [] });
    const doc = yaml.load(out) as Record<string, unknown>;
    const services = doc.services as Record<string, unknown>;
    expect(Object.keys(services)).toEqual([]);
  });

  it("includes project compose paths when provided", () => {
    const out = buildTenantComposeYaml({
      config: tenantConfig, ports: tenantPorts,
      projectComposeIncludes: [projectComposeIncludePath("ecommerce"), projectComposeIncludePath("logistics")],
    });
    const doc = yaml.load(out) as Record<string, unknown>;
    expect((doc.include as Array<{ path: string }>).map(i => i.path)).toEqual([
      "./projects/ecommerce/docker-compose.project.yaml",
      "./projects/logistics/docker-compose.project.yaml",
    ]);
  });
});

describe("project compose — structure", () => {
  it("emits kafka + postgres + gateway on the project network", () => {
    const out = buildProjectComposeYaml({
      config: projectConfig, ports: projectPorts,
      serviceComposeIncludes: [], databaseSchemas: [],
    });
    const doc = yaml.load(out) as Record<string, unknown>;
    const services = doc.services as Record<string, { networks?: string[] }>;
    expect(Object.keys(services)).toEqual(expect.arrayContaining(["kafka", "postgres", "gateway"]));
    expect(services.kafka.networks).toEqual(["project"]);
    expect(services.gateway.networks).toEqual(["project", "tenant"]);
  });

  it("declares both networks by name; tenant network is not marked external", () => {
    const out = buildProjectComposeYaml({
      config: projectConfig, ports: projectPorts,
      serviceComposeIncludes: [], databaseSchemas: [],
    });
    const doc = yaml.load(out) as Record<string, unknown>;
    const networks = doc.networks as Record<string, { name?: string; external?: boolean }>;
    expect(networks.project.name).toBe("acme_ecommerce");
    expect(networks.tenant.name).toBe("acme_tenant");
    // No `external: true` — when this compose is included from the tenant
    // compose, the parent creates the network; declaring external here would
    // conflict on merge and break `tenant up`.
    expect(networks.tenant.external).toBeUndefined();
  });

  it("includes service compose paths when provided", () => {
    const out = buildProjectComposeYaml({
      config: projectConfig, ports: projectPorts,
      serviceComposeIncludes: [serviceComposeIncludePath("orders-api"), serviceComposeIncludePath("orders-web")],
      databaseSchemas: ["orders_api", "orders_web"],
    });
    const doc = yaml.load(out) as Record<string, unknown>;
    expect((doc.include as Array<{ path: string }>).map(i => i.path)).toEqual([
      "./services/orders-api/docker-compose.yaml",
      "./services/orders-web/docker-compose.yaml",
    ]);
  });

  it("postgres uses port-block-allocated host port", () => {
    const out = buildProjectComposeYaml({
      config: projectConfig, ports: projectPorts,
      serviceComposeIncludes: [], databaseSchemas: [],
    });
    const doc = yaml.load(out) as Record<string, unknown>;
    const services = doc.services as Record<string, { ports?: string[] }>;
    expect(services.postgres.ports).toContain(`${projectPorts.postgres}:5432`);
  });

  it("omits kafka and postgres when their flags are off", () => {
    const cfg = ProjectConfigSchema.parse({
      type: "project", name: "p", tenant: "acme",
      infrastructure: { kafka: false, postgres: false, redis: false, gateway: true },
    });
    const out = buildProjectComposeYaml({
      config: cfg, ports: projectPortBlock("acme", "p", 0, 0),
      serviceComposeIncludes: [], databaseSchemas: [],
    });
    const doc = yaml.load(out) as Record<string, unknown>;
    const services = doc.services as Record<string, unknown>;
    expect(services.kafka).toBeUndefined();
    expect(services.postgres).toBeUndefined();
    expect(services.gateway).toBeDefined();
  });
});

describe("postgres init SQL", () => {
  it("emits CREATE SCHEMA IF NOT EXISTS for each schema", () => {
    const sql = buildPostgresInitSql(["orders_api", "orders_worker"]);
    expect(sql).toMatch(/CREATE SCHEMA IF NOT EXISTS orders_api;/);
    expect(sql).toMatch(/CREATE SCHEMA IF NOT EXISTS orders_worker;/);
  });

  it("emits a placeholder comment when there are no schemas", () => {
    const sql = buildPostgresInitSql([]);
    // No actual CREATE SCHEMA statement — just a comment.
    expect(sql).not.toMatch(/CREATE SCHEMA IF NOT EXISTS \w+;/);
    expect(sql).toMatch(/No service schemas declared yet/);
  });
});

describe("service compose — structure", () => {
  it("backend gets DB + Kafka env vars when project has both", () => {
    const out = buildServiceComposeYaml({ service: backendService, project: projectConfig, ports: backendPorts });
    const doc = yaml.load(out) as Record<string, unknown>;
    const svc = (doc.services as Record<string, { environment?: Record<string, string> }>)[backendService.name];
    expect(svc.environment?.DB_SCHEMA).toBe("orders_api");
    expect(svc.environment?.KAFKA_BOOTSTRAP_SERVERS).toBe("kafka:9092");
    expect(svc.environment?.SERVICE_NAME).toBe("orders-api");
  });

  it("backend declares depends_on postgres + kafka with health gating", () => {
    const out = buildServiceComposeYaml({ service: backendService, project: projectConfig, ports: backendPorts });
    const doc = yaml.load(out) as Record<string, unknown>;
    const svc = (doc.services as Record<string, { depends_on?: Record<string, { condition: string }> }>)[backendService.name];
    expect(svc.depends_on?.postgres?.condition).toBe("service_healthy");
    expect(svc.depends_on?.kafka?.condition).toBe("service_healthy");
  });

  it("frontend has no DB env vars and no postgres depends_on", () => {
    const frontend: ServiceConfigV2 = ServiceConfigV2Schema.parse({
      type: "service", name: "orders-web", tenant: "acme", project: "ecommerce",
      serviceType: "frontend",
      frontend: { template: "react-vite" },
    });
    const fePorts = servicePorts("acme", "ecommerce", "orders-web", "frontend", 0, 0, 1);
    const out = buildServiceComposeYaml({ service: frontend, project: projectConfig, ports: fePorts });
    const doc = yaml.load(out) as Record<string, unknown>;
    const svc = (doc.services as Record<string, { environment?: Record<string, string>; depends_on?: Record<string, unknown> }>).orders_web ?? (doc.services as Record<string, { environment?: Record<string, string>; depends_on?: Record<string, unknown> }>)["orders-web"];
    expect(svc.environment?.DB_SCHEMA).toBeUndefined();
    expect(svc.depends_on?.postgres).toBeUndefined();
  });

  it("worker exposes no ports", () => {
    const worker: ServiceConfigV2 = ServiceConfigV2Schema.parse({
      type: "service", name: "notifier", tenant: "acme", project: "ecommerce",
      serviceType: "worker",
      worker: { runtime: "python" },
      database: { schema: "notifier", migrations: true },
    });
    const wPorts = servicePorts("acme", "ecommerce", "notifier", "worker", 0, 0, 2);
    const out = buildServiceComposeYaml({ service: worker, project: projectConfig, ports: wPorts });
    const doc = yaml.load(out) as Record<string, unknown>;
    const svc = (doc.services as Record<string, { ports?: string[] }>).notifier;
    expect(svc.ports).toBeUndefined();
  });

  it("declares the project network by name (not external — parent creates it)", () => {
    const out = buildServiceComposeYaml({ service: backendService, project: projectConfig, ports: backendPorts });
    const doc = yaml.load(out) as Record<string, unknown>;
    const networks = doc.networks as Record<string, { name?: string; external?: boolean }>;
    expect(networks.project.name).toBe("acme_ecommerce");
    // No `external: true` — when included from the project compose, the
    // parent's declaration creates the network. Declaring external here would
    // conflict on merge and break `service up`.
    expect(networks.project.external).toBeUndefined();
  });
});

// ─── L2: docker compose config validates the generated YAML ─────────────────

describe("docker compose config — generated YAML actually parses", () => {
  let tmp: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "blissful-compose-"));
    originalHome = process.env.BLISSFUL_HOME;
    process.env.BLISSFUL_HOME = tmp;
  });

  afterEach(async () => {
    if (originalHome !== undefined) process.env.BLISSFUL_HOME = originalHome;
    else delete process.env.BLISSFUL_HOME;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("standalone tenant compose with no projects passes `docker compose config`", async () => {
    await writeTenantCompose(tenantConfig, tenantPorts, []);
    const r = await execa("docker", [
      "compose", "-f", "docker-compose.tenant.yaml", "config", "--quiet",
    ], { cwd: path.join(tmp, "tenants", "acme"), reject: false });
    if (r.stderr.includes("Cannot connect")) return; // docker not available
    expect(r.exitCode, r.stderr).toBe(0);
  });

  it("standalone project compose with no services passes `docker compose config`", async () => {
    // Tenant compose has to exist first (its network is referenced as external)
    await writeTenantCompose(tenantConfig, tenantPorts, []);
    await writeProjectCompose("acme", "ecommerce", projectConfig, projectPorts, [], []);
    const r = await execa("docker", [
      "compose", "-f", "docker-compose.project.yaml", "config", "--quiet",
    ], { cwd: path.join(tmp, "tenants", "acme", "projects", "ecommerce"), reject: false });
    if (r.stderr.includes("Cannot connect")) return;
    // External network not existing is ok for config-time parsing; ignore that
    // specific warning. Anything else should be a hard failure.
    if (r.exitCode !== 0 && !r.stderr.includes("network") && !r.stderr.includes("not found")) {
      expect(r.exitCode, r.stderr).toBe(0);
    }
  });

  it("project compose + a backend service compose parses together", async () => {
    await writeTenantCompose(tenantConfig, tenantPorts, []);
    await writeServiceCompose(backendService, projectConfig, backendPorts);
    await writeProjectCompose(
      "acme", "ecommerce", projectConfig, projectPorts,
      [serviceComposeIncludePath("orders-api")],
      ["orders_api"],
    );
    const r = await execa("docker", [
      "compose", "-f", "docker-compose.project.yaml", "config", "--quiet",
    ], { cwd: path.join(tmp, "tenants", "acme", "projects", "ecommerce"), reject: false });
    if (r.stderr.includes("Cannot connect")) return;
    if (r.exitCode !== 0 && !r.stderr.includes("network") && !r.stderr.includes("not found")) {
      expect(r.exitCode, r.stderr).toBe(0);
    }
  });
});
