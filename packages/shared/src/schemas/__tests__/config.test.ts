import { describe, it, expect } from "vitest";
import {
  ClientConfigSchema,
  ServiceConfigSchema,
  PortBlockSchema,
  ClientRegistrySchema,
  ProjectConfigSchema,
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
      jaeger: 16680,
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
      jaeger: 16680, kafka: 9094, postgres: 5432, dashboard: 3002,
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
          jaeger: 16680, kafka: 9094, postgres: 5432, dashboard: 3002,
        },
        "globex": {
          clientName: "globex", blockIndex: 1,
          jenkins: 8091, grafana: 3011, prometheus: 9091,
          jaeger: 16681, kafka: 9095, postgres: 5433, dashboard: 3003,
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

describe("ProjectConfigSchema (legacy flat model)", () => {
  it("still accepts the legacy shape so flat-model projects don't break", () => {
    const r = ProjectConfigSchema.safeParse({
      name: "demo",
      backend: "spring-boot",
      frontend: "react-vite",
      database: "postgres",
    });
    expect(r.success).toBe(true);
  });
});
