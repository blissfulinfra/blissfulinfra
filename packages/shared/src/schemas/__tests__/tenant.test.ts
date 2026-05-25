import { describe, it, expect } from "vitest";
import { TenantConfigSchema, TenantPortBlockSchema } from "../tenant.js";

describe("TenantConfigSchema", () => {
  it("accepts a minimal valid tenant", () => {
    const result = TenantConfigSchema.parse({ type: "tenant", name: "acme" });
    expect(result.name).toBe("acme");
    expect(result.infrastructure.jenkins).toBe(true);
    expect(result.infrastructure.observability.prometheus).toBe(true);
    expect(result.projects).toEqual([]);
  });

  it("accepts a full tenant config with projects", () => {
    const result = TenantConfigSchema.parse({
      type: "tenant",
      name: "acme",
      infrastructure: {
        jenkins: false,
        observability: { prometheus: true, grafana: true, tempo: false, loki: true },
      },
      roles: { owners: ["cavan@acme.com"], developers: ["alice@acme.com"] },
      projects: [{ name: "ecommerce", path: "projects/ecommerce" }],
    });
    expect(result.infrastructure.jenkins).toBe(false);
    expect(result.roles?.owners).toEqual(["cavan@acme.com"]);
    expect(result.projects).toHaveLength(1);
  });

  it("rejects an uppercase name", () => {
    expect(() => TenantConfigSchema.parse({ type: "tenant", name: "AcmeCorp" })).toThrow();
  });

  it("rejects when type is wrong", () => {
    expect(() => TenantConfigSchema.parse({ type: "tenent", name: "acme" })).toThrow();
  });

  it("rejects an empty name", () => {
    expect(() => TenantConfigSchema.parse({ type: "tenant", name: "" })).toThrow();
  });
});

describe("TenantPortBlockSchema", () => {
  it("accepts a complete port block", () => {
    const block = TenantPortBlockSchema.parse({
      tenant: "acme",
      blockIndex: 0,
      dashboard: 3010, jenkins: 8081, grafana: 3000,
      prometheus: 9090, tempo: 3200, loki: 3100,
    });
    expect(block.tenant).toBe("acme");
  });

  it("rejects negative blockIndex", () => {
    expect(() => TenantPortBlockSchema.parse({
      tenant: "acme", blockIndex: -1,
      dashboard: 3010, jenkins: 8081, grafana: 3000,
      prometheus: 9090, tempo: 3200, loki: 3100,
    })).toThrow();
  });

  it("rejects non-positive ports", () => {
    expect(() => TenantPortBlockSchema.parse({
      tenant: "acme", blockIndex: 0,
      dashboard: 0, jenkins: 8081, grafana: 3000,
      prometheus: 9090, tempo: 3200, loki: 3100,
    })).toThrow();
  });
});
