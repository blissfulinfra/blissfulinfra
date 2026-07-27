import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import {
  ClientOntologySchema,
  type ClientOntology,
  type OntologyEdge,
} from "@blissful-infra/shared";
import { getTenantDir, getProjectDir, getServiceDir } from "./tenant-registry.js";
import { generateTypescriptClient } from "../codegen/typescript.js";

export interface WireResult {
  edge: OntologyEdge;
  written: string[];
  warnings: string[];
}

const ONTOLOGY_FILE = "ontology.json";

/**
 * Node id conventions (must match buildTenantOntology in server/api.ts):
 *   service:<project>:<service>   one service container
 *   project:<project>:<role>      project infra (kafka | postgres | gateway)
 *   tenant:<component>            tenant infra (jenkins, loki, tempo, ...)
 */
interface ParsedNodeId {
  kind: "service" | "project" | "tenant";
  project?: string;
  name: string;
}

function parseNodeId(nodeId: string): ParsedNodeId {
  const parts = nodeId.split(":");
  if (parts[0] === "service" && parts.length === 3) {
    return { kind: "service", project: parts[1], name: parts[2] };
  }
  if (parts[0] === "project" && parts.length === 3) {
    return { kind: "project", project: parts[1], name: parts[2] };
  }
  if (parts[0] === "tenant" && parts.length === 2) {
    return { kind: "tenant", name: parts[1] };
  }
  throw new Error(`Unrecognized ontology node id: ${nodeId}`);
}

/**
 * The saved overlay: user-arranged positions and hand-drawn edges persisted
 * at ~/.blissful-infra/tenants/<tenant>/ontology.json. The live graph itself
 * is derived from the registry on every GET (buildTenantOntology).
 */
export async function loadSavedOntology(tenant: string): Promise<ClientOntology | null> {
  try {
    const raw = await fs.readFile(path.join(getTenantDir(tenant), ONTOLOGY_FILE), "utf-8");
    return ClientOntologySchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveOntology(tenant: string, graph: ClientOntology): Promise<void> {
  const validated = ClientOntologySchema.parse(graph);
  const tenantDir = getTenantDir(tenant);
  await fs.mkdir(tenantDir, { recursive: true });
  await fs.writeFile(path.join(tenantDir, ONTOLOGY_FILE), JSON.stringify(validated, null, 2), "utf-8");
}

/**
 * Read the compose YAML backing a node. Services own docker-compose.yaml in
 * their service dir; project infra shares docker-compose.project.yaml; tenant
 * infra shares docker-compose.tenant.yaml. The UI scopes the shared files.
 */
export async function getNodeConfig(tenant: string, nodeId: string): Promise<{ path: string; content: string }> {
  const parsed = parseNodeId(nodeId);
  let filePath: string;
  switch (parsed.kind) {
    case "service":
      filePath = path.join(getServiceDir(tenant, parsed.project!, parsed.name), "docker-compose.yaml");
      break;
    case "project":
      filePath = path.join(getProjectDir(tenant, parsed.project!), "docker-compose.project.yaml");
      break;
    case "tenant":
      filePath = path.join(getTenantDir(tenant), "docker-compose.tenant.yaml");
      break;
  }
  return { path: filePath, content: await fs.readFile(filePath, "utf-8") };
}

export async function setNodeConfig(tenant: string, nodeId: string, content: string): Promise<void> {
  const { path: filePath } = await getNodeConfig(tenant, nodeId);
  await fs.writeFile(filePath, content, "utf-8");
}

/**
 * Promote a visual edge to real compose wiring. Two-step:
 *   1. Inject env vars + depends_on into the source service's compose file.
 *   2. If a contract is defined, write it to the source service's `contracts/`
 *      directory and run codegen so the source service has a typed client/
 *      producer it can import.
 *
 * Only service-originated edges can be wired; the target may be another
 * service in the same project or a project infra component.
 */
export async function wireEdge(tenant: string, edge: OntologyEdge): Promise<WireResult> {
  const source = parseNodeId(edge.source);
  if (source.kind !== "service") {
    throw new Error("Wiring promotion currently only supported for service-originated edges");
  }
  const target = parseNodeId(edge.target);
  const targetLocal = target.name;

  const sourceDir = getServiceDir(tenant, source.project!, source.name);
  const composePath = path.join(sourceDir, "docker-compose.yaml");
  const raw = await fs.readFile(composePath, "utf-8");
  const doc = (yaml.load(raw) ?? {}) as Record<string, unknown>;
  const services = (doc.services ?? {}) as Record<string, Record<string, unknown>>;
  const sourceService = services[source.name];
  if (!sourceService) {
    throw new Error(`Service '${source.name}' not found in ${composePath}`);
  }

  const env = (sourceService.environment ?? {}) as Record<string, string>;
  const dependsRaw = sourceService.depends_on;
  const depends: Record<string, { condition: string }> = Array.isArray(dependsRaw)
    ? Object.fromEntries((dependsRaw as string[]).map(d => [d, { condition: "service_started" }]))
    : ((dependsRaw ?? {}) as Record<string, { condition: string }>);

  const envKey = `${targetLocal.toUpperCase().replace(/-/g, "_")}_URL`;
  switch (edge.type) {
    case "http":
      env[envKey] = `http://${targetLocal}:8080`;
      break;
    case "database":
      env[`${targetLocal.toUpperCase()}_HOST`] = targetLocal;
      env[`${targetLocal.toUpperCase()}_PORT`] = "5432";
      break;
    case "kafka":
      env.KAFKA_BOOTSTRAP_SERVERS = `${targetLocal}:9092`;
      break;
    case "custom":
      if (edge.properties?.envKey && edge.properties?.envValue) {
        env[edge.properties.envKey] = edge.properties.envValue;
      }
      break;
  }

  if (!depends[targetLocal]) {
    depends[targetLocal] = { condition: "service_started" };
  }

  sourceService.environment = env;
  sourceService.depends_on = depends;
  services[source.name] = sourceService;
  doc.services = services;

  await fs.writeFile(composePath, yaml.dump(doc, { lineWidth: 120 }), "utf-8");

  const written: string[] = [];
  const warnings: string[] = [];

  if (edge.contract?.schema) {
    const contractsDir = path.join(sourceDir, "contracts");
    await fs.mkdir(contractsDir, { recursive: true });

    if (edge.type === "http" && edge.contract.format === "openapi") {
      const specRel = path.join("contracts", `${targetLocal}.openapi.yaml`);
      const specAbs = path.join(sourceDir, specRel);
      await fs.writeFile(specAbs, edge.contract.schema, "utf-8");
      written.push(specRel);

      const outputRel = path.join("src", "generated", `${targetLocal}-client`);
      try {
        await generateTypescriptClient(specRel, { language: "typescript", output: outputRel }, sourceDir);
        written.push(path.join(outputRel, "index.ts"));
        written.push(path.join(outputRel, "client.ts"));
      } catch (error) {
        warnings.push(`Codegen failed: ${(error as Error).message}`);
      }
    } else if (edge.type === "kafka" && edge.contract.format === "avro") {
      const specRel = path.join("contracts", `${targetLocal}.avsc`);
      await fs.writeFile(path.join(sourceDir, specRel), edge.contract.schema, "utf-8");
      written.push(specRel);
      warnings.push("Avro producer codegen coming soon — schema saved, env vars injected");
    } else if (edge.type === "database" && edge.contract.format === "sql") {
      const specRel = path.join("contracts", `${targetLocal}.sql`);
      await fs.writeFile(path.join(sourceDir, specRel), edge.contract.schema, "utf-8");
      written.push(specRel);
      warnings.push("SQL migration codegen coming soon — schema saved, env vars injected");
    }
  }

  return { edge: { ...edge, wired: true }, written, warnings };
}
