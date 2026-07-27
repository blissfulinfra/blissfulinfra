import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import type { ClientOntology, OntologyEdge } from "@blissful-infra/shared";
import { loadSavedOntology, saveOntology, getNodeConfig, wireEdge } from "../ontology.js";

let testHome: string;

beforeEach(async () => {
  testHome = await mkdtemp(join(tmpdir(), "binf-ontology-"));
  process.env.BLISSFUL_HOME = testHome;
});

afterEach(async () => {
  delete process.env.BLISSFUL_HOME;
  await rm(testHome, { recursive: true, force: true });
});

const TENANT = "acme";
const tenantDir = () => join(testHome, "tenants", TENANT);
const serviceDir = (project: string, service: string) =>
  join(tenantDir(), "projects", project, "services", service);

async function seedServiceCompose(project: string, service: string): Promise<string> {
  const dir = serviceDir(project, service);
  await mkdir(dir, { recursive: true });
  const composePath = join(dir, "docker-compose.yaml");
  await writeFile(composePath, yaml.dump({
    services: {
      [service]: {
        container_name: `${TENANT}-${project}-${service}`,
        build: { context: "." },
        environment: { SERVICE_NAME: service },
      },
    },
  }));
  return composePath;
}

describe("saveOntology / loadSavedOntology", () => {
  it("round-trips a graph through the tenant dir", async () => {
    const graph: ClientOntology = {
      clientName: TENANT,
      nodes: [{ id: "service:shop:api", type: "service", label: "api", position: { x: 1, y: 2 } }],
      edges: [],
    };
    await saveOntology(TENANT, graph);
    const loaded = await loadSavedOntology(TENANT);
    expect(loaded?.nodes[0].id).toBe("service:shop:api");
    expect(loaded?.nodes[0].position).toEqual({ x: 1, y: 2 });
  });

  it("returns null when no overlay exists", async () => {
    expect(await loadSavedOntology(TENANT)).toBeNull();
  });

  it("rejects graphs that fail schema validation", async () => {
    await expect(
      saveOntology(TENANT, { nope: true } as unknown as ClientOntology),
    ).rejects.toThrow();
  });
});

describe("getNodeConfig", () => {
  it("resolves service nodes to the service compose file", async () => {
    const composePath = await seedServiceCompose("shop", "api");
    const config = await getNodeConfig(TENANT, "service:shop:api");
    expect(config.path).toBe(composePath);
    expect(config.content).toContain("acme-shop-api");
  });

  it("resolves project nodes to the project compose file", async () => {
    const projectDir = join(tenantDir(), "projects", "shop");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "docker-compose.project.yaml"), "services: {}\n");
    const config = await getNodeConfig(TENANT, "project:shop:kafka");
    expect(config.path).toBe(join(projectDir, "docker-compose.project.yaml"));
  });

  it("resolves tenant nodes to the tenant compose file", async () => {
    await mkdir(tenantDir(), { recursive: true });
    await writeFile(join(tenantDir(), "docker-compose.tenant.yaml"), "services: {}\n");
    const config = await getNodeConfig(TENANT, "tenant:loki");
    expect(config.path).toBe(join(tenantDir(), "docker-compose.tenant.yaml"));
  });

  it("throws on unrecognized node ids", async () => {
    await expect(getNodeConfig(TENANT, "bogus")).rejects.toThrow(/Unrecognized/);
  });
});

describe("wireEdge", () => {
  it("injects kafka env + depends_on into the source service compose", async () => {
    const composePath = await seedServiceCompose("shop", "api");
    const edge: OntologyEdge = {
      id: "e1",
      source: "service:shop:api",
      target: "project:shop:kafka",
      type: "kafka",
      wired: false,
    };
    const result = await wireEdge(TENANT, edge);
    expect(result.edge.wired).toBe(true);

    const doc = yaml.load(await readFile(composePath, "utf-8")) as {
      services: Record<string, { environment: Record<string, string>; depends_on: Record<string, unknown> }>;
    };
    expect(doc.services.api.environment.KAFKA_BOOTSTRAP_SERVERS).toBe("kafka:9092");
    expect(doc.services.api.depends_on).toHaveProperty("kafka");
  });

  it("injects http env for service-to-service edges", async () => {
    const composePath = await seedServiceCompose("shop", "web");
    await seedServiceCompose("shop", "orders-api");
    const edge: OntologyEdge = {
      id: "e2",
      source: "service:shop:web",
      target: "service:shop:orders-api",
      type: "http",
      wired: false,
    };
    await wireEdge(TENANT, edge);
    const doc = yaml.load(await readFile(composePath, "utf-8")) as {
      services: Record<string, { environment: Record<string, string> }>;
    };
    expect(doc.services.web.environment.ORDERS_API_URL).toBe("http://orders-api:8080");
  });

  it("refuses non-service-originated edges", async () => {
    const edge: OntologyEdge = {
      id: "e3",
      source: "tenant:loki",
      target: "service:shop:api",
      type: "http",
      wired: false,
    };
    await expect(wireEdge(TENANT, edge)).rejects.toThrow(/service-originated/);
  });
});
