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
  observability: { prometheus: true, grafana: true, jaeger: true, loki: true, clickhouse: false },
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
  observability: { prometheus: false, grafana: false, jaeger: false, loki: false, clickhouse: false },
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
  observability: { prometheus: false, grafana: false, jaeger: false, loki: false, clickhouse: false },
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
        observability: { prometheus: false, grafana: false, jaeger: true, loki: true, clickhouse: false } },
    });
    const { parsed } = await readGeneratedCompose();
    const services = parsed.services as Record<string, unknown>;
    expect(Object.keys(services)).toContain("kafka");
    expect(Object.keys(services)).toContain("postgres");
    expect(Object.keys(services)).toContain("jaeger");
    expect(Object.keys(services)).toContain("loki");
    expect(Object.keys(services)).toContain("dashboard");   // dashboard is always present
    expect(Object.keys(services)).not.toContain("jenkins");
    expect(Object.keys(services)).not.toContain("prometheus");
    expect(Object.keys(services)).not.toContain("grafana");
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
