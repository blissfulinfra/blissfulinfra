import { describe, it, expect } from "vitest";
import {
  ClientConfigSchema,
  ServiceConfigSchema,
  PortBlockSchema,
  ClientRegistrySchema,
  LegacyProjectConfigSchema,
  PostgresInstanceSchema,
  normalizePostgresInstances,
} from "../config.js";

describe("ClientConfigSchema", () => {
  it("accepts a minimal valid config", () => {
    const r = ClientConfigSchema.safeParse({
      type: "client",
      name: "acme-corp",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a full config with infrastructure + services", () => {
    const r = ClientConfigSchema.safeParse({
      type: "client",
      name: "acme",
      infrastructure: {
        kafka: true,
        postgres: true,
        jenkins: false,
        observability: { prometheus: true, grafana: true, jaeger: true, loki: true, clickhouse: false },
      },
      services: [{ name: "api", path: "./api" }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects when type literal is wrong", () => {
    const r = ClientConfigSchema.safeParse({ type: "service", name: "x" });
    expect(r.success).toBe(false);
  });

  it("requires services entries to have BOTH name and path", () => {
    const r = ClientConfigSchema.safeParse({
      type: "client",
      name: "x",
      services: [{ name: "api" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-string name", () => {
    const r = ClientConfigSchema.safeParse({ type: "client", name: 123 });
    expect(r.success).toBe(false);
  });
});

describe("ServiceConfigSchema", () => {
  it("accepts a minimal valid service config", () => {
    const r = ServiceConfigSchema.safeParse({
      type: "service",
      name: "api",
      client: "acme",
    });
    expect(r.success).toBe(true);
  });

  it("rejects when type literal is wrong", () => {
    const r = ServiceConfigSchema.safeParse({
      type: "client",
      name: "api",
      client: "acme",
    });
    expect(r.success).toBe(false);
  });

  it("requires client field", () => {
    const r = ServiceConfigSchema.safeParse({
      type: "service",
      name: "api",
    });
    expect(r.success).toBe(false);
  });
});

describe("PortBlockSchema", () => {
  it("accepts a complete port block", () => {
    const r = PortBlockSchema.safeParse({
      clientName: "acme",
      blockIndex: 0,
      jenkins: 8090,
      grafana: 3010,
      prometheus: 9090,
      tempo: 3200,  // ADR-0016
      kafka: 9094,
      postgres: 5432,
      dashboard: 3002,
    });
    expect(r.success).toBe(true);
  });

  it("rejects missing port fields", () => {
    const r = PortBlockSchema.safeParse({
      clientName: "acme",
      blockIndex: 0,
      jenkins: 8090,
      // missing the rest
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-numeric ports", () => {
    const r = PortBlockSchema.safeParse({
      clientName: "acme", blockIndex: 0,
      jenkins: "8090", grafana: 3010, prometheus: 9090,
      tempo: 3200, kafka: 9094, postgres: 5432, dashboard: 3002,
    });
    expect(r.success).toBe(false);
  });
});

describe("ClientRegistrySchema", () => {
  it("accepts an empty registry", () => {
    const r = ClientRegistrySchema.safeParse({ clients: {}, nextBlockIndex: 0 });
    expect(r.success).toBe(true);
  });

  it("accepts a registry with multiple clients", () => {
    const r = ClientRegistrySchema.safeParse({
      clients: {
        "acme": {
          clientName: "acme", blockIndex: 0,
          jenkins: 8090, grafana: 3010, prometheus: 9090,
          tempo: 3200, kafka: 9094, postgres: 5432, dashboard: 3002,
        },
        "globex": {
          clientName: "globex", blockIndex: 1,
          jenkins: 8091, grafana: 3011, prometheus: 9091,
          tempo: 3201, kafka: 9095, postgres: 5433, dashboard: 3003,
        },
      },
      nextBlockIndex: 2,
    });
    expect(r.success).toBe(true);
  });

  it("rejects when client entry is malformed", () => {
    const r = ClientRegistrySchema.safeParse({
      clients: { "acme": { clientName: "acme" } }, // missing required port fields
      nextBlockIndex: 1,
    });
    expect(r.success).toBe(false);
  });
});

describe("Postgres multi-instance config (ADR-0014)", () => {
  it("accepts boolean shorthand on ClientConfigSchema", () => {
    const r = ClientConfigSchema.safeParse({
      type: "client",
      name: "acme",
      infrastructure: { kafka: false, postgres: true, jenkins: false },
    });
    expect(r.success).toBe(true);
  });

  it("accepts array of named instances", () => {
    const r = ClientConfigSchema.safeParse({
      type: "client",
      name: "acme",
      infrastructure: {
        kafka: false,
        jenkins: false,
        postgres: [
          { name: "default", version: "16" },
          { name: "legacy", version: "14", tuning: { sharedBuffers: "256MB" } },
        ],
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty postgres array (requires at least one instance)", () => {
    const r = ClientConfigSchema.safeParse({
      type: "client",
      name: "acme",
      infrastructure: { kafka: false, jenkins: false, postgres: [] },
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid instance name (uppercase)", () => {
    const r = PostgresInstanceSchema.safeParse({ name: "Default", version: "16" });
    expect(r.success).toBe(false);
  });

  it("normalizePostgresInstances maps true -> single default instance", () => {
    expect(normalizePostgresInstances(true)).toEqual([{ name: "default", version: "16" }]);
  });

  it("normalizePostgresInstances maps false -> empty array", () => {
    expect(normalizePostgresInstances(false)).toEqual([]);
  });

  it("normalizePostgresInstances passes array through with defaults filled in", () => {
    const result = normalizePostgresInstances([
      { name: "legacy", version: "14" },
      { name: "default" },
    ] as never);
    expect(result).toEqual([
      { name: "legacy", version: "14" },
      { name: "default", version: "16" },
    ]);
  });

  it("PortBlockSchema accepts optional postgresInstances map", () => {
    const r = PortBlockSchema.safeParse({
      clientName: "acme", blockIndex: 0,
      jenkins: 8090, grafana: 3010, prometheus: 9090, tempo: 3200,
      kafka: 9094, postgres: 5432, dashboard: 3002,
      postgresInstances: { legacy: 5600, analytics: 5601 },
    });
    expect(r.success).toBe(true);
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
});
