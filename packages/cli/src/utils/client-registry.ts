import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  ClientRegistrySchema,
  PortBlockSchema,
  normalizePostgresInstances,
  type ClientInfrastructure,
  type ClientRegistry,
  type PortBlock,
} from "@blissful-infra/shared";
import { checkPorts } from "./ports.js";

// Resolved at call time so tests can override via the BLISSFUL_HOME env var
// without the module needing to be reloaded.
function blissfulHome(): string {
  return process.env.BLISSFUL_HOME ?? path.join(os.homedir(), ".blissful-infra");
}
function clientsDir(): string { return path.join(blissfulHome(), "clients"); }
function registryPath(): string { return path.join(blissfulHome(), "registry.json"); }

// Port block base values — each client offsets by blockIndex.
// Originally chosen to avoid collisions with the legacy flat-model defaults.
// When adding new components, pick a base port that's unlikely to conflict
// with anything else on a typical dev laptop (avoid 80, 443, 3000, 5432, 8080).
const PORT_BASES = {
  jenkins: 8090,
  grafana: 3010,
  prometheus: 9090,
  // ADR-0016: Tempo replaced Jaeger. The Jaeger port (16680) is no longer
  // bound to anything but stays in the schema as optional for back-compat.
  // Tempo's HTTP query API is on 3200 in-container; we map to a free range.
  tempo: 3200,
  kafka: 9094,
  postgres: 5432,
  dashboard: 3002,
  clickhouse: 8120,  // ADR-0008: ClickHouse HTTP interface
  localstack: 4570,  // ADR-0008: was 4566 hardcoded; bumped to avoid conflict with legacy per-service LocalStack
  keycloak: 8050,    // ADR-0009
  mlflow: 5050,      // ADR-0010: was 5001 hardcoded in old ai-pipeline plugin
  mage: 6750,        // ADR-0010: was 6789 hardcoded in old ai-pipeline plugin
} as const;

// ADR-0014 — extra Postgres instances (beyond `default`) get ports from the
// expansion range. Each block reserves 10 expansion slots; that caps a
// single client at 10 non-default Postgres instances, well above realistic
// need. Compute: 5600 + blockIndex * EXTRAS_PER_BLOCK + extraIndex.
const POSTGRES_EXTRA_BASE = 5600;
const POSTGRES_EXTRAS_PER_BLOCK = 10;

export function getClientsDir(): string {
  return clientsDir();
}

export function getClientDir(clientName: string): string {
  return path.join(clientsDir(), clientName);
}

export async function loadRegistry(): Promise<ClientRegistry> {
  try {
    const raw = await fs.readFile(registryPath(), "utf-8");
    return ClientRegistrySchema.parse(JSON.parse(raw));
  } catch {
    return { clients: {}, nextBlockIndex: 0 };
  }
}

export async function saveRegistry(registry: ClientRegistry): Promise<void> {
  await fs.mkdir(blissfulHome(), { recursive: true });
  await fs.writeFile(registryPath(), JSON.stringify(registry, null, 2), "utf-8");
}

export function allocatePortBlock(
  clientName: string,
  blockIndex: number,
  opts: { extraPostgresInstances?: string[] } = {},
): PortBlock {
  // All ports are populated unconditionally (PortBlockSchema makes the
  // "promoted" ones optional, but it's easier to always allocate and let the
  // compose generator decide whether to expose them based on the
  // ClientInfrastructure flags).
  const extras = opts.extraPostgresInstances ?? [];
  if (extras.length > POSTGRES_EXTRAS_PER_BLOCK) {
    throw new Error(
      `Too many extra Postgres instances (${extras.length}); max ${POSTGRES_EXTRAS_PER_BLOCK} per client`,
    );
  }
  const postgresInstances: Record<string, number> = {};
  for (let i = 0; i < extras.length; i++) {
    postgresInstances[extras[i]] =
      POSTGRES_EXTRA_BASE + blockIndex * POSTGRES_EXTRAS_PER_BLOCK + i;
  }

  return PortBlockSchema.parse({
    clientName,
    blockIndex,
    jenkins:    PORT_BASES.jenkins    + blockIndex,
    grafana:    PORT_BASES.grafana    + blockIndex,
    prometheus: PORT_BASES.prometheus + blockIndex,
    tempo:      PORT_BASES.tempo      + blockIndex,
    kafka:      PORT_BASES.kafka      + blockIndex,
    postgres:   PORT_BASES.postgres   + blockIndex,
    dashboard:  PORT_BASES.dashboard  + blockIndex,
    clickhouse: PORT_BASES.clickhouse + blockIndex,
    localstack: PORT_BASES.localstack + blockIndex,
    keycloak:   PORT_BASES.keycloak   + blockIndex,
    mlflow:     PORT_BASES.mlflow     + blockIndex,
    mage:       PORT_BASES.mage       + blockIndex,
    ...(extras.length > 0 ? { postgresInstances } : {}),
  });
}

/**
 * Pull the list of non-default Postgres instance names from a client's
 * infrastructure config (ADR-0014). Returns [] for the boolean shorthand
 * (no extras) or for clients with only the `default` instance.
 */
export function extraPostgresInstanceNames(
  infrastructure: ClientInfrastructure | undefined,
): string[] {
  if (!infrastructure) return [];
  return normalizePostgresInstances(infrastructure.postgres)
    .filter(i => i.name !== "default")
    .map(i => i.name);
}

export async function registerClient(
  clientName: string,
  opts: { extraPostgresInstances?: string[] } = {},
): Promise<PortBlock> {
  const registry = await loadRegistry();

  if (registry.clients[clientName]) {
    return registry.clients[clientName];
  }

  const portBlock = allocatePortBlock(clientName, registry.nextBlockIndex, opts);
  registry.clients[clientName] = portBlock;
  registry.nextBlockIndex += 1;
  await saveRegistry(registry);
  return portBlock;
}

export async function unregisterClient(clientName: string): Promise<void> {
  const registry = await loadRegistry();
  delete registry.clients[clientName];
  await saveRegistry(registry);
}

export async function getClientPortBlock(clientName: string): Promise<PortBlock | null> {
  const registry = await loadRegistry();
  return registry.clients[clientName] ?? null;
}

export async function listClients(): Promise<PortBlock[]> {
  const registry = await loadRegistry();
  return Object.values(registry.clients);
}

export function getClientRequiredPorts(
  ports: PortBlock,
  infrastructure: ClientInfrastructure,
): { port: number; service: string }[] {
  const required: { port: number; service: string }[] = [];
  const obs = infrastructure.observability ?? {
    prometheus: true, grafana: true, tempo: true, jaeger: false, loki: true, clickhouse: false,
  };

  if (infrastructure.kafka) required.push({ port: ports.kafka, service: "Kafka" });
  // ADR-0014 — every postgres instance contributes a host port. The
  // `default` instance uses ports.postgres; others come from
  // ports.postgresInstances. `infrastructure.postgres === false` skips all.
  const postgresInstances = normalizePostgresInstances(infrastructure.postgres);
  for (const instance of postgresInstances) {
    if (instance.name === "default") {
      required.push({ port: ports.postgres, service: "Postgres" });
    } else {
      const p = ports.postgresInstances?.[instance.name];
      if (p !== undefined) required.push({ port: p, service: `Postgres (${instance.name})` });
    }
  }
  if (infrastructure.jenkins) required.push({ port: ports.jenkins, service: "Jenkins" });
  if (obs.prometheus) required.push({ port: ports.prometheus, service: "Prometheus" });
  if (obs.grafana) required.push({ port: ports.grafana, service: "Grafana" });
  // ADR-0016: Tempo replaced Jaeger. Legacy `obs.jaeger: true` is treated as
  // an alias for tempo. Either one binds the tempo port.
  if (obs.tempo || obs.jaeger) required.push({ port: ports.tempo, service: "Tempo" });
  // Promoted client-level platform services (ADR-0008/0009/0010)
  if (infrastructure.clickhouse && ports.clickhouse) required.push({ port: ports.clickhouse, service: "ClickHouse" });
  if (infrastructure.localstack && ports.localstack) required.push({ port: ports.localstack, service: "LocalStack" });
  if (infrastructure.keycloak   && ports.keycloak)   required.push({ port: ports.keycloak,   service: "Keycloak" });
  if (infrastructure.mlflow     && ports.mlflow)     required.push({ port: ports.mlflow,     service: "MLflow" });
  if (infrastructure.mage       && ports.mage)       required.push({ port: ports.mage,       service: "Mage" });
  required.push({ port: ports.dashboard, service: "Dashboard" });

  return required;
}

/**
 * Allocate a port block for a client, advancing the block index until all
 * required host ports are free. Throws if no free block is found within
 * `maxBlocks` attempts.
 */
export async function allocateFreePortBlock(
  clientName: string,
  infrastructure: ClientInfrastructure,
  maxBlocks = 32,
): Promise<PortBlock> {
  const registry = await loadRegistry();

  if (registry.clients[clientName]) {
    return registry.clients[clientName];
  }

  let attempts = 0;
  let blockIndex = registry.nextBlockIndex;
  const extraPostgresInstances = extraPostgresInstanceNames(infrastructure);

  while (attempts < maxBlocks) {
    const candidate = allocatePortBlock(clientName, blockIndex, { extraPostgresInstances });
    const required = getClientRequiredPorts(candidate, infrastructure);
    const results = await checkPorts(required);
    const conflicts = results.filter(r => r.inUse);

    if (conflicts.length === 0) {
      registry.clients[clientName] = candidate;
      registry.nextBlockIndex = Math.max(registry.nextBlockIndex, blockIndex + 1);
      await saveRegistry(registry);
      return candidate;
    }

    blockIndex += 1;
    attempts += 1;
  }

  throw new Error(`No free port block found after ${maxBlocks} attempts`);
}
