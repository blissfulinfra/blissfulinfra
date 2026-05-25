import { describe, it, expect } from "vitest";
import { TenantRegistrySchema } from "../tenant-registry.js";

describe("TenantRegistrySchema", () => {
  it("accepts an empty registry", () => {
    const result = TenantRegistrySchema.parse({});
    expect(result.version).toBe(1);
    expect(result.tenants).toEqual([]);
  });

  it("accepts a registry with one tenant, project, and service", () => {
    const result = TenantRegistrySchema.parse({
      version: 1,
      tenants: [
        {
          name: "acme",
          portBlock: {
            tenant: "acme", blockIndex: 0,
            dashboard: 3010, jenkins: 8081, grafana: 3000,
            prometheus: 9090, tempo: 3200, loki: 3100,
          },
          projects: [
            {
              name: "ecommerce",
              portBlock: {
                tenant: "acme", project: "ecommerce", projectIndex: 0,
                kafka: 9092, postgres: 5432, redis: 6379, gateway: 8080, postgresExporter: 9187, kafkaExporter: 9308,
              },
              services: [
                {
                  name: "orders-api",
                  type: "backend",
                  ports: {
                    tenant: "acme", project: "ecommerce", service: "orders-api",
                    http: 8000,
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(result.tenants).toHaveLength(1);
    expect(result.tenants[0].projects[0].services[0].name).toBe("orders-api");
  });

  it("rejects an unsupported version", () => {
    expect(() => TenantRegistrySchema.parse({ version: 2, tenants: [] })).toThrow();
  });

  it("defaults version to 1 when absent", () => {
    const result = TenantRegistrySchema.parse({ tenants: [] });
    expect(result.version).toBe(1);
  });
});
