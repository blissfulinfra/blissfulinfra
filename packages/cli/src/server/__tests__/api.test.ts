import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProjectDir } from "../api.js";

// resolveProjectDir is the single function every `/api/v1/projects/:name/...`
// route handler uses to find the on-disk dir. With a tenant, `:name` is a
// service and resolves through the registry to the owning project's service
// dir; without one it's a plain join (legacy flat working dir).

let testHome: string;

beforeEach(async () => {
  testHome = await mkdtemp(join(tmpdir(), "binf-api-"));
  process.env.BLISSFUL_HOME = testHome;
});

afterEach(async () => {
  delete process.env.BLISSFUL_HOME;
  await rm(testHome, { recursive: true, force: true });
});

describe("resolveProjectDir", () => {
  it("joins workingDir and name when no tenant is given", async () => {
    expect(await resolveProjectDir("/projects", "foo")).toBe("/projects/foo");
  });

  it("resolves a tenant service through the registry to its service dir", async () => {
    await mkdir(testHome, { recursive: true });
    await writeFile(join(testHome, "registry.json"), JSON.stringify({
      version: 1,
      tenants: [{
        name: "acme",
        portBlock: {
          tenant: "acme", blockIndex: 0,
          dashboard: 3010, jenkins: 8081, grafana: 3000,
          prometheus: 9090, tempo: 3200, loki: 3100,
        },
        projects: [{
          name: "shop",
          portBlock: {
            tenant: "acme", project: "shop", projectIndex: 0,
            kafka: 9092, postgres: 5432, redis: 6379, gateway: 8080,
            postgresExporter: 9187, kafkaExporter: 9308, redisExporter: 9121,
          },
          services: [{
            name: "orders-api", type: "backend",
            ports: { tenant: "acme", project: "shop", service: "orders-api", http: 30000, metrics: 34000 },
          }],
        }],
      }],
    }));

    const dir = await resolveProjectDir("/unused", "orders-api", "acme");
    expect(dir).toBe(join(testHome, "tenants", "acme", "projects", "shop", "services", "orders-api"));
  });

  it("falls back to a plain join when the tenant does not own the service", async () => {
    expect(await resolveProjectDir("/projects", "ghost", "acme")).toBe("/projects/ghost");
  });
});
