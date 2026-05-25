import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { tenantCreateAction } from "../tenant.js";
import { projectCreateAction } from "../project.js";
import { serviceAddV2Action } from "../service-v2.js";
import {
  getService,
  getProject,
  getServiceDir,
  getProjectDir,
} from "../../utils/tenant-registry.js";
import { ServiceConfigV2Schema, ProjectConfigSchema } from "@blissful-infra/shared";

describe("serviceAddV2Action (with mkdtemp BLISSFUL_HOME)", () => {
  let tmp: string;
  let originalHome: string | undefined;
  let originalTTY: boolean;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "blissful-sv2-"));
    originalHome = process.env.BLISSFUL_HOME;
    process.env.BLISSFUL_HOME = tmp;
    originalTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    // Prereqs for every test: an acme tenant with an ecommerce project
    await tenantCreateAction("acme", { skipPrompts: true });
    await projectCreateAction("acme", "ecommerce", { skipPrompts: true });
  });

  afterEach(async () => {
    if (originalHome !== undefined) process.env.BLISSFUL_HOME = originalHome;
    else delete process.env.BLISSFUL_HOME;
    Object.defineProperty(process.stdout, "isTTY", { value: originalTTY, configurable: true });
    await fs.rm(tmp, { recursive: true, force: true });
  });

  describe("backend service", () => {
    it("registers ports, scaffolds the template, writes service.yaml", async () => {
      await serviceAddV2Action("acme", "ecommerce", "orders-api", {
        type: "backend",
        template: "spring-boot",
        skipPrompts: true,
      });

      const svc = await getService("acme", "ecommerce", "orders-api");
      expect(svc).not.toBeNull();
      expect(svc?.type).toBe("backend");
      expect(svc?.ports.http).toBe(30000);

      const dir = getServiceDir("acme", "ecommerce", "orders-api");
      expect((await fs.stat(dir)).isDirectory()).toBe(true);

      const yamlPath = path.join(dir, "service.yaml");
      const parsed = ServiceConfigV2Schema.parse(yaml.load(await fs.readFile(yamlPath, "utf-8")));
      expect(parsed.serviceType).toBe("backend");
      expect(parsed.backend?.template).toBe("spring-boot");
    });

    it("auto-allocates a Postgres schema named after the service", async () => {
      await serviceAddV2Action("acme", "ecommerce", "orders-api", {
        type: "backend", template: "spring-boot", skipPrompts: true,
      });
      const parsed = ServiceConfigV2Schema.parse(yaml.load(await fs.readFile(
        path.join(getServiceDir("acme", "ecommerce", "orders-api"), "service.yaml"),
        "utf-8",
      )));
      // hyphens in service name become underscores so the schema name is a
      // valid Postgres identifier
      expect(parsed.database?.schema).toBe("orders_api");
      expect(parsed.database?.migrations).toBe(true);
    });

    it("skips Postgres schema when --no-database is set", async () => {
      await serviceAddV2Action("acme", "ecommerce", "stateless", {
        type: "backend", template: "spring-boot", noDatabase: true, skipPrompts: true,
      });
      const parsed = ServiceConfigV2Schema.parse(yaml.load(await fs.readFile(
        path.join(getServiceDir("acme", "ecommerce", "stateless"), "service.yaml"),
        "utf-8",
      )));
      expect(parsed.database).toBeUndefined();
    });
  });

  describe("frontend service", () => {
    it("uses react-vite by default and gets no database schema", async () => {
      await serviceAddV2Action("acme", "ecommerce", "orders-web", {
        type: "frontend", skipPrompts: true,
      });
      const parsed = ServiceConfigV2Schema.parse(yaml.load(await fs.readFile(
        path.join(getServiceDir("acme", "ecommerce", "orders-web"), "service.yaml"),
        "utf-8",
      )));
      expect(parsed.serviceType).toBe("frontend");
      expect(parsed.frontend?.template).toBe("react-vite");
      // Frontends are stateless — never auto-allocate a schema
      expect(parsed.database).toBeUndefined();
    });

    it("frontend HTTP port is sequential with backend HTTP port", async () => {
      await serviceAddV2Action("acme", "ecommerce", "orders-api", {
        type: "backend", template: "spring-boot", skipPrompts: true,
      });
      await serviceAddV2Action("acme", "ecommerce", "orders-web", {
        type: "frontend", skipPrompts: true,
      });
      const api = await getService("acme", "ecommerce", "orders-api");
      const web = await getService("acme", "ecommerce", "orders-web");
      expect((web?.ports.http ?? 0) - (api?.ports.http ?? 0)).toBe(1);
    });
  });

  describe("worker service", () => {
    it("scaffolds a python placeholder by default and gets a DB schema", async () => {
      await serviceAddV2Action("acme", "ecommerce", "orders-worker", {
        type: "worker", skipPrompts: true,
      });
      const dir = getServiceDir("acme", "ecommerce", "orders-worker");
      const mainPy = await fs.readFile(path.join(dir, "main.py"), "utf-8");
      expect(mainPy).toContain("orders-worker");

      const parsed = ServiceConfigV2Schema.parse(yaml.load(await fs.readFile(
        path.join(dir, "service.yaml"), "utf-8",
      )));
      expect(parsed.worker?.runtime).toBe("python");
      expect(parsed.database?.schema).toBe("orders_worker");
    });

    it("honors --runtime node", async () => {
      await serviceAddV2Action("acme", "ecommerce", "node-worker", {
        type: "worker", runtime: "node", skipPrompts: true,
      });
      const dir = getServiceDir("acme", "ecommerce", "node-worker");
      const indexJs = await fs.readFile(path.join(dir, "index.js"), "utf-8");
      expect(indexJs).toContain("node-worker");

      const parsed = ServiceConfigV2Schema.parse(yaml.load(await fs.readFile(
        path.join(dir, "service.yaml"), "utf-8",
      )));
      expect(parsed.worker?.runtime).toBe("node");
    });

    it("workers have no http port allocated", async () => {
      await serviceAddV2Action("acme", "ecommerce", "orders-worker", {
        type: "worker", skipPrompts: true,
      });
      const svc = await getService("acme", "ecommerce", "orders-worker");
      expect(svc?.ports.http).toBeUndefined();
      expect(svc?.ports.metrics).toBeDefined();
    });
  });

  describe("project.yaml side-effect", () => {
    it("appends each new service to the parent project.yaml services list", async () => {
      await serviceAddV2Action("acme", "ecommerce", "orders-api", {
        type: "backend", template: "spring-boot", skipPrompts: true,
      });
      await serviceAddV2Action("acme", "ecommerce", "orders-web", {
        type: "frontend", skipPrompts: true,
      });
      const parsed = ProjectConfigSchema.parse(yaml.load(await fs.readFile(
        path.join(getProjectDir("acme", "ecommerce"), "project.yaml"), "utf-8",
      )));
      expect(parsed.services.map(s => ({ name: s.name, type: s.type }))).toEqual([
        { name: "orders-api", type: "backend" },
        { name: "orders-web", type: "frontend" },
      ]);
    });
  });

  describe("validation", () => {
    it("rejects when tenant doesn't exist", async () => {
      const exitSpy = vi_processExitSpy();
      await serviceAddV2Action("ghost", "ecommerce", "x", { type: "backend", skipPrompts: true })
        .catch(() => { /* exit thrown */ });
      expect(exitSpy.calls()[0]).toBe(1);
      exitSpy.restore();
    });

    it("rejects an uppercase service name", async () => {
      const exitSpy = vi_processExitSpy();
      await serviceAddV2Action("acme", "ecommerce", "OrdersAPI", { type: "backend", skipPrompts: true })
        .catch(() => { /* exit thrown */ });
      expect(exitSpy.calls()[0]).toBe(1);
      exitSpy.restore();
    });

    it("rejects an unknown backend template", async () => {
      const exitSpy = vi_processExitSpy();
      await serviceAddV2Action("acme", "ecommerce", "x", {
        type: "backend", template: "ruby-on-rails", skipPrompts: true,
      }).catch(() => { /* exit thrown */ });
      expect(exitSpy.calls()[0]).toBe(1);
      exitSpy.restore();
    });
  });
});

/**
 * Capture process.exit calls. The action handlers exit on validation failures
 * because they're CLI entry points; we want to verify the exit happened
 * without actually killing the test runner.
 */
function vi_processExitSpy() {
  const original = process.exit;
  const calls: number[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process as any).exit = (code?: number) => {
    calls.push(code ?? 0);
    throw new Error(`process.exit(${code ?? 0})`);
  };
  return {
    calls: () => calls,
    restore: () => { process.exit = original; },
  };
}
