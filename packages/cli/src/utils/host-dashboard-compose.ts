import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

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

export function buildHostDashboardCompose(): string {
  const hostBlissfulHome = process.env.BLISSFUL_HOME ?? path.join(os.homedir(), ".blissful-infra");

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
        ],
        restart: "unless-stopped",
      },
    },
  };

  return yaml.dump(compose, { lineWidth: 120 });
}

export async function writeHostDashboardCompose(): Promise<string> {
  const home = process.env.BLISSFUL_HOME ?? path.join(os.homedir(), ".blissful-infra");
  await fs.mkdir(home, { recursive: true });
  const composePath = path.join(home, "docker-compose.dashboard.yaml");
  await fs.writeFile(composePath, buildHostDashboardCompose());
  return composePath;
}
