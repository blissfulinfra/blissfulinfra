import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import chalk from "chalk";
import ora from "ora";
import { execa } from "execa";
import { ensureDashboardImage } from "./infra-images.js";

/**
 * Host-level dashboard compose generator (ADR-0017 update, 2026-05-26).
 *
 * The dashboard used to live inside every tenant's compose, which meant
 * spinning up a second tenant spawned a redundant copy and collided on
 * host ports. Per ADR-0017's revision, the dashboard is now a *control
 * plane* that runs once on the host, reads the global registry, and talks
 * to each tenant's services via the tenant's host-published ports.
 *
 * Compose file lands at `<BLISSFUL_HOME>/docker-compose.dashboard.yaml`.
 * Lifecycle is owned by `blissful-infra dashboard up/down/status`.
 */

export const HOST_DASHBOARD_PORT = 3002;
export const HOST_DASHBOARD_CONTAINER = "blissful-dashboard";

export function buildHostDashboardCompose(attachKindNetwork = false): string {
  const hostBlissfulHome = process.env.BLISSFUL_HOME ?? path.join(os.homedir(), ".blissful-infra");
  // Dedicated, persistent auth dir for the in-container `claude` CLI. We
  // give the container its OWN ~/.claude rather than sharing the host's,
  // because macOS Claude Code stores OAuth tokens in the Keychain (not
  // visible to the container) and sharing would also expose host history.
  const dashboardClaudeDir = path.join(hostBlissfulHome, "dashboard-claude");

  const compose = {
    name: "blissful-dashboard",
    services: {
      dashboard: {
        image: "blissful-infra-dashboard:latest",
        container_name: HOST_DASHBOARD_CONTAINER,
        ports: [`${HOST_DASHBOARD_PORT}:3002`],
        environment: {
          BLISSFUL_HOME: "/blissful-home",
          HOST_BLISSFUL_HOME: hostBlissfulHome,
          DASHBOARD_PORT: "3002",
          DASHBOARD_DIST_DIR: "/app/dashboard-dist",
          DOCKER_MODE: "true",
          CONTROL_PLANE_MODE: "true",
        },
        volumes: [
          "/var/run/docker.sock:/var/run/docker.sock",
          `${hostBlissfulHome}:/blissful-home:rw`,
          `${hostBlissfulHome}:${hostBlissfulHome}:rw`,
          `${dashboardClaudeDir}:/root/.claude:rw`,
        ],
        restart: "unless-stopped",
      },
    },
  } as Record<string, unknown> & { services: { dashboard: Record<string, unknown> } };

  // The kind API server is published on the HOST loopback, unreachable from
  // inside this container. Joining kind's docker network lets the in-container
  // kubectl reach the control-plane node directly via the --internal
  // kubeconfig (server https://<node>:6443, cert SAN matches the node name).
  if (attachKindNetwork) {
    compose.services.dashboard.networks = ["default", "kind"];
    compose.networks = { default: {}, kind: { external: true } };
  }

  return yaml.dump(compose, { lineWidth: 120 });
}

export async function kindNetworkExists(): Promise<boolean> {
  const r = await execa("docker", ["network", "inspect", "kind"], { reject: false, stdio: "pipe" });
  return r.exitCode === 0;
}

async function dashboardOnKindNetwork(): Promise<boolean> {
  try {
    const { stdout } = await execa("docker", [
      "inspect", HOST_DASHBOARD_CONTAINER, "--format", "{{json .NetworkSettings.Networks}}",
    ], { stdio: "pipe" });
    return Object.keys(JSON.parse(stdout) as Record<string, unknown>).includes("kind");
  } catch {
    return false;
  }
}

export async function writeHostDashboardCompose(): Promise<string> {
  const home = process.env.BLISSFUL_HOME ?? path.join(os.homedir(), ".blissful-infra");
  await fs.mkdir(home, { recursive: true });
  // Pre-create the auth dir so Docker doesn't bind-mount an empty inode
  // owned by root (which would block `claude login` from writing tokens).
  await fs.mkdir(path.join(home, "dashboard-claude"), { recursive: true });
  const composePath = path.join(home, "docker-compose.dashboard.yaml");
  await fs.writeFile(composePath, buildHostDashboardCompose(await kindNetworkExists()));
  return composePath;
}

async function isDashboardUp(): Promise<boolean> {
  try {
    const { stdout } = await execa("docker", [
      "ps", "--filter", `name=${HOST_DASHBOARD_CONTAINER}`, "--format", "{{.Status}}",
    ], { stdio: "pipe" });
    return stdout.includes("Up");
  } catch {
    return false;
  }
}

/**
 * Bring up the host-level dashboard if (or however) needed.
 *
 *   forceRecreate=true   → `docker compose up -d --force-recreate`. Use after
 *                          a registry wipe so a stale bind mount can't survive
 *                          (Docker Desktop pins the inode at container start).
 *   forceRecreate=false  → no-op if already Up; otherwise plain `compose up`.
 *
 * `silent` suppresses spinner + console output. MCP must use silent=true so
 * the JSON-RPC stdio stream isn't corrupted by decorative writes.
 */
export async function ensureHostDashboardRunning(opts: {
  forceRecreate?: boolean;
  silent?: boolean;
} = {}): Promise<void> {
  let { forceRecreate = false } = opts;
  const { silent = false } = opts;

  if (!forceRecreate && await isDashboardUp()) {
    // A dashboard started before any kind cluster existed isn't on the kind
    // network — recreate it so the in-container kubectl can reach the cluster.
    if (!(await kindNetworkExists()) || await dashboardOnKindNetwork()) return;
    forceRecreate = true;
  }

  const log = (msg: string) => { if (!silent) process.stderr.write(`${msg}\n`); };
  const spinner = silent ? null : ora("Starting host dashboard...").start();
  try {
    await ensureDashboardImage();
    const composePath = await writeHostDashboardCompose();
    const args = ["compose", "-f", composePath, "up", "-d"];
    if (forceRecreate) args.push("--force-recreate");
    await execa("docker", args, { stdio: "pipe" });
    spinner?.succeed(`Dashboard running at http://localhost:${HOST_DASHBOARD_PORT}`);
  } catch (err) {
    spinner?.fail("Failed to start dashboard");
    if (err instanceof Error) log(chalk.red(err.message));
  }
}
