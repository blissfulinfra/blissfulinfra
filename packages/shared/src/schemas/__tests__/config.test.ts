import { describe, it, expect } from "vitest";
import {
  DeployConfigSchema,
  LegacyProjectConfigSchema,
} from "../config.js";

describe("DeployConfigSchema", () => {
  it("defaults target to local-only", () => {
    const r = DeployConfigSchema.parse({});
    expect(r.target).toBe("local-only");
  });

  it("accepts each cloud target with its adapter block", () => {
    const r = DeployConfigSchema.safeParse({
      target: "cloudflare",
      cloudflare: { accountId: "abc", pagesProject: "web" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown targets", () => {
    const r = DeployConfigSchema.safeParse({ target: "kubernetes" });
    expect(r.success).toBe(false);
  });
});

describe("LegacyProjectConfigSchema (legacy flat model)", () => {
  it("still accepts the legacy shape so flat-model projects don't break", () => {
    const r = LegacyProjectConfigSchema.safeParse({
      name: "demo",
      backend: "spring-boot",
      frontend: "react-vite",
      database: "postgres",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a config without a name", () => {
    const r = LegacyProjectConfigSchema.safeParse({ backend: "spring-boot" });
    expect(r.success).toBe(false);
  });
});
