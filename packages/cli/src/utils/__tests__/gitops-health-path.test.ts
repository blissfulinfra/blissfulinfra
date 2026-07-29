import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { renderServiceManifests, serviceManifestDir } from "../gitops.js";

/**
 * The Rollout's probe path used to be hardcoded to Spring Boot's
 * /actuator/health, which made every non-Spring service fail its readiness
 * probe forever. It now renders from the service's template.
 */

let home: string;
const originalHome = process.env.BLISSFUL_HOME;
const coords = { tenant: "acme", project: "shop", service: "orders" };

async function writeServiceConfig(serviceType: string, template?: string): Promise<void> {
  const dir = path.join(home, "tenants", coords.tenant, "projects", coords.project, "services", coords.service);
  await fs.mkdir(dir, { recursive: true });
  const config: Record<string, unknown> = {
    type: "service",
    name: coords.service,
    tenant: coords.tenant,
    project: coords.project,
    serviceType,
    plugins: [],
  };
  if (serviceType === "backend") config.backend = { template };
  if (serviceType === "frontend") config.frontend = { template };
  await fs.writeFile(path.join(dir, "service.yaml"), yaml.dump(config));
}

async function renderedProbePaths(): Promise<string[]> {
  await renderServiceManifests(coords, "img", "tag1", "http://gitea/repo.git");
  const rollout = await fs.readFile(path.join(serviceManifestDir(coords), "rollout.yaml"), "utf-8");
  return [...rollout.matchAll(/path:\s*(\S+)/g)].map(m => m[1]);
}

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "blissful-gitops-"));
  process.env.BLISSFUL_HOME = home;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.BLISSFUL_HOME;
  else process.env.BLISSFUL_HOME = originalHome;
  await fs.rm(home, { recursive: true, force: true });
});

describe("rollout health path", () => {
  it("uses the actuator path for spring-boot", async () => {
    await writeServiceConfig("backend", "spring-boot");
    const paths = await renderedProbePaths();
    expect(paths).toHaveLength(3);
    expect(new Set(paths)).toEqual(new Set(["/actuator/health"]));
  });

  it("uses /health for hono", async () => {
    await writeServiceConfig("backend", "hono");
    expect(new Set(await renderedProbePaths())).toEqual(new Set(["/health"]));
  });

  it("uses / for a frontend", async () => {
    await writeServiceConfig("frontend", "react-vite");
    expect(new Set(await renderedProbePaths())).toEqual(new Set(["/"]));
  });

  it("falls back to the actuator path when service.yaml is missing", async () => {
    expect(new Set(await renderedProbePaths())).toEqual(new Set(["/actuator/health"]));
  });

  it("leaves no unrendered placeholders in the manifest", async () => {
    await writeServiceConfig("backend", "hono");
    await renderServiceManifests(coords, "img", "tag1", "http://gitea/repo.git");
    const rollout = await fs.readFile(path.join(serviceManifestDir(coords), "rollout.yaml"), "utf-8");
    expect(rollout).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });
});
