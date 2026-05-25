import { describe, it, expect } from "vitest";
import { ServiceConfigV2Schema, ServicePortsSchema } from "../service-v2.js";

describe("ServiceConfigV2Schema", () => {
  const base = { type: "service", name: "orders-api", tenant: "acme", project: "ecommerce" };

  it("accepts a backend service with the backend block", () => {
    const result = ServiceConfigV2Schema.parse({
      ...base,
      serviceType: "backend",
      backend: { template: "spring-boot" },
    });
    expect(result.serviceType).toBe("backend");
    expect(result.backend?.template).toBe("spring-boot");
  });

  it("accepts a frontend service with the frontend block", () => {
    const result = ServiceConfigV2Schema.parse({
      ...base, name: "orders-web",
      serviceType: "frontend",
      frontend: { template: "react-vite" },
    });
    expect(result.frontend?.template).toBe("react-vite");
  });

  it("accepts a worker service with the worker block", () => {
    const result = ServiceConfigV2Schema.parse({
      ...base, name: "orders-worker",
      serviceType: "worker",
      worker: { runtime: "python" },
    });
    expect(result.worker?.runtime).toBe("python");
  });

  it("rejects when serviceType says backend but no backend block is set", () => {
    expect(() => ServiceConfigV2Schema.parse({
      ...base, serviceType: "backend",
    })).toThrow();
  });

  it("rejects when a mismatched block is set", () => {
    expect(() => ServiceConfigV2Schema.parse({
      ...base, serviceType: "backend",
      backend: { template: "spring-boot" },
      frontend: { template: "react-vite" },
    })).toThrow();
  });

  it("rejects unknown backend template", () => {
    expect(() => ServiceConfigV2Schema.parse({
      ...base, serviceType: "backend",
      backend: { template: "ruby-on-rails" },
    })).toThrow();
  });

  it("accepts a service with database binding", () => {
    const result = ServiceConfigV2Schema.parse({
      ...base, serviceType: "backend",
      backend: { template: "spring-boot" },
      database: { schema: "orders", migrations: true },
    });
    expect(result.database?.schema).toBe("orders");
  });

  it("rejects uppercase database schema name", () => {
    expect(() => ServiceConfigV2Schema.parse({
      ...base, serviceType: "backend",
      backend: { template: "spring-boot" },
      database: { schema: "Orders" },
    })).toThrow();
  });
});

describe("ServicePortsSchema", () => {
  it("accepts an http-only service", () => {
    const ports = ServicePortsSchema.parse({
      tenant: "acme", project: "ecommerce", service: "orders-api",
      http: 8000,
    });
    expect(ports.http).toBe(8000);
    expect(ports.metrics).toBeUndefined();
  });

  it("accepts ports-less workers", () => {
    const ports = ServicePortsSchema.parse({
      tenant: "acme", project: "ecommerce", service: "orders-worker",
    });
    expect(ports.http).toBeUndefined();
  });
});
