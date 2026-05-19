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

describe("generateLambdaServiceCompose (post ADR-0008 — LocalStack at client level)", () => {
  it("emits ONLY a deployer (LocalStack lives at client level now)", () => {
    const compose = generateLambdaServiceCompose("dev", "hello", computeServicePorts(0, 0));
    const parsed = yaml.load(compose) as Record<string, unknown>;
    const services = parsed.services as Record<string, unknown>;

    expect(Object.keys(services)).toEqual(["hello-deployer"]);
    expect(services["hello-localstack"]).toBeUndefined();
    expect(services["hello-backend"]).toBeUndefined();
    expect(services["hello-frontend"]).toBeUndefined();
  });

  it("references infra network (NOT external)", () => {
    const compose = generateLambdaServiceCompose("dev", "hello", computeServicePorts(0, 0));
    const parsed = yaml.load(compose) as Record<string, unknown>;
    const networks = parsed.networks as Record<string, { external?: boolean; name?: string }>;
    expect(networks.infra.name).toBe("dev_infra");
    expect(networks.infra.external).toBeUndefined();
  });

  it("deployer joins the infra network so it can talk to client-level LocalStack", () => {
    const compose = generateLambdaServiceCompose("dev", "hello", computeServicePorts(0, 0));
    const parsed = yaml.load(compose) as Record<string, unknown>;
    const services = parsed.services as Record<string, { networks?: string[] }>;
    expect(services["hello-deployer"].networks).toEqual(["infra"]);
  });

  it("deployer points AWS_ENDPOINT_URL at the client-level localstack hostname", () => {
    const compose = generateLambdaServiceCompose("dev", "hello", computeServicePorts(0, 0));
    const parsed = yaml.load(compose) as Record<string, unknown>;
    const services = parsed.services as Record<string, { environment?: Record<string, string> }>;
    expect(services["hello-deployer"].environment?.AWS_ENDPOINT_URL).toBe("http://localstack:4566");
  });

  it("deployer waits for the client-level localstack health", () => {
    const compose = generateLambdaServiceCompose("dev", "hello", computeServicePorts(0, 0));
    const parsed = yaml.load(compose) as Record<string, unknown>;
    const services = parsed.services as Record<string, { depends_on?: Record<string, { condition?: string }> }>;
    expect(services["hello-deployer"].depends_on?.localstack.condition).toBe("service_healthy");
  });

  it("deployer is restart: no (one-shot)", () => {
    const compose = generateLambdaServiceCompose("dev", "hello", computeServicePorts(0, 0));
    const parsed = yaml.load(compose) as Record<string, unknown>;
    const services = parsed.services as Record<string, { restart?: string }>;
    expect(services["hello-deployer"].restart).toBe("no");
  });

  it("docker compose config validates the generated YAML when included from a parent with localstack", async () => {
    // Build the parent compose simulating a client with LocalStack at client level
    const composeContent = generateLambdaServiceCompose("dev", "hello", computeServicePorts(0, 0));
    const svcDir = join(dir, "hello");
    await mkdir(svcDir, { recursive: true });
    await writeFile(join(svcDir, "docker-compose.yaml"), composeContent);
    await writeFile(join(svcDir, "deploy.sh"), "#!/bin/sh\nexit 0\n");

    await writeFile(
      join(dir, "docker-compose.infra.yaml"),
      `name: dev
include:
  - path: ./hello/docker-compose.yaml
networks:
  infra:
    name: dev_infra
services:
  localstack:
    image: floci/floci:latest
    container_name: dev-localstack
    networks: [infra]
    healthcheck:
      test: ["CMD", "true"]
      interval: 5s
`,
    );

    const r = await execa("docker", [
      "compose", "-f", join(dir, "docker-compose.infra.yaml"), "config", "--quiet",
    ], { reject: false });
    if (r.stderr.includes("Cannot connect")) return;
    expect(r.exitCode, r.stderr).toBe(0);
  });
});
