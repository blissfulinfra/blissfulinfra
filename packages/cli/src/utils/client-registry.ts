import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  ClientRegistrySchema,
  PortBlockSchema,
  type ClientRegistry,
  type PortBlock,
} from "@blissful-infra/shared";

const BLISSFUL_HOME = path.join(os.homedir(), ".blissful-infra");
const CLIENTS_DIR = path.join(BLISSFUL_HOME, "clients");
const REGISTRY_PATH = path.join(BLISSFUL_HOME, "registry.json");

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
  return CLIENTS_DIR;
}

export function getClientDir(clientName: string): string {
  return path.join(CLIENTS_DIR, clientName);
}

export async function loadRegistry(): Promise<ClientRegistry> {
  try {
    const raw = await fs.readFile(REGISTRY_PATH, "utf-8");
    return ClientRegistrySchema.parse(JSON.parse(raw));
  } catch {
    return { clients: {}, nextBlockIndex: 0 };
  }
}

export async function saveRegistry(registry: ClientRegistry): Promise<void> {
  await fs.mkdir(BLISSFUL_HOME, { recursive: true });
  await fs.writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2), "utf-8");
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
