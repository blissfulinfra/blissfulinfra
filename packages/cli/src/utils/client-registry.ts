import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  ClientRegistrySchema,
  PortBlockSchema,
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

// Port block base values — each client offsets by blockIndex
const PORT_BASES = {
  jenkins: 8090,
  grafana: 3010,
  prometheus: 9090,
  jaeger: 16680,
  kafka: 9094,
  postgres: 5432,
  dashboard: 3002,
} as const;

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

export function allocatePortBlock(clientName: string, blockIndex: number): PortBlock {
  return PortBlockSchema.parse({
    clientName,
    blockIndex,
    jenkins: PORT_BASES.jenkins + blockIndex,
    grafana: PORT_BASES.grafana + blockIndex,
    prometheus: PORT_BASES.prometheus + blockIndex,
    jaeger: PORT_BASES.jaeger + blockIndex,
    kafka: PORT_BASES.kafka + blockIndex,
    postgres: PORT_BASES.postgres + blockIndex,
    dashboard: PORT_BASES.dashboard + blockIndex,
  });
}

export async function registerClient(clientName: string): Promise<PortBlock> {
  const registry = await loadRegistry();

  if (registry.clients[clientName]) {
    return registry.clients[clientName];
  }

  const portBlock = allocatePortBlock(clientName, registry.nextBlockIndex);
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
    prometheus: true, grafana: true, jaeger: true, loki: true, clickhouse: false,
  };

  if (infrastructure.kafka) required.push({ port: ports.kafka, service: "Kafka" });
  if (infrastructure.postgres) required.push({ port: ports.postgres, service: "Postgres" });
  if (infrastructure.jenkins) required.push({ port: ports.jenkins, service: "Jenkins" });
  if (obs.prometheus) required.push({ port: ports.prometheus, service: "Prometheus" });
  if (obs.grafana) required.push({ port: ports.grafana, service: "Grafana" });
  if (obs.jaeger) required.push({ port: ports.jaeger, service: "Jaeger" });
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

  while (attempts < maxBlocks) {
    const candidate = allocatePortBlock(clientName, blockIndex);
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
