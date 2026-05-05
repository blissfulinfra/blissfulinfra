import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import { generateServiceCompose, computeServicePorts } from "../service.js";

const PORTS = computeServicePorts(0, 0);

interface ParsedCompose {
  services: Record<string, {
    environment?: Record<string, string>;
    depends_on?: Record<string, { condition: string }>;
    build?: { context: string };
    container_name?: string;
    networks?: unknown;
    ports?: string[];
  }>;
  networks: Record<string, { external?: boolean; name?: string }>;
}

function parse(compose: string): ParsedCompose {
  return yaml.load(compose) as ParsedCompose;
}

describe("generateServiceCompose — client-level keycloak wiring", () => {
  it("adds KEYCLOAK_ISSUER_URI env var when client-level keycloak is enabled", () => {
    const compose = generateServiceCompose("acme", "api", "spring-boot", undefined, [], PORTS, { keycloak: true });
    const parsed = parse(compose);
    const env = parsed.services["api-backend"].environment ?? {};
    expect(env.KEYCLOAK_ISSUER_URI).toBe("http://keycloak:8080/realms/acme");
  });

  it("adds keycloak depends_on (service_healthy) when client-level keycloak is enabled", () => {
    const compose = generateServiceCompose("acme", "api", "spring-boot", undefined, [], PORTS, { keycloak: true });
    const parsed = parse(compose);
    const deps = parsed.services["api-backend"].depends_on ?? {};
    expect(deps.keycloak).toEqual({ condition: "service_healthy" });
  });

  it("does NOT add keycloak env / dep when keycloak is off", () => {
    const compose = generateServiceCompose("acme", "api", "spring-boot", undefined, [], PORTS, {});
    const parsed = parse(compose);
    const env = parsed.services["api-backend"].environment ?? {};
    const deps = parsed.services["api-backend"].depends_on ?? {};
    expect(env.KEYCLOAK_ISSUER_URI).toBeUndefined();
    expect(deps.keycloak).toBeUndefined();
  });
});

describe("generateServiceCompose — client-level localstack wiring", () => {
  it("adds AWS env vars + depends_on for client-level localstack (no per-service container)", () => {
    const compose = generateServiceCompose("acme", "api", "spring-boot", undefined, [], PORTS, { localstack: true });
    const parsed = parse(compose);
    const env = parsed.services["api-backend"].environment ?? {};
    expect(env.AWS_ENDPOINT_URL).toBe("http://localstack:4566");
    expect(env.AWS_DEFAULT_REGION).toBe("us-east-1");

    const deps = parsed.services["api-backend"].depends_on ?? {};
    expect(deps.localstack).toEqual({ condition: "service_healthy" });

    // Should NOT spin up a per-service localstack
    expect(parsed.services["api-localstack"]).toBeUndefined();
  });

  it("uses per-service localstack when the plugin is set, not the client-level wiring", () => {
    const compose = generateServiceCompose(
      "acme", "api", "spring-boot", undefined,
      [{ type: "localstack", instance: "localstack" }],
      PORTS,
      {}, // client-level off
    );
    const parsed = parse(compose);
    expect(parsed.services["api-localstack"]).toBeDefined();
    const deps = parsed.services["api-backend"].depends_on ?? {};
    expect(deps["api-localstack"]).toEqual({ condition: "service_healthy" });
    // No client-level dep since clientInfra.localstack is false
    expect(deps.localstack).toBeUndefined();
  });
});

describe("generateServiceCompose — ai-pipeline wiring (ADR-0010)", () => {
  it("emits an ai-pipeline service connected to client-level mlflow + clickhouse", () => {
    const compose = generateServiceCompose(
      "acme", "api", "spring-boot", undefined,
      [{ type: "ai-pipeline", instance: "ai-pipeline" }],
      PORTS,
      { clickhouse: true, mlflow: true },
    );
    const parsed = parse(compose);
    const ai = parsed.services["api-ai-pipeline"];
    expect(ai).toBeDefined();
    expect(ai.container_name).toBe("acme-api-ai-pipeline");
    expect(ai.build?.context).toBe("./ai-pipeline");

    const env = ai.environment ?? {};
    expect(env.MLFLOW_TRACKING_URI).toBe("http://mlflow:5000");
    expect(env.CLICKHOUSE_HOST).toBe("clickhouse");
    expect(env.CLICKHOUSE_DB).toBe("warehouse"); // matches client-level init
    expect(env.KAFKA_BOOTSTRAP_SERVERS).toBe("kafka:9094");

    const deps = ai.depends_on ?? {};
    expect(deps.kafka).toEqual({ condition: "service_healthy" });
    expect(deps.clickhouse).toEqual({ condition: "service_healthy" });
    expect(deps.mlflow).toEqual({ condition: "service_healthy" });
  });

  it("does NOT emit ai-pipeline service when the plugin is absent", () => {
    const compose = generateServiceCompose("acme", "api", "spring-boot", undefined, [], PORTS, {});
    const parsed = parse(compose);
    expect(parsed.services["api-ai-pipeline"]).toBeUndefined();
  });

  it("uses the plugin's instance name in the service key when not 'ai-pipeline'", () => {
    const compose = generateServiceCompose(
      "acme", "api", "spring-boot", undefined,
      [{ type: "ai-pipeline", instance: "fraud-classifier" }],
      PORTS,
      { clickhouse: true, mlflow: true },
    );
    const parsed = parse(compose);
    expect(parsed.services["api-fraud-classifier"]).toBeDefined();
    expect(parsed.services["api-fraud-classifier"].container_name).toBe("acme-api-fraud-classifier");
  });
});
