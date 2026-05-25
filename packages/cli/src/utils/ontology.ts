import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { execa } from "execa";
import {
  ClientOntologySchema,
  type ClientOntology,
  type OntologyNode,
  type OntologyNodeType,
  type OntologyEdge,
} from "@blissful-infra/shared";
import { getClientPortBlock } from "./client-registry.js";
import { parseClientConfigYaml } from "./infra-compose.js";
import { generateTypescriptClient } from "../codegen/typescript.js";

export interface WireResult {
  edge: OntologyEdge;
  written: string[];
  warnings: string[];
}

const ONTOLOGY_FILE = "ontology.json";

/**
 * Derive nodes from the client config on disk. Services come from the services
 * list; infra nodes from the infrastructure flags. Positions are not assigned
 * here — they're filled in by mergeWithDiscovered.
 *
 * `clientDir` is provided by the caller because the resolution differs between
 * host CLI usage (~/.blissful-infra/clients/<name>) and the dashboard container
 * (/projects/<name>, a bind mount over the same host dir).
 */
export async function discoverNodes(clientDir: string, clientName: string): Promise<Omit<OntologyNode, "position">[]> {
  const configPath = path.join(clientDir, "blissful-infra.yaml");

  let content: string;
  try {
    content = await fs.readFile(configPath, "utf-8");
  } catch {
    return [];
  }

  const { infrastructure, serviceRefs } = parseClientConfigYaml(content);

  // Port block lookup is best-effort: from inside the dashboard container the
  // registry isn't mounted, so we'd get null. That's fine — port labels are
  // decorative.
  let ports: Awaited<ReturnType<typeof getClientPortBlock>> = null;
  try {
    ports = await getClientPortBlock(clientName);
  } catch {
    ports = null;
  }

  const nodes: Omit<OntologyNode, "position">[] = [];

  for (const ref of serviceRefs) {
    nodes.push({ id: `service:${ref.name}`, type: "service", label: ref.name });
  }

  const infraNode = (id: OntologyNodeType, label: string, port?: number) => {
    nodes.push({ id: `infra:${id}`, type: id, label, port });
  };

  if (infrastructure.kafka)      infraNode("kafka", "Kafka", ports?.kafka);
  if (infrastructure.postgres)   infraNode("postgres", "Postgres", ports?.postgres);
  if (infrastructure.jenkins)    infraNode("jenkins", "Jenkins", ports?.jenkins);
  if (infrastructure.keycloak)   infraNode("keycloak", "Keycloak", ports?.keycloak);
  if (infrastructure.localstack) infraNode("localstack", "floci (AWS)", ports?.localstack);
  if (infrastructure.clickhouse) infraNode("clickhouse", "ClickHouse", ports?.clickhouse);
  if (infrastructure.mlflow)     infraNode("mlflow", "MLflow", ports?.mlflow);
  if (infrastructure.mage)       infraNode("mage", "Mage", ports?.mage);

  const obs = infrastructure.observability;
  if (obs?.grafana)    infraNode("grafana", "Grafana", ports?.grafana);
  if (obs?.prometheus) infraNode("prometheus", "Prometheus", ports?.prometheus);
  if (obs?.tempo)      infraNode("tempo", "Tempo", ports?.tempo);
  if (obs?.loki)       infraNode("loki", "Loki");

  infraNode("dashboard", "Dashboard", ports?.dashboard);

  return nodes;
}

/**
 * Lay out nodes that don't have a saved position. Services in the left column,
 * infra in the right column, evenly spaced top-to-bottom.
 */
export function autoLayout(nodes: Omit<OntologyNode, "position">[]): OntologyNode[] {
  const services = nodes.filter(n => n.type === "service");
  const infra = nodes.filter(n => n.type !== "service");
  const COL_LEFT = 80;
  const COL_RIGHT = 520;
  const ROW_HEIGHT = 110;
  const TOP_Y = 60;

  return [
    ...services.map((n, i) => ({ ...n, position: { x: COL_LEFT, y: TOP_Y + i * ROW_HEIGHT } })),
    ...infra.map((n, i) => ({ ...n, position: { x: COL_RIGHT, y: TOP_Y + i * ROW_HEIGHT } })),
  ];
}

/**
 * Merge saved graph with currently-discovered nodes:
 *   - keep saved positions for nodes that still exist
 *   - assign default positions to new nodes
 *   - drop saved nodes that no longer match the config
 *   - drop edges that reference dropped nodes
 *   - preserve all surviving edges
 */
export function mergeWithDiscovered(
  saved: ClientOntology | null,
  discovered: Omit<OntologyNode, "position">[],
  clientName: string,
): ClientOntology {
  const discoveredIds = new Set(discovered.map(n => n.id));
  const savedById = new Map((saved?.nodes ?? []).map(n => [n.id, n] as const));

  const laidOut = autoLayout(discovered);
  const nodes: OntologyNode[] = laidOut.map(n => {
    const savedNode = savedById.get(n.id);
    return savedNode
      ? { ...n, position: savedNode.position }
      : n;
  });

  const edges: OntologyEdge[] = (saved?.edges ?? []).filter(
    e => discoveredIds.has(e.source) && discoveredIds.has(e.target),
  );

  return { clientName, nodes, edges };
}

export async function loadOntology(clientDir: string, clientName: string): Promise<ClientOntology> {
  const discovered = await discoverNodes(clientDir, clientName);
  let saved: ClientOntology | null = null;
  try {
    const raw = await fs.readFile(path.join(clientDir, ONTOLOGY_FILE), "utf-8");
    saved = ClientOntologySchema.parse(JSON.parse(raw));
  } catch {
    // no saved ontology yet, or parse failed — fall back to discovery
  }
  return mergeWithDiscovered(saved, discovered, clientName);
}

export async function saveOntology(clientDir: string, graph: ClientOntology): Promise<void> {
  const validated = ClientOntologySchema.parse(graph);
  await fs.writeFile(path.join(clientDir, ONTOLOGY_FILE), JSON.stringify(validated, null, 2), "utf-8");
}

/**
 * Annotate nodes with their current docker container status. Pure I/O — does
 * not mutate stored ontology, runs at request time.
 */
export async function annotateStatus(clientName: string, graph: ClientOntology): Promise<ClientOntology> {
  let containers: { name: string; state: string }[] = [];
  try {
    const { stdout } = await execa("docker", [
      "ps", "-a", "--no-trunc",
      "--filter", `name=${clientName}-`,
      "--format", "{{.Names}}|{{.State}}",
    ], { reject: false });
    containers = stdout.trim().split("\n").filter(Boolean).map(line => {
      const [name, state] = line.split("|");
      return { name, state };
    });
  } catch {
    // docker not available — leave statuses as unknown
  }

  const nodes = graph.nodes.map(node => {
    const localName = node.id.startsWith("service:")
      ? node.id.slice("service:".length)
      : node.id.slice("infra:".length);
    const containerName = `${clientName}-${localName}`;
    const match = containers.find(c => c.name === containerName || c.name.startsWith(`${containerName}-`));
    if (!match) return { ...node, status: "unknown" as const };
    return { ...node, status: match.state === "running" ? "running" as const : "stopped" as const };
  });

  return { ...graph, nodes };
}

/**
 * Read the raw compose YAML for a node. Services have their own
 * docker-compose.yaml on disk; infra components share docker-compose.infra.yaml
 * — we return the whole infra file for infra nodes and let the UI scope it.
 */
export async function getNodeConfig(clientDir: string, nodeId: string): Promise<{ path: string; content: string }> {
  if (nodeId.startsWith("service:")) {
    const serviceName = nodeId.slice("service:".length);
    const filePath = path.join(clientDir, serviceName, "docker-compose.yaml");
    return { path: filePath, content: await fs.readFile(filePath, "utf-8") };
  }
  const filePath = path.join(clientDir, "docker-compose.infra.yaml");
  return { path: filePath, content: await fs.readFile(filePath, "utf-8") };
}

export async function setNodeConfig(clientDir: string, nodeId: string, content: string): Promise<void> {
  const { path: filePath } = await getNodeConfig(clientDir, nodeId);
  await fs.writeFile(filePath, content, "utf-8");
}

/**
 * Promote a visual edge to real compose wiring. Two-step:
 *   1. Inject env vars + depends_on into the source service's compose file.
 *   2. If a contract is defined, write it to the source service's `contracts/`
 *      directory and run codegen so the source service has a typed client/
 *      producer it can import.
 *
 * Returns the updated edge plus a list of files written and any warnings.
 */
export async function wireEdge(clientDir: string, edge: OntologyEdge): Promise<WireResult> {
  if (!edge.source.startsWith("service:")) {
    throw new Error("Wiring promotion currently only supported for service-originated edges");
  }
  const sourceName = edge.source.slice("service:".length);
  const targetLocal = edge.target.startsWith("service:")
    ? edge.target.slice("service:".length)
    : edge.target.slice("infra:".length);

  const sourceDir = path.join(clientDir, sourceName);
  const composePath = path.join(sourceDir, "docker-compose.yaml");
  const raw = await fs.readFile(composePath, "utf-8");
  const doc = (yaml.load(raw) ?? {}) as Record<string, unknown>;
  const services = (doc.services ?? {}) as Record<string, Record<string, unknown>>;
  const sourceService = services[sourceName];
  if (!sourceService) {
    throw new Error(`Service '${sourceName}' not found in ${composePath}`);
  }

  const env = (sourceService.environment ?? {}) as Record<string, string>;
  const depends = Array.isArray(sourceService.depends_on)
    ? (sourceService.depends_on as string[])
    : [];

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
      env.KAFKA_BOOTSTRAP_SERVERS = `${targetLocal}:29092`;
      break;
    case "custom":
      if (edge.properties?.envKey && edge.properties?.envValue) {
        env[edge.properties.envKey] = edge.properties.envValue;
      }
      break;
  }

  if (!depends.includes(targetLocal)) {
    depends.push(targetLocal);
  }

  sourceService.environment = env;
  sourceService.depends_on = depends;
  services[sourceName] = sourceService;
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

/**
 * Auto-wire helper: stamp a default kafka edge from `serviceName` → infra:kafka
 * into the client's ontology. Used by `service add` when ai-pipeline is enabled
 * so the data-pipeline shape appears in the Graph tab without user intervention.
 * No-op if the edge already exists.
 */
export async function autoWireKafkaEdge(clientDir: string, clientName: string, serviceName: string): Promise<void> {
  const graph = await loadOntology(clientDir, clientName);
  const sourceId = `service:${serviceName}`;
  const targetId = "infra:kafka";
  if (!graph.nodes.find(n => n.id === targetId)) return;
  if (graph.edges.find(e => e.source === sourceId && e.target === targetId)) return;

  const defaultAvro = `{
  "type": "record",
  "name": "Event",
  "namespace": "${clientName}.${serviceName}",
  "fields": [
    { "name": "id", "type": "string" },
    { "name": "timestamp", "type": "long" },
    { "name": "payload", "type": "string" }
  ]
}
`;

  graph.edges.push({
    id: `${sourceId}__${targetId}__${Date.now()}`,
    source: sourceId,
    target: targetId,
    type: "kafka",
    label: "publishes events",
    contract: { format: "avro", schema: defaultAvro },
    wired: false,
  });

  await saveOntology(clientDir, graph);
}
