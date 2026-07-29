import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import {
  CoordinateError,
  resolveProject,
  resolveService,
  resolveTenant,
} from "../coords.js";

/**
 * Each test gets its own BLISSFUL_HOME so the developer's real registry is
 * never read. The registry + service.yaml files are written directly rather
 * than going through the CLI, which keeps these tests at L1 speed.
 */

let home: string;
const originalHome = process.env.BLISSFUL_HOME;

interface ServiceSpec { name: string; type?: string }
interface ProjectSpec { name: string; services?: ServiceSpec[] }

async function seed(tenants: Array<{ name: string; projects?: ProjectSpec[] }>): Promise<void> {
  const registry = {
    version: 1,
    tenants: tenants.map((t, ti) => ({
      name: t.name,
      portBlock: {
        tenant: t.name, blockIndex: ti,
        dashboard: 3010 + ti, jenkins: 8081 + ti, grafana: 3000 + ti,
        prometheus: 9090 + ti, tempo: 3200 + ti, loki: 3100 + ti,
      },
      projects: (t.projects ?? []).map((p, pi) => ({
        name: p.name,
        portBlock: {
          tenant: t.name, project: p.name, projectIndex: pi,
          kafka: 9092 + pi, postgres: 5432 + pi, redis: 6379 + pi, gateway: 8080 + pi,
          postgresExporter: 9187 + pi, kafkaExporter: 9308 + pi, redisExporter: 9121 + pi,
        },
        services: (p.services ?? []).map((s, si) => ({
          name: s.name,
          type: s.type ?? "backend",
          ports: { tenant: t.name, project: p.name, service: s.name, http: 30000 + si, metrics: 34000 + si },
        })),
      })),
    })),
  };
  await fs.writeFile(path.join(home, "registry.json"), JSON.stringify(registry));

  for (const t of tenants) {
    for (const p of t.projects ?? []) {
      const dir = path.join(home, "tenants", t.name, "projects", p.name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "project.yaml"),
        yaml.dump({ type: "project", name: p.name, tenant: t.name, runtime: "compose" }),
      );
    }
  }
}

async function setContext(ctx: { tenant?: string; project?: string }): Promise<void> {
  await fs.writeFile(path.join(home, "context.json"), JSON.stringify(ctx));
}

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "blissful-coords-"));
  process.env.BLISSFUL_HOME = home;
  delete process.env.BLISSFUL_TENANT;
  delete process.env.BLISSFUL_PROJECT;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.BLISSFUL_HOME;
  else process.env.BLISSFUL_HOME = originalHome;
  await fs.rm(home, { recursive: true, force: true });
});

describe("resolveTenant", () => {
  it("uses the only tenant when none is named", async () => {
    await seed([{ name: "acme" }]);
    expect(await resolveTenant()).toBe("acme");
  });

  it("prefers the explicit argument over the context", async () => {
    await seed([{ name: "acme" }, { name: "other" }]);
    await setContext({ tenant: "acme" });
    expect(await resolveTenant("other")).toBe("other");
  });

  it("falls back to the context when no argument is given", async () => {
    await seed([{ name: "acme" }, { name: "other" }]);
    await setContext({ tenant: "other" });
    expect(await resolveTenant()).toBe("other");
  });

  it("re-reads the context on every call so `use` takes effect immediately", async () => {
    await seed([{ name: "acme" }, { name: "other" }]);
    await setContext({ tenant: "acme" });
    expect(await resolveTenant()).toBe("acme");
    await setContext({ tenant: "other" });
    expect(await resolveTenant()).toBe("other");
  });

  it("lists the real tenants when the name is unknown", async () => {
    await seed([{ name: "acme" }, { name: "other" }]);
    await expect(resolveTenant("nope")).rejects.toThrow(/Known tenants: 'acme', 'other'/);
  });

  it("errors when several tenants exist and none is selected", async () => {
    await seed([{ name: "acme" }, { name: "other" }]);
    await expect(resolveTenant()).rejects.toThrow(/No tenant selected and 2 exist/);
  });

  it("errors when the registry is empty", async () => {
    await seed([]);
    await expect(resolveTenant()).rejects.toThrow(/No tenants exist yet/);
  });
});

describe("resolveProject", () => {
  it("uses the only project when none is named", async () => {
    await seed([{ name: "acme", projects: [{ name: "shop" }] }]);
    expect(await resolveProject()).toEqual({ tenant: "acme", project: "shop" });
  });

  it("ignores a context project belonging to a different tenant", async () => {
    await seed([
      { name: "acme", projects: [{ name: "shop" }] },
      { name: "other", projects: [{ name: "blog" }] },
    ]);
    await setContext({ tenant: "other", project: "blog" });
    expect(await resolveProject("acme")).toEqual({ tenant: "acme", project: "shop" });
  });

  it("rejects an unknown project by name", async () => {
    await seed([{ name: "acme", projects: [{ name: "shop" }] }]);
    await expect(resolveProject("acme", "ghost")).rejects.toThrow(/Known projects: 'shop'/);
  });
});

describe("resolveService", () => {
  it("finds the owning project without being told which one", async () => {
    await seed([{
      name: "acme",
      projects: [{ name: "shop", services: [{ name: "orders" }] }, { name: "blog" }],
    }]);
    expect(await resolveService("orders")).toEqual({
      tenant: "acme", project: "shop", service: "orders",
    });
  });

  it("searches the tenant when the named project does not own the service", async () => {
    await seed([{
      name: "acme",
      projects: [{ name: "shop", services: [{ name: "orders" }] }, { name: "blog" }],
    }]);
    expect(await resolveService("orders", "acme", "blog")).toEqual({
      tenant: "acme", project: "shop", service: "orders",
    });
  });

  // The old server resolved a project name to a nonexistent directory and
  // returned an empty success payload, which an agent could not distinguish
  // from an idle service.
  it("rejects a project name passed where a service is expected", async () => {
    await seed([{ name: "acme", projects: [{ name: "shop", services: [{ name: "orders" }] }] }]);
    await expect(resolveService("shop")).rejects.toThrow(CoordinateError);
    await expect(resolveService("shop")).rejects.toThrow(/takes a SERVICE name, not a project name/);
  });

  it("lists known services as project/service pairs when the name is unknown", async () => {
    await seed([{
      name: "acme",
      projects: [
        { name: "shop", services: [{ name: "orders" }] },
        { name: "blog", services: [{ name: "posts" }] },
      ],
    }]);
    await expect(resolveService("ghost")).rejects.toThrow(/'shop\/orders', 'blog\/posts'/);
  });
});
