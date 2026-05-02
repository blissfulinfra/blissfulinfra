import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import yaml from "js-yaml";
import { generateLambdaServiceCompose, computeServicePorts } from "../service.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "binf-lambda-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("generateLambdaServiceCompose", () => {
  it("emits a localstack service + a deployer sidecar (no backend, no frontend)", () => {
    const compose = generateLambdaServiceCompose("dev", "hello", computeServicePorts(0, 0));
    const parsed = yaml.load(compose) as Record<string, unknown>;
    const services = parsed.services as Record<string, unknown>;

    expect(Object.keys(services).sort()).toEqual(["hello-deployer", "hello-localstack"]);
    // No backend / frontend containers — that's the whole point of the lambda shape
    expect(services["hello-backend"]).toBeUndefined();
    expect(services["hello-frontend"]).toBeUndefined();
  });

  it("references infra network (NOT external — fixed in ADR-0001)", () => {
    const compose = generateLambdaServiceCompose("dev", "hello", computeServicePorts(0, 0));
    const parsed = yaml.load(compose) as Record<string, unknown>;
    const networks = parsed.networks as Record<string, { external?: boolean; name?: string }>;
    expect(networks.infra.name).toBe("dev_infra");
    expect(networks.infra.external).toBeUndefined();
  });

  it("declares the per-service internal network", () => {
    const compose = generateLambdaServiceCompose("dev", "hello", computeServicePorts(0, 0));
    const parsed = yaml.load(compose) as Record<string, unknown>;
    const networks = parsed.networks as Record<string, unknown>;
    expect(networks["hello-internal"]).toBeDefined();
  });

  it("port mapping uses the allocated localstack port", () => {
    const compose = generateLambdaServiceCompose("acme", "api", computeServicePorts(2, 1));
    const parsed = yaml.load(compose) as Record<string, unknown>;
    const services = parsed.services as Record<string, { ports?: string[] }>;
    // block 2 + service 1 → base = 13000 + 200 + 4 = 13204; localstack is +2
    expect(services["api-localstack"].ports?.[0]).toBe("13206:4566");
  });

  it("deployer waits for localstack to be healthy", () => {
    const compose = generateLambdaServiceCompose("dev", "hello", computeServicePorts(0, 0));
    const parsed = yaml.load(compose) as Record<string, unknown>;
    const services = parsed.services as Record<string, { depends_on?: Record<string, { condition?: string }> }>;
    expect(services["hello-deployer"].depends_on?.["hello-localstack"].condition).toBe("service_healthy");
  });

  it("deployer is restart: no (one-shot)", () => {
    const compose = generateLambdaServiceCompose("dev", "hello", computeServicePorts(0, 0));
    const parsed = yaml.load(compose) as Record<string, unknown>;
    const services = parsed.services as Record<string, { restart?: string }>;
    expect(services["hello-deployer"].restart).toBe("no");
  });

  it("docker compose config validates the generated YAML", async () => {
    // Set up a minimal client compose that includes the lambda service compose,
    // mirroring how it'd be merged in production.
    const composeContent = generateLambdaServiceCompose("dev", "hello", computeServicePorts(0, 0));
    const svcDir = join(dir, "hello");
    await mkdir(svcDir, { recursive: true });
    await writeFile(join(svcDir, "docker-compose.yaml"), composeContent);
    // Mandatory: deploy.sh exists (deployer mounts cwd)
    await writeFile(join(svcDir, "deploy.sh"), "#!/bin/sh\nexit 0\n");

    // Top-level parent compose
    await writeFile(
      join(dir, "docker-compose.infra.yaml"),
      `name: dev
include:
  - path: ./hello/docker-compose.yaml
networks:
  infra:
    name: dev_infra
services: {}
`,
    );

    const r = await execa("docker", [
      "compose", "-f", join(dir, "docker-compose.infra.yaml"), "config", "--quiet",
    ], { reject: false });
    if (r.stderr.includes("Cannot connect")) return; // docker daemon down — skip
    expect(r.exitCode, r.stderr).toBe(0);
  });
});
