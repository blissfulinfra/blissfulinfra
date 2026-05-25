import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  readContext,
  writeContext,
  clearContext,
  resolveArgs,
  parseTarget,
  ResolveError,
} from "../context.js";

describe("context CRUD (mkdtemp BLISSFUL_HOME)", () => {
  let tmp: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "blissful-ctx-"));
    originalHome = process.env.BLISSFUL_HOME;
    process.env.BLISSFUL_HOME = tmp;
  });

  afterEach(async () => {
    if (originalHome !== undefined) process.env.BLISSFUL_HOME = originalHome;
    else delete process.env.BLISSFUL_HOME;
    delete process.env.BLISSFUL_TENANT;
    delete process.env.BLISSFUL_PROJECT;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("readContext returns empty when no context file", async () => {
    const ctx = await readContext();
    expect(ctx).toEqual({});
  });

  it("write → read round-trip preserves tenant + project", async () => {
    await writeContext({ tenant: "acme", project: "ecommerce" });
    const ctx = await readContext();
    expect(ctx).toEqual({ tenant: "acme", project: "ecommerce" });
  });

  it("writeContext overwrites the previous context (not a merge)", async () => {
    await writeContext({ tenant: "acme", project: "ecommerce" });
    await writeContext({ tenant: "zeta" });
    const ctx = await readContext();
    expect(ctx).toEqual({ tenant: "zeta" });
  });

  it("clearContext drops the file silently", async () => {
    await writeContext({ tenant: "acme" });
    await clearContext();
    const ctx = await readContext();
    expect(ctx).toEqual({});
    // Idempotent — clearing again is fine
    await clearContext();
  });

  it("malformed JSON is treated as empty context (no throw)", async () => {
    await fs.writeFile(path.join(tmp, "context.json"), "not json");
    const ctx = await readContext();
    expect(ctx).toEqual({});
  });
});

describe("resolveArgs (positional + env + context)", () => {
  let tmp: string;
  let originalHome: string | undefined;
  let originalTenant: string | undefined;
  let originalProject: string | undefined;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "blissful-resolve-"));
    originalHome = process.env.BLISSFUL_HOME;
    originalTenant = process.env.BLISSFUL_TENANT;
    originalProject = process.env.BLISSFUL_PROJECT;
    process.env.BLISSFUL_HOME = tmp;
    delete process.env.BLISSFUL_TENANT;
    delete process.env.BLISSFUL_PROJECT;
  });

  afterEach(async () => {
    process.env.BLISSFUL_HOME = originalHome ?? "";
    process.env.BLISSFUL_TENANT = originalTenant ?? "";
    process.env.BLISSFUL_PROJECT = originalProject ?? "";
    if (!originalHome)    delete process.env.BLISSFUL_HOME;
    if (!originalTenant)  delete process.env.BLISSFUL_TENANT;
    if (!originalProject) delete process.env.BLISSFUL_PROJECT;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  describe("right-fill positional args", () => {
    it("3-arg requirement, 3 positional → all explicit", async () => {
      const r = await resolveArgs(["acme", "ecommerce", "orders-api"], ["tenant", "project", "service"]);
      expect(r).toEqual({ tenant: "acme", project: "ecommerce", service: "orders-api" });
    });

    it("3-arg requirement, 1 positional → fills service from arg, tenant + project from context", async () => {
      await writeContext({ tenant: "acme", project: "ecommerce" });
      const r = await resolveArgs(["orders-api"], ["tenant", "project", "service"]);
      expect(r).toEqual({ tenant: "acme", project: "ecommerce", service: "orders-api" });
    });

    it("3-arg requirement, 2 positional → fills project + service from args, tenant from context", async () => {
      await writeContext({ tenant: "acme" });
      const r = await resolveArgs(["ecommerce", "orders-api"], ["tenant", "project", "service"]);
      expect(r).toEqual({ tenant: "acme", project: "ecommerce", service: "orders-api" });
    });

    it("2-arg requirement, 1 positional → fills project from arg, tenant from context", async () => {
      await writeContext({ tenant: "acme" });
      const r = await resolveArgs(["ecommerce"], ["tenant", "project"]);
      expect(r).toEqual({ tenant: "acme", project: "ecommerce" });
    });

    it("1-arg requirement, 0 positional → tenant from context", async () => {
      await writeContext({ tenant: "acme" });
      const r = await resolveArgs([], ["tenant"]);
      expect(r).toEqual({ tenant: "acme" });
    });

    it("ignores undefined positional slots (Commander gives them when optional args are skipped)", async () => {
      await writeContext({ tenant: "acme", project: "ecommerce" });
      const r = await resolveArgs([undefined, undefined, "orders-api"], ["tenant", "project", "service"]);
      expect(r).toEqual({ tenant: "acme", project: "ecommerce", service: "orders-api" });
    });
  });

  describe("env vars override context", () => {
    it("BLISSFUL_TENANT wins over context tenant", async () => {
      await writeContext({ tenant: "acme", project: "ecommerce" });
      process.env.BLISSFUL_TENANT = "zeta";
      const r = await resolveArgs(["orders-api"], ["tenant", "project", "service"]);
      expect(r.tenant).toBe("zeta");
      expect(r.project).toBe("ecommerce"); // still from context
    });

    it("explicit positional wins over env", async () => {
      process.env.BLISSFUL_TENANT = "zeta";
      const r = await resolveArgs(["acme", "ecommerce", "orders-api"], ["tenant", "project", "service"]);
      expect(r.tenant).toBe("acme");
    });
  });

  describe("error cases", () => {
    it("throws ResolveError when nothing fills the slot", async () => {
      await expect(resolveArgs([], ["tenant"])).rejects.toBeInstanceOf(ResolveError);
    });

    it("error message hints at `blissful-infra use`", async () => {
      await expect(resolveArgs([], ["tenant", "project"]))
        .rejects.toThrow(/blissful-infra use/);
    });

    it("throws when too many positional args are passed", async () => {
      await expect(resolveArgs(["a", "b", "c", "d"], ["tenant", "project", "service"]))
        .rejects.toThrow(/Too many arguments/);
    });
  });
});

describe("parseTarget", () => {
  it("'acme' → tenant only", () => {
    expect(parseTarget("acme")).toEqual({ tenant: "acme" });
  });

  it("'acme/ecommerce' → tenant + project", () => {
    expect(parseTarget("acme/ecommerce")).toEqual({ tenant: "acme", project: "ecommerce" });
  });

  it("empty string → empty context", () => {
    expect(parseTarget("")).toEqual({});
  });

  it("three-segment path → throws", () => {
    expect(() => parseTarget("a/b/c")).toThrow(/Invalid target/);
  });
});
