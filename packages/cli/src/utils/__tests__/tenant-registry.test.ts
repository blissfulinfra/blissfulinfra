import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  tenantPortBlock,
  projectPortBlock,
  servicePorts,
  nextTenantIndex,
  nextProjectIndex,
  nextServiceIndex,
  MAX_TENANTS,
  MAX_PROJECTS_PER_TENANT,
  MAX_SERVICES_PER_PROJECT,
  registerTenant,
  registerProject,
  registerService,
  unregisterTenant,
  unregisterProject,
  unregisterService,
  listTenants,
  listProjects,
  listServices,
  getTenant,
  getProject,
  loadRegistry,
} from "../tenant-registry.js";
import type { TenantRegistry } from "@blissful-infra/shared";

describe("port math (pure)", () => {
  describe("tenantPortBlock", () => {
    it("tenantIndex 0 returns base ports", () => {
      const b = tenantPortBlock("acme", 0);
      expect(b).toMatchObject({
        dashboard: 3010, jenkins: 8081, grafana: 3000,
        prometheus: 9090, tempo: 3200, loki: 3100,
      });
    });

    it("tenantIndex N adds N to every port", () => {
      const b = tenantPortBlock("acme", 3);
      expect(b).toMatchObject({
        dashboard: 3013, jenkins: 8084, grafana: 3003,
        prometheus: 9093, tempo: 3203, loki: 3103,
      });
    });

    it("throws when tenantIndex exceeds cap", () => {
      expect(() => tenantPortBlock("acme", MAX_TENANTS)).toThrow();
    });
  });

  describe("projectPortBlock", () => {
    it("tenant 0 project 0 uses base ports", () => {
      const b = projectPortBlock("acme", "ecommerce", 0, 0);
      expect(b).toMatchObject({ kafka: 9092, postgres: 5432, redis: 6379, gateway: 8080, postgresExporter: 9187, kafkaExporter: 9308, redisExporter: 9121 });
    });

    it("project index offsets ports by 1 within the same tenant", () => {
      const a = projectPortBlock("acme", "ecommerce", 0, 0);
      const b = projectPortBlock("acme", "logistics", 0, 1);
      expect(b.kafka).toBe(a.kafka + 1);
      expect(b.postgres).toBe(a.postgres + 1);
      expect(b.gateway).toBe(a.gateway + 1);
    });

    it("tenant index shifts the project range by MAX_PROJECTS_PER_TENANT", () => {
      const a = projectPortBlock("acme", "ecommerce", 0, 0);
      const b = projectPortBlock("zeta", "ecommerce", 1, 0);
      expect(b.kafka).toBe(a.kafka + MAX_PROJECTS_PER_TENANT);
    });

    it("throws when projectIndex exceeds cap", () => {
      expect(() => projectPortBlock("acme", "x", 0, MAX_PROJECTS_PER_TENANT)).toThrow();
    });
  });

  describe("servicePorts", () => {
    it("backend service gets an http port and a metrics port", () => {
      const p = servicePorts("acme", "ecommerce", "api", "backend", 0, 0, 0);
      expect(p.http).toBe(30000);
      expect(p.metrics).toBe(34000);
    });

    it("worker service has no http port but still gets metrics", () => {
      const p = servicePorts("acme", "ecommerce", "worker", "worker", 0, 0, 0);
      expect(p.http).toBeUndefined();
      expect(p.metrics).toBe(34000);
    });

    it("service index offset is the lowest-order term", () => {
      const a = servicePorts("acme", "ecommerce", "a", "backend", 0, 0, 0);
      const b = servicePorts("acme", "ecommerce", "b", "backend", 0, 0, 1);
      expect(b.http).toBe((a.http ?? 0) + 1);
    });

    it("project index offset is MAX_SERVICES_PER_PROJECT", () => {
      const a = servicePorts("acme", "p0", "a", "backend", 0, 0, 0);
      const b = servicePorts("acme", "p1", "a", "backend", 0, 1, 0);
      expect(b.http).toBe((a.http ?? 0) + MAX_SERVICES_PER_PROJECT);
    });

    it("tenant index offset is MAX_PROJECTS_PER_TENANT * MAX_SERVICES_PER_PROJECT", () => {
      const a = servicePorts("a", "p", "s", "backend", 0, 0, 0);
      const b = servicePorts("z", "p", "s", "backend", 1, 0, 0);
      expect(b.http).toBe((a.http ?? 0) + MAX_PROJECTS_PER_TENANT * MAX_SERVICES_PER_PROJECT);
    });

    it("throws when serviceIndex exceeds cap", () => {
      expect(() => servicePorts("a", "p", "s", "backend", 0, 0, MAX_SERVICES_PER_PROJECT)).toThrow();
    });
  });
});

describe("nextTenantIndex / nextProjectIndex / nextServiceIndex", () => {
  const emptyRegistry: TenantRegistry = { version: 1, tenants: [] };

  it("nextTenantIndex returns 0 for the first tenant", () => {
    expect(nextTenantIndex(emptyRegistry, "acme")).toBe(0);
  });

  it("nextTenantIndex returns existing index if tenant already registered (idempotent)", () => {
    const r: TenantRegistry = {
      version: 1,
      tenants: [{
        name: "acme",
        portBlock: tenantPortBlock("acme", 0),
        projects: [],
      }],
    };
    expect(nextTenantIndex(r, "acme")).toBe(0);
  });

  it("nextTenantIndex fills gaps left by removed tenants", () => {
    const r: TenantRegistry = {
      version: 1,
      tenants: [
        { name: "acme", portBlock: tenantPortBlock("acme", 0), projects: [] },
        { name: "zeta", portBlock: tenantPortBlock("zeta", 2), projects: [] },
      ],
    };
    expect(nextTenantIndex(r, "new")).toBe(1);
  });

  it("nextProjectIndex returns 0 for an empty tenant", () => {
    const tenant = { name: "acme", portBlock: tenantPortBlock("acme", 0), projects: [] };
    expect(nextProjectIndex(tenant, "ecommerce")).toBe(0);
  });

  it("nextServiceIndex returns the array length for new services", () => {
    const p = {
      name: "ecommerce",
      portBlock: projectPortBlock("acme", "ecommerce", 0, 0),
      services: [{
        name: "api",
        type: "backend" as const,
        ports: servicePorts("acme", "ecommerce", "api", "backend", 0, 0, 0),
      }],
    };
    expect(nextServiceIndex(p, "web")).toBe(1);
  });
});

describe("registry persistence (mkdtemp BLISSFUL_HOME)", () => {
  let tmp: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "blissful-test-"));
    originalHome = process.env.BLISSFUL_HOME;
    process.env.BLISSFUL_HOME = tmp;
  });

  afterEach(async () => {
    if (originalHome !== undefined) process.env.BLISSFUL_HOME = originalHome;
    else delete process.env.BLISSFUL_HOME;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("loadRegistry returns an empty registry when no file exists", async () => {
    const r = await loadRegistry();
    expect(r.tenants).toEqual([]);
    expect(r.version).toBe(1);
  });

  it("registerTenant persists and is idempotent", async () => {
    const first = await registerTenant("acme");
    const second = await registerTenant("acme");
    expect(first.portBlock.blockIndex).toBe(0);
    expect(second.portBlock.blockIndex).toBe(0);
    const tenants = await listTenants();
    expect(tenants).toHaveLength(1);
  });

  it("two tenants get different blockIndex values", async () => {
    const a = await registerTenant("acme");
    const b = await registerTenant("zeta");
    expect(a.portBlock.blockIndex).toBe(0);
    expect(b.portBlock.blockIndex).toBe(1);
    expect(a.portBlock.dashboard).not.toBe(b.portBlock.dashboard);
  });

  it("registerProject requires the tenant to exist", async () => {
    await expect(registerProject("ghost", "ecommerce")).rejects.toThrow(/not found/);
  });

  it("registers a tenant → project → service end-to-end", async () => {
    await registerTenant("acme");
    const proj = await registerProject("acme", "ecommerce");
    expect(proj.portBlock.projectIndex).toBe(0);
    expect(proj.portBlock.kafka).toBe(9092);
    const svc = await registerService("acme", "ecommerce", "orders-api", "backend");
    expect(svc.type).toBe("backend");
    expect(svc.ports.http).toBe(30000);
    expect(svc.ports.metrics).toBe(34000);
  });

  it("services within a project get sequential ports", async () => {
    await registerTenant("acme");
    await registerProject("acme", "ecommerce");
    const a = await registerService("acme", "ecommerce", "api", "backend");
    const b = await registerService("acme", "ecommerce", "web", "frontend");
    expect((b.ports.http ?? 0) - (a.ports.http ?? 0)).toBe(1);
  });

  it("unregisterTenant removes the tenant entirely", async () => {
    await registerTenant("acme");
    await registerProject("acme", "ecommerce");
    await unregisterTenant("acme");
    const t = await getTenant("acme");
    expect(t).toBeNull();
  });

  it("unregisterProject removes only the project", async () => {
    await registerTenant("acme");
    await registerProject("acme", "ecommerce");
    await registerProject("acme", "logistics");
    await unregisterProject("acme", "ecommerce");
    const projects = await listProjects("acme");
    expect(projects.map(p => p.name)).toEqual(["logistics"]);
  });

  it("unregisterService removes only the service", async () => {
    await registerTenant("acme");
    await registerProject("acme", "ecommerce");
    await registerService("acme", "ecommerce", "api", "backend");
    await registerService("acme", "ecommerce", "web", "frontend");
    await unregisterService("acme", "ecommerce", "api");
    const services = await listServices("acme", "ecommerce");
    expect(services.map(s => s.name)).toEqual(["web"]);
  });

  it("project ports are sub-allocated correctly within tenant", async () => {
    const t = await registerTenant("acme");
    const p1 = await registerProject("acme", "ecommerce");
    const p2 = await registerProject("acme", "logistics");
    expect(p1.portBlock.kafka).toBe(9092 + t.portBlock.blockIndex * MAX_PROJECTS_PER_TENANT);
    expect(p2.portBlock.kafka).toBe(p1.portBlock.kafka + 1);
  });

  it("getProject returns null for non-existent project", async () => {
    await registerTenant("acme");
    const p = await getProject("acme", "ghost");
    expect(p).toBeNull();
  });
});
