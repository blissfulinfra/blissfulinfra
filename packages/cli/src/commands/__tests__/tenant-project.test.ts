import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { tenantCreateAction } from "../tenant.js";
import { projectCreateAction } from "../project.js";
import {
  getTenant,
  getProject,
  getTenantDir,
  getProjectDir,
} from "../../utils/tenant-registry.js";
import { TenantConfigSchema, ProjectConfigSchema } from "@blissful-infra/shared";

// These exercise tenantCreateAction + projectCreateAction end-to-end against
// real disk (mkdtemp BLISSFUL_HOME). They cover the file scaffolding +
// registry side of Phase 3; the docker/compose side ships in Phase 5.

describe("tenant + project actions (with mkdtemp BLISSFUL_HOME)", () => {
  let tmp: string;
  let originalHome: string | undefined;
  let originalTTY: boolean;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "blissful-tp-test-"));
    originalHome = process.env.BLISSFUL_HOME;
    process.env.BLISSFUL_HOME = tmp;
    // Pretend we're not a TTY so action handlers take the --yes / defaults
    // path and don't try to render interactive prompts inside vitest.
    originalTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
  });

  afterEach(async () => {
    if (originalHome !== undefined) process.env.BLISSFUL_HOME = originalHome;
    else delete process.env.BLISSFUL_HOME;
    Object.defineProperty(process.stdout, "isTTY", { value: originalTTY, configurable: true });
    await fs.rm(tmp, { recursive: true, force: true });
  });

  describe("tenantCreateAction", () => {
    it("creates the tenant directory, writes tenant.yaml, registers ports", async () => {
      await tenantCreateAction("acme", { skipPrompts: true });

      const dir = getTenantDir("acme");
      const stat = await fs.stat(dir);
      expect(stat.isDirectory()).toBe(true);

      const projectsDir = path.join(dir, "projects");
      const projectsStat = await fs.stat(projectsDir);
      expect(projectsStat.isDirectory()).toBe(true);

      const yamlContent = await fs.readFile(path.join(dir, "tenant.yaml"), "utf-8");
      const parsed = TenantConfigSchema.parse(yaml.load(yamlContent));
      expect(parsed.type).toBe("tenant");
      expect(parsed.name).toBe("acme");
      expect(parsed.projects).toEqual([]);

      const reg = await getTenant("acme");
      expect(reg).not.toBeNull();
      expect(reg?.portBlock.blockIndex).toBe(0);
    });

    it("honors --no-jenkins / --no-tempo", async () => {
      await tenantCreateAction("nojenkins", { skipPrompts: true, jenkins: false, tempo: false });
      const yamlContent = await fs.readFile(path.join(getTenantDir("nojenkins"), "tenant.yaml"), "utf-8");
      const parsed = TenantConfigSchema.parse(yaml.load(yamlContent));
      expect(parsed.infrastructure.jenkins).toBe(false);
      expect(parsed.infrastructure.observability.tempo).toBe(false);
      expect(parsed.infrastructure.observability.prometheus).toBe(true);
    });
  });

  describe("projectCreateAction", () => {
    beforeEach(async () => {
      await tenantCreateAction("acme", { skipPrompts: true });
    });

    it("creates project directory + project.yaml + services/ subdir", async () => {
      await projectCreateAction("acme", "ecommerce", { skipPrompts: true });

      const dir = getProjectDir("acme", "ecommerce");
      expect((await fs.stat(dir)).isDirectory()).toBe(true);

      const servicesDir = path.join(dir, "services");
      expect((await fs.stat(servicesDir)).isDirectory()).toBe(true);

      const yamlContent = await fs.readFile(path.join(dir, "project.yaml"), "utf-8");
      const parsed = ProjectConfigSchema.parse(yaml.load(yamlContent));
      expect(parsed.name).toBe("ecommerce");
      expect(parsed.tenant).toBe("acme");
      expect(parsed.infrastructure.kafka).toBe(true);
      expect(parsed.infrastructure.postgres).toBe(true);
      expect(parsed.infrastructure.redis).toBe(true);
      expect(parsed.infrastructure.gateway).toBe(true);
    });

    it("registers the project's port block in the registry", async () => {
      await projectCreateAction("acme", "ecommerce", { skipPrompts: true });
      const project = await getProject("acme", "ecommerce");
      expect(project).not.toBeNull();
      expect(project?.portBlock.projectIndex).toBe(0);
      expect(project?.portBlock.kafka).toBe(9092);
    });

    it("appends the project to the parent tenant.yaml projects list", async () => {
      await projectCreateAction("acme", "ecommerce", { skipPrompts: true });
      const tenantYaml = await fs.readFile(path.join(getTenantDir("acme"), "tenant.yaml"), "utf-8");
      const parsed = TenantConfigSchema.parse(yaml.load(tenantYaml));
      expect(parsed.projects.map(p => p.name)).toEqual(["ecommerce"]);
    });

    it("honors --no-kafka / --no-postgres / --no-gateway", async () => {
      await projectCreateAction("acme", "minimal", {
        skipPrompts: true, kafka: false, postgres: false, redis: false, gateway: false,
      });
      const yamlContent = await fs.readFile(
        path.join(getProjectDir("acme", "minimal"), "project.yaml"),
        "utf-8",
      );
      const parsed = ProjectConfigSchema.parse(yaml.load(yamlContent));
      expect(parsed.infrastructure.kafka).toBe(false);
      expect(parsed.infrastructure.postgres).toBe(false);
      expect(parsed.infrastructure.redis).toBe(false);
      expect(parsed.infrastructure.gateway).toBe(false);
    });

    it("two projects in the same tenant get sequential port blocks", async () => {
      await projectCreateAction("acme", "ecommerce", { skipPrompts: true });
      await projectCreateAction("acme", "logistics", { skipPrompts: true });
      const a = await getProject("acme", "ecommerce");
      const b = await getProject("acme", "logistics");
      expect((b?.portBlock.kafka ?? 0) - (a?.portBlock.kafka ?? 0)).toBe(1);
    });
  });
});
