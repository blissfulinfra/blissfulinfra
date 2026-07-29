/**
 * Read-side helpers for MCP tools.
 *
 * These run in-process against the registry, Docker and kubectl. Every
 * kubectl call is pinned to the tenant's kube context — a host can have
 * several kind clusters, and picking up whatever `kubectl config current-context`
 * happens to be would silently report another tenant's pods.
 */

import { execa } from "execa";
import {
  getTenant,
  listProjects,
  listServices,
  listTenants,
  readProjectRuntime,
} from "../../utils/tenant-registry.js";
import { clusterExists, kubeContext } from "../../utils/kind.js";
import type { ProjectRuntime, TenantPortBlock } from "@blissful-infra/shared";
import type { ServiceCoord } from "./coords.js";

export interface ServiceNode {
  name: string;
  type: string;
  ports: Record<string, number | string | undefined>;
  status: string;
}

export interface ProjectNode {
  name: string;
  runtime: ProjectRuntime;
  services: ServiceNode[];
}

export interface TenantNode {
  name: string;
  projects: ProjectNode[];
  clusterProvisioned: boolean;
}

/** `docker ps` once, keyed by container name, for compose-runtime status. */
async function dockerStates(): Promise<Map<string, string>> {
  const states = new Map<string, string>();
  try {
    const { stdout } = await execa(
      "docker",
      ["ps", "-a", "--format", "{{.Names}}\t{{.State}}"],
      { reject: false, timeout: 10_000 },
    );
    for (const line of stdout.split("\n")) {
      const [name, state] = line.split("\t");
      if (name) states.set(name, state ?? "unknown");
    }
  } catch {
    // Docker down — every service reports "unknown" rather than failing the
    // whole tree. An agent asking "what exists" should still get an answer.
  }
  return states;
}

function composeStatus(states: Map<string, string>, coords: ServiceCoord): string {
  if (states.size === 0) return "unknown (docker unavailable)";
  const prefix = `${coords.tenant}-${coords.project}-${coords.service}`;
  for (const [name, state] of states) {
    if (name.startsWith(prefix)) return state;
  }
  return "stopped";
}

/**
 * The single discovery call behind get_context. Returns exact coordinate names
 * so an agent can feed them straight back into the action tools.
 */
export async function tenantTree(): Promise<TenantNode[]> {
  const states = await dockerStates();
  const tenants = await listTenants();

  return Promise.all(
    tenants.map(async t => {
      const projects = await listProjects(t.name);
      return {
        name: t.name,
        clusterProvisioned: await clusterExists(t.name).catch(() => false),
        projects: await Promise.all(
          projects.map(async p => {
            const services = await listServices(t.name, p.name);
            const runtime = await readProjectRuntime(t.name, p.name).catch(() => "compose" as ProjectRuntime);
            return {
              name: p.name,
              runtime,
              services: services.map(s => ({
                name: s.name,
                type: s.type,
                ports: { ...s.ports },
                status: runtime === "kubernetes"
                  ? "see describe_service"
                  : composeStatus(states, { tenant: t.name, project: p.name, service: s.name }),
              })),
            };
          }),
        ),
      };
    }),
  );
}

export interface PodInfo {
  name: string;
  phase: string;
  ready: boolean;
  restarts: number;
  image: string;
}

/** Pods for a service, scoped to the tenant's cluster and the project namespace. */
export async function servicePods(coords: ServiceCoord): Promise<PodInfo[] | { error: string }> {
  try {
    const { stdout } = await execa(
      "kubectl",
      [
        "get", "pods",
        "-n", coords.project,
        "-l", `app=${coords.service}`,
        "--context", kubeContext(coords.tenant),
        "-o", "json",
      ],
      { stdio: "pipe", timeout: 15_000 },
    );
    const parsed = JSON.parse(stdout) as {
      items?: Array<{
        metadata: { name: string };
        status: {
          phase: string;
          conditions?: Array<{ type: string; status: string }>;
          containerStatuses?: Array<{ restartCount?: number; image?: string }>;
        };
      }>;
    };
    return (parsed.items ?? []).map(p => ({
      name: p.metadata.name,
      phase: p.status.phase,
      ready: p.status.conditions?.find(c => c.type === "Ready")?.status === "True",
      restarts: p.status.containerStatuses?.reduce((sum, c) => sum + (c.restartCount ?? 0), 0) ?? 0,
      image: p.status.containerStatuses?.[0]?.image ?? "unknown",
    }));
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Containers for a compose-runtime service. */
export async function serviceContainers(coords: ServiceCoord): Promise<Array<{ name: string; state: string; status: string }>> {
  try {
    const { stdout } = await execa(
      "docker",
      [
        "ps", "-a",
        "--filter", `label=com.blissful.tenant=${coords.tenant}`,
        "--filter", `label=com.blissful.project=${coords.project}`,
        "--format", "{{.Names}}\t{{.State}}\t{{.Status}}",
      ],
      { reject: false, timeout: 10_000 },
    );
    return stdout
      .split("\n")
      .filter(Boolean)
      .map(line => {
        const [name, state, status] = line.split("\t");
        return { name, state, status };
      })
      .filter(c => c.name.includes(coords.service));
  } catch {
    return [];
  }
}

export interface TenantLinks {
  tenant: string;
  dashboard: string | null;
  grafana: string | null;
  prometheus: string | null;
  jenkins: string | null;
  argocd: string | null;
  gitea: string | null;
}

/**
 * Tool URLs for a tenant. argocd/gitea are only populated once `cluster up`
 * has backfilled the kubernetes port block, so a null there is a useful
 * signal in itself: the cluster has not been provisioned.
 */
export async function tenantLinks(tenant: string): Promise<TenantLinks> {
  const t = await getTenant(tenant);
  const p: Partial<TenantPortBlock> = t?.portBlock ?? {};
  const at = (port?: number, suffix = "") => (port ? `http://localhost:${port}${suffix}` : null);
  return {
    tenant,
    dashboard: at(p.dashboard),
    grafana: at(p.grafana, "/d/tenant-overview"),
    prometheus: at(p.prometheus),
    jenkins: at(p.jenkins),
    argocd: at(p.argocd),
    gitea: at(p.gitea),
  };
}
