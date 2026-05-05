import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import yaml from "js-yaml";
import {
  generateInfraCompose,
  regenerateInfraCompose,
  parseClientConfigYaml,
} from "../infra-compose.js";
import { allocatePortBlock } from "../client-registry.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "binf-compose-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const fullInfra = {
  kafka: true,
  postgres: true,
  jenkins: true,
  clickhouse: false,
  localstack: false,
  keycloak: false,
  mlflow: false,
  mage: false,
  observability: { prometheus: true, grafana: true, tempo: true, jaeger: false, loki: true, clickhouse: false },
};

const minimalInfra = {
  kafka: false,
  postgres: false,
  jenkins: false,
  clickhouse: false,
  localstack: false,
  keycloak: false,
  mlflow: false,
  mage: false,
  observability: { prometheus: false, grafana: false, tempo: false, jaeger: false, loki: false, clickhouse: false },
};

const allPromotedInfra = {
  kafka: true,
  postgres: true,
  jenkins: false,
  clickhouse: true,
  localstack: true,
  keycloak: true,
  mlflow: true,
  mage: true,
  observability: { prometheus: false, grafana: false, tempo: false, jaeger: false, loki: false, clickhouse: false },
};

async function writeYaml(file: string, content: string) {
  await writeFile(join(dir, file), content);
}

async function readGeneratedCompose() {
  const content = await readFile(join(dir, "docker-compose.infra.yaml"), "utf-8");
  return { content, parsed: yaml.load(content) as Record<string, unknown> };
}

async function dockerComposeConfigPasses(): Promise<{ ok: boolean; stderr: string }> {
  const r = await execa("docker", [
    "compose", "-f", join(dir, "docker-compose.infra.yaml"), "config", "--quiet",
  ], { reject: false });
  return { ok: r.exitCode === 0, stderr: r.stderr };
}

describe("generateInfraCompose — structural assertions", () => {
  it("emits top-level `name:` matching the client", async () => {
    await generateInfraCompose({
      clientName: "tc",
      clientDir: dir,
      ports: allocatePortBlock("tc", 0),
      infrastructure: fullInfra,
    });
    const { parsed } = await readGeneratedCompose();
    expect(parsed.name).toBe("tc");
  });

  it("declares the infra network with the per-client name", async () => {
    await generateInfraCompose({
      clientName: "acme-corp",
      clientDir: dir,
      ports: allocatePortBlock("acme-corp", 2),
      infrastructure: fullInfra,
    });
    const { parsed } = await readGeneratedCompose();
    const networks = parsed.networks as Record<string, { name?: string }>;
    expect(networks.infra.name).toBe("acme-corp_infra");
  });

  it("includes only the services that the infrastructure flags request", async () => {
    await generateInfraCompose({
      clientName: "tc",
      clientDir: dir,
      ports: allocatePortBlock("tc", 0),
      infrastructure: { kafka: true, postgres: true, jenkins: false,
        observability: { prometheus: false, grafana: false, tempo: true, jaeger: false, loki: true, clickhouse: false } },
    });
    const { parsed } = await readGeneratedCompose();
    const services = parsed.services as Record<string, unknown>;
    expect(Object.keys(services)).toContain("kafka");
    expect(Object.keys(services)).toContain("postgres");
    expect(Object.keys(services)).toContain("tempo");
    expect(Object.keys(services)).toContain("loki");
    expect(Object.keys(services)).toContain("dashboard");   // dashboard is always present
    expect(Object.keys(services)).not.toContain("jenkins");
    expect(Object.keys(services)).not.toContain("prometheus");
    expect(Object.keys(services)).not.toContain("grafana");
    expect(Object.keys(services)).not.toContain("jaeger");  // ADR-0016: Jaeger is gone, replaced by Tempo
  });

  it("port mappings reflect the allocated port block", async () => {
    await generateInfraCompose({
      clientName: "tc",
      clientDir: dir,
      ports: allocatePortBlock("tc", 1),
      infrastructure: fullInfra,
    });
    const { parsed } = await readGeneratedCompose();
    const services = parsed.services as Record<string, { ports?: string[] }>;
    expect(services.kafka.ports?.[0]).toBe("9095:9094");
    expect(services.postgres.ports?.[0]).toBe("5433:5432");
    expect(services.dashboard.ports?.[0]).toBe("3003:3002");
  });

  // Regression: kafka's KRaft controller self-references `kafka:9093`. Under
  // load it can lose the race against Docker's embedded DNS and exit with
  // UnknownHostException. extra_hosts pins the name to loopback so the self-
  // connect always works.
  it("kafka pins its own hostname to loopback via extra_hosts", async () => {
    await generateInfraCompose({
      clientName: "tc",
      clientDir: dir,
      ports: allocatePortBlock("tc", 0),
      infrastructure: fullInfra,
    });
    const { parsed } = await readGeneratedCompose();
    const kafka = (parsed.services as Record<string, { extra_hosts?: string[] }>).kafka;
    expect(kafka.extra_hosts).toEqual(["kafka:127.0.0.1"]);
  });

  // ADR-0016: Jaeger replaced by Tempo. New clients spawn `services.tempo`
  // (with a generated tempo.yaml mounted in), and Grafana is provisioned
  // with a Tempo datasource that does trace-to-logs correlation back to
  // the Loki datasource.
  it("emits a tempo service when obs.tempo is true", async () => {
    await generateInfraCompose({
      clientName: "tc",
      clientDir: dir,
      ports: allocatePortBlock("tc", 0),
      infrastructure: { kafka: false, postgres: false, jenkins: false,
        clickhouse: false, localstack: false, keycloak: false, mlflow: false, mage: false,
        observability: { prometheus: false, grafana: false, tempo: true, jaeger: false, loki: false, clickhouse: false } },
    });
    const { parsed } = await readGeneratedCompose();
    const tempo = (parsed.services as Record<string, { image?: string; ports?: string[]; volumes?: string[] }>).tempo;
    expect(tempo).toBeDefined();
    expect(tempo.image).toMatch(/^grafana\/tempo/);
    // Block 0 puts tempo at port 3200 mapping to in-container :3200
    expect(tempo.ports?.[0]).toBe("3200:3200");
    expect(tempo.volumes?.some(v => v.includes("tempo.yaml"))).toBe(true);
  });

  // Backwards compat: clients written before ADR-0016 had `jaeger: true` in
  // their YAML. The compose generator must treat that as an alias and still
  // emit a Tempo container so existing clients keep working without rewrite.
  it("legacy obs.jaeger alias also produces a tempo container", async () => {
    await generateInfraCompose({
      clientName: "tc",
      clientDir: dir,
      ports: allocatePortBlock("tc", 0),
      infrastructure: { kafka: false, postgres: false, jenkins: false,
        clickhouse: false, localstack: false, keycloak: false, mlflow: false, mage: false,
        observability: { prometheus: false, grafana: false, tempo: false, jaeger: true, loki: false, clickhouse: false } },
    });
    const { parsed } = await readGeneratedCompose();
    const services = parsed.services as Record<string, unknown>;
    expect(services.tempo).toBeDefined();
    expect(services.jaeger).toBeUndefined();
  });

  // Regression: the Keycloak image is UBI9-minimal and ships without curl
  // or wget, so a `curl http://localhost:8080/health/ready` test fails with
  // `executable file not found in $PATH` and the container is permanently
  // unhealthy. Use bash's /dev/tcp redirect to probe HTTP without external
  // binaries.
  // The Tempo image is distroless: no curl, no wget, no shell utilities
  // beyond the Tempo binary itself. Same /dev/tcp probe pattern as Keycloak.
  it("tempo healthcheck does not depend on curl/wget", async () => {
    await generateInfraCompose({
      clientName: "tc",
      clientDir: dir,
      ports: allocatePortBlock("tc", 0),
      infrastructure: { kafka: false, postgres: false, jenkins: false,
        clickhouse: false, localstack: false, keycloak: false, mlflow: false, mage: false,
        observability: { prometheus: false, grafana: false, tempo: true, jaeger: false, loki: false, clickhouse: false } },
    });
    const { parsed } = await readGeneratedCompose();
    const tempo = (parsed.services as Record<string, { healthcheck?: { test?: string[] } }>).tempo;
    const cmd = (tempo.healthcheck?.test ?? []).join(" ");
    expect(cmd).not.toContain("curl");
    expect(cmd).not.toContain("wget");
    expect(cmd).toContain("/dev/tcp");
  });

  it("keycloak healthcheck does not depend on curl/wget", async () => {
    await generateInfraCompose({
      clientName: "tc",
      clientDir: dir,
      ports: allocatePortBlock("tc", 0),
      infrastructure: allPromotedInfra,
    });
    const { parsed } = await readGeneratedCompose();
    const keycloak = (parsed.services as Record<string, { healthcheck?: { test?: string[] } }>).keycloak;
    const test = keycloak.healthcheck?.test ?? [];
    const cmd = test.join(" ");
    expect(cmd).not.toContain("curl");
    expect(cmd).not.toContain("wget");
    expect(cmd).toContain("/dev/tcp");
  });

  it("does NOT emit include[] when no services are listed", async () => {
    await generateInfraCompose({
      clientName: "tc",
      clientDir: dir,
      ports: allocatePortBlock("tc", 0),
      infrastructure: fullInfra,
      serviceIncludes: [],
    });
    const { parsed } = await readGeneratedCompose();
    expect(parsed.include).toBeUndefined();
  });

  it("emits include[] entries when service paths are provided", async () => {
    await generateInfraCompose({
      clientName: "tc",
      clientDir: dir,
      ports: allocatePortBlock("tc", 0),
      infrastructure: fullInfra,
      serviceIncludes: ["./api/docker-compose.yaml", "./store/docker-compose.yaml"],
    });
    const { parsed } = await readGeneratedCompose();
    expect(parsed.include).toEqual([
      { path: "./api/docker-compose.yaml" },
      { path: "./store/docker-compose.yaml" },
    ]);
  });

  // ADR-0008/0009/0010 — promoted client-level services
  it("emits clickhouse + localstack + keycloak + mlflow + mage when all enabled", async () => {
    await generateInfraCompose({
      clientName: "tc",
      clientDir: dir,
      ports: allocatePortBlock("tc", 0),
      infrastructure: allPromotedInfra,
    });
    const { parsed } = await readGeneratedCompose();
    const services = parsed.services as Record<string, unknown>;
    expect(services.clickhouse).toBeDefined();
    expect(services.localstack).toBeDefined();
    expect(services.keycloak).toBeDefined();
    expect(services.mlflow).toBeDefined();
    expect(services.mage).toBeDefined();
  });

  it("does NOT emit promoted services when their flags are off", async () => {
    await generateInfraCompose({
      clientName: "tc",
      clientDir: dir,
      ports: allocatePortBlock("tc", 0),
      infrastructure: minimalInfra,
    });
    const { parsed } = await readGeneratedCompose();
    const services = parsed.services as Record<string, unknown>;
    expect(services.clickhouse).toBeUndefined();
    expect(services.localstack).toBeUndefined();
    expect(services.keycloak).toBeUndefined();
    expect(services.mlflow).toBeUndefined();
    expect(services.mage).toBeUndefined();
  });

  // ADR-0014 — multiple Postgres instances
  it("emits one postgres service per declared instance", async () => {
    const ports = allocatePortBlock("tc", 0, { extraPostgresInstances: ["legacy", "analytics"] });
    await generateInfraCompose({
      clientName: "tc", clientDir: dir, ports,
      infrastructure: {
        kafka: false, jenkins: false,
        postgres: [
          { name: "default", version: "16" },
          { name: "legacy", version: "14" },
          { name: "analytics", version: "16" },
        ],
        clickhouse: false, localstack: false, keycloak: false, mlflow: false, mage: false,
        observability: { prometheus: false, grafana: false, tempo: false, jaeger: false, loki: false, clickhouse: false },
      } as never,
    });
    const { parsed } = await readGeneratedCompose();
    const services = parsed.services as Record<string, { image?: string; ports?: string[]; container_name?: string }>;
    expect(Object.keys(services)).toContain("postgres");
    expect(Object.keys(services)).toContain("postgres-legacy");
    expect(Object.keys(services)).toContain("postgres-analytics");
    // Default keeps existing names (back-compat)
    expect(services.postgres.image).toBe("postgres:16-alpine");
    expect(services.postgres.container_name).toBe("tc-postgres");
    expect(services.postgres.ports?.[0]).toBe("5432:5432");
    // Extras get suffixed names + expansion ports
    expect(services["postgres-legacy"].image).toBe("postgres:14-alpine");
    expect(services["postgres-legacy"].container_name).toBe("tc-postgres-legacy");
    expect(services["postgres-legacy"].ports?.[0]).toBe("5600:5432");
    expect(services["postgres-analytics"].ports?.[0]).toBe("5601:5432");
    // Each instance gets its own volume
    const volumes = parsed.volumes as Record<string, unknown>;
    expect(volumes).toHaveProperty("postgres-data");
    expect(volumes).toHaveProperty("postgres-data-legacy");
    expect(volumes).toHaveProperty("postgres-data-analytics");
  });

  it("emits a single postgres service for the boolean shorthand (back-compat)", async () => {
    await generateInfraCompose({
      clientName: "tc",
      clientDir: dir,
      ports: allocatePortBlock("tc", 0),
      infrastructure: fullInfra,
    });
    const { parsed } = await readGeneratedCompose();
    const services = parsed.services as Record<string, unknown>;
    expect(Object.keys(services).filter(k => k.startsWith("postgres"))).toEqual(["postgres"]);
  });

  it("applies tuning as -c flags on the postgres command", async () => {
    const ports = allocatePortBlock("tc", 0);
    await generateInfraCompose({
      clientName: "tc", clientDir: dir, ports,
      infrastructure: {
        kafka: false, jenkins: false,
        postgres: [
          { name: "default", version: "16", tuning: { sharedBuffers: "512MB", maxConnections: "200" } },
        ],
        clickhouse: false, localstack: false, keycloak: false, mlflow: false, mage: false,
        observability: { prometheus: false, grafana: false, tempo: false, jaeger: false, loki: false, clickhouse: false },
      } as never,
    });
    const { parsed } = await readGeneratedCompose();
    const cmd = (parsed.services as Record<string, { command?: string[] }>).postgres.command;
    expect(cmd?.[0]).toBe("postgres");
    expect(cmd).toContain("shared_buffers=512MB");
    expect(cmd).toContain("max_connections=200");
  });

  it("uses port-block-allocated ports for promoted services (not hardcoded)", async () => {
    const ports = allocatePortBlock("tc", 3);   // block 3 → +3 to all bases
    await generateInfraCompose({
      clientName: "tc", clientDir: dir, ports, infrastructure: allPromotedInfra,
    });
    const { parsed } = await readGeneratedCompose();
    const services = parsed.services as Record<string, { ports?: string[] }>;
    expect(services.clickhouse.ports?.[0]).toBe(`${ports.clickhouse}:8123`);
    expect(services.localstack.ports?.[0]).toBe(`${ports.localstack}:4566`);
    expect(services.keycloak.ports?.[0]).toBe(`${ports.keycloak}:8080`);
    expect(services.mlflow.ports?.[0]).toBe(`${ports.mlflow}:5000`);
    expect(services.mage.ports?.[0]).toBe(`${ports.mage}:6789`);
  });
});

describe("parseClientConfigYaml", () => {
  it("extracts infrastructure flags from the YAML", () => {
    const r = parseClientConfigYaml(`type: client
name: tc
infrastructure:
  kafka: true
  postgres: true
  jenkins: false
  observability:
    prometheus: true
    grafana: false
    jaeger: true
    loki: false
    clickhouse: false
services: []
`);
    expect(r.infrastructure.kafka).toBe(true);
    expect(r.infrastructure.jenkins).toBe(false);
    expect(r.infrastructure.observability!.prometheus).toBe(true);
    expect(r.infrastructure.observability!.grafana).toBe(false);
  });

  it("extracts services list", () => {
    const r = parseClientConfigYaml(`type: client
name: tc
services:
  - name: api
    path: ./api
  - name: store
    path: ./store
`);
    expect(r.serviceRefs).toEqual([
      { name: "api", path: "./api" },
      { name: "store", path: "./store" },
    ]);
  });

  it("handles empty services list", () => {
    const r = parseClientConfigYaml(`type: client
name: tc
services: []
`);
    expect(r.serviceRefs).toEqual([]);
  });

  it("preserves array form of postgres for ADR-0014 multi-instance configs", () => {
    const r = parseClientConfigYaml(`type: client
name: tc
infrastructure:
  kafka: false
  jenkins: false
  postgres:
    - name: default
      version: "16"
    - name: legacy
      version: "14"
services: []
`);
    expect(r.infrastructure.postgres).toEqual([
      { name: "default", version: "16" },
      { name: "legacy", version: "14" },
    ]);
  });
});

describe("regenerateInfraCompose — drives include from on-disk client config", () => {
  it("writes correct include[] entries from a client config with services", async () => {
    await writeYaml("blissful-infra.yaml", `type: client
name: tc
infrastructure:
  kafka: true
  postgres: true
  jenkins: false
services:
  - name: api
    path: ./api
`);
    await regenerateInfraCompose({
      clientName: "tc",
      clientDir: dir,
      ports: allocatePortBlock("tc", 0),
    });
    const { parsed } = await readGeneratedCompose();
    expect(parsed.include).toEqual([{ path: "./api/docker-compose.yaml" }]);
  });
});

// These tests require Docker. They're still fast (config --quiet doesn't start
// containers) but skip cleanly if Docker isn't running.
describe("docker compose config — validates the generated YAML actually parses", () => {
  it("full infra (every flag on) passes `docker compose config`", async () => {
    await generateInfraCompose({
      clientName: "tc",
      clientDir: dir,
      ports: allocatePortBlock("tc", 0),
      infrastructure: fullInfra,
    });
    const r = await dockerComposeConfigPasses();
    if (r.stderr.includes("Cannot connect")) return; // docker daemon down — skip
    expect(r.ok, r.stderr).toBe(true);
  });

  it("minimal infra (no flags on) still passes `docker compose config`", async () => {
    await generateInfraCompose({
      clientName: "tc",
      clientDir: dir,
      ports: allocatePortBlock("tc", 0),
      infrastructure: minimalInfra,
    });
    const r = await dockerComposeConfigPasses();
    if (r.stderr.includes("Cannot connect")) return;
    expect(r.ok, r.stderr).toBe(true);
  });

  // Regression: when an included service compose declared `infra` as
  // `external: true`, Compose's merge inherited that flag and refused to
  // create the network — every `up` failed with "network ... declared as
  // external, but could not be found". Guard against that recurring.
  it("after include, the merged `infra` network is NOT external", async () => {
    // Write a service compose that mimics what generateServiceCompose produces.
    const { mkdir } = await import("node:fs/promises");
    const svcDir = join(dir, "api");
    await mkdir(svcDir, { recursive: true });
    await writeFile(join(svcDir, "docker-compose.yaml"), `networks:
  infra:
    name: tc_infra
  api-internal:
    driver: bridge

services:
  api-backend:
    image: alpine
    networks:
      api-internal: {}
      infra: {}
    command: ["sleep", "infinity"]
`);

    await generateInfraCompose({
      clientName: "tc",
      clientDir: dir,
      ports: allocatePortBlock("tc", 0),
      infrastructure: minimalInfra,
      serviceIncludes: ["./api/docker-compose.yaml"],
    });

    const r = await execa("docker", [
      "compose", "-f", join(dir, "docker-compose.infra.yaml"), "config",
    ], { reject: false });
    if (r.stderr.includes("Cannot connect")) return;
    expect(r.exitCode, r.stderr).toBe(0);

    const merged = yaml.load(r.stdout) as Record<string, unknown>;
    const networks = merged.networks as Record<string, { external?: boolean }>;
    expect(
      networks.infra.external,
      "merged `infra` network must NOT be external — Compose include merge bug",
    ).not.toBe(true);
  });
});
