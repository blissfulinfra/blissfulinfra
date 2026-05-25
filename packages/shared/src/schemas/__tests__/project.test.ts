import { describe, it, expect } from "vitest";
import { ProjectConfigSchema, ProjectPortBlockSchema } from "../project.js";

describe("ProjectConfigSchema", () => {
  it("accepts a minimal valid project", () => {
    const result = ProjectConfigSchema.parse({
      type: "project",
      name: "ecommerce",
      tenant: "acme",
    });
    expect(result.name).toBe("ecommerce");
    expect(result.tenant).toBe("acme");
    expect(result.infrastructure.kafka).toBe(true);
    expect(result.infrastructure.postgres).toBe(true);
    expect(result.infrastructure.redis).toBe(true);
    expect(result.infrastructure.gateway).toBe(true);
    expect(result.services).toEqual([]);
  });

  it("accepts a full project with services", () => {
    const result = ProjectConfigSchema.parse({
      type: "project",
      name: "ecommerce",
      tenant: "acme",
      infrastructure: { kafka: true, postgres: true, gateway: false },
      services: [
        { name: "orders-api", path: "services/orders-api", type: "backend" },
        { name: "orders-web", path: "services/orders-web", type: "frontend" },
      ],
    });
    expect(result.infrastructure.gateway).toBe(false);
    expect(result.services).toHaveLength(2);
  });

  it("rejects when type is wrong", () => {
    expect(() => ProjectConfigSchema.parse({
      type: "wrong", name: "ecommerce", tenant: "acme",
    })).toThrow();
  });

  it("requires tenant field", () => {
    expect(() => ProjectConfigSchema.parse({
      type: "project", name: "ecommerce",
    })).toThrow();
  });

  it("rejects an invalid service type in services list", () => {
    expect(() => ProjectConfigSchema.parse({
      type: "project", name: "ecommerce", tenant: "acme",
      services: [{ name: "orders-api", path: "services/orders-api", type: "lambda" }],
    })).toThrow();
  });
});

describe("ProjectPortBlockSchema", () => {
  it("accepts a complete project port block", () => {
    const block = ProjectPortBlockSchema.parse({
      tenant: "acme", project: "ecommerce", projectIndex: 0,
      kafka: 9092, postgres: 5432, redis: 6379, gateway: 8080, postgresExporter: 9187, kafkaExporter: 9308,
    });
    expect(block.project).toBe("ecommerce");
  });

  it("rejects when projectIndex is negative", () => {
    expect(() => ProjectPortBlockSchema.parse({
      tenant: "acme", project: "ecommerce", projectIndex: -1,
      kafka: 9092, postgres: 5432, redis: 6379, gateway: 8080, postgresExporter: 9187, kafkaExporter: 9308,
    })).toThrow();
  });
});
