import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execa } from "execa";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HealthResponseSchema,
  LogsResponseSchema,
  ProjectsListResponseSchema,
} from "@blissful-infra/shared";
import { createApiServer } from "../../server/api.js";
import { checkPort } from "../../utils/ports.js";

// What this exercises: the dashboard's exact integration surface — the
// /api/v1/projects, /health, and /logs endpoints, against a real client +
// service running in Docker. If health checks regress in client mode (as they
// did when CLIENT_NAME-aware path resolution was added), this test fails. If
// logs stop populating because docker compose logs is being called from the
// wrong cwd (also a past regression), this test fails.

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CLI_ENTRY = resolve(__dirname, "..", "..", "..", "dist", "index.js");

const CLIENT_NAME = `itest-dash-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const SERVICE_NAME = "app";

let testHome: string;
let serverHandle: { stop: () => Promise<void> } | null = null;
let serverPort: number;
let originalClientNameEnv: string | undefined;

async function cli(args: string[], opts: { timeout?: number } = {}) {
  return execa("node", [CLI_ENTRY, ...args], {
    env: { ...process.env, BLISSFUL_HOME: testHome },
    timeout: opts.timeout ?? 60_000,
    reject: false,
  });
}

async function waitForContainerRunning(container: string, maxSeconds = 120): Promise<boolean> {
  for (let i = 0; i < maxSeconds; i++) {
    const r = await execa("docker", ["inspect", container, "--format", "{{.State.Status}}"], {
      reject: false,
    });
    if (r.exitCode === 0 && r.stdout.trim() === "running") return true;
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

async function findFreePort(): Promise<number> {
  for (let i = 0; i < 25; i++) {
    const candidate = 40_000 + Math.floor(Math.random() * 20_000);
    if (!(await checkPort(candidate))) return candidate;
  }
  throw new Error("Could not find a free port for the in-process API server");
}

beforeAll(async () => {
  const r = await execa("docker", ["info"], { reject: false });
  if (r.exitCode !== 0) {
    throw new Error("Docker daemon not reachable — skipping integration tests");
  }
  await access(CLI_ENTRY);
  testHome = await mkdtemp(join(tmpdir(), "binf-itest-dash-"));
  originalClientNameEnv = process.env.CLIENT_NAME;
});

afterAll(async () => {
  if (serverHandle) {
    try { await serverHandle.stop(); } catch { /* best-effort */ }
  }
  if (originalClientNameEnv !== undefined) {
    process.env.CLIENT_NAME = originalClientNameEnv;
  } else {
    delete process.env.CLIENT_NAME;
  }
  // Best-effort cleanup even if the test threw
  await cli(["client", "remove", CLIENT_NAME], { timeout: 60_000 });
  if (testHome) {
    await rm(testHome, { recursive: true, force: true });
  }
});

describe("dashboard API: health + logs (real Docker)", () => {
  it("reports service health and returns logs for a running service", async () => {
    // 1. Create a client with --localstack so we exercise the new opt-in flag
    //    and produce a non-trivial set of containers (kafka + postgres + localstack).
    const create = await cli(
      ["client", "create", CLIENT_NAME, "--yes", "--no-jenkins", "--no-observability", "--localstack"],
      { timeout: 240_000 },
    );
    expect(create.exitCode, create.stderr || create.stdout).toBe(0);

    // 2. Add a backend-only service. Spring Boot is the available backend
    //    template; we don't wait for it to be *healthy* (start_period is 30s
    //    plus app boot), only for the container to reach `running` state.
    const add = await cli(
      ["service", "add", CLIENT_NAME, SERVICE_NAME, "--backend", "spring-boot"],
      { timeout: 420_000 },
    );
    expect(add.exitCode, add.stderr || add.stdout).toBe(0);

    // 3. Wait for the backend container to be in `running` state. Even before
    //    Spring Boot is healthy, the JVM produces log output and `docker
    //    inspect` reports state — both are enough for the API endpoints to
    //    return meaningful data.
    const backendContainer = `${CLIENT_NAME}-${SERVICE_NAME}-backend`;
    expect(
      await waitForContainerRunning(backendContainer, 180),
      `Container ${backendContainer} did not reach running state`,
    ).toBe(true);

    // 4. Spin up the API server in-process. The dashboard container mounts
    //    <hostClientsDir> at /projects and sets CLIENT_NAME — we mirror that
    //    layout natively here so the same path-resolution code runs.
    process.env.CLIENT_NAME = CLIENT_NAME;
    const clientsDir = join(testHome, "clients");
    serverPort = await findFreePort();
    serverHandle = createApiServer(clientsDir, serverPort);
    await serverHandle.start();
    const base = `http://127.0.0.1:${serverPort}`;

    // 5. /api/v1/projects — the service should appear in the client's project list
    const projectsRes = await fetch(`${base}/api/v1/projects`);
    expect(projectsRes.ok, `GET /api/v1/projects returned ${projectsRes.status}`).toBe(true);
    const projectsBody = ProjectsListResponseSchema.parse(await projectsRes.json());
    expect(projectsBody.projects.map(p => p.name)).toContain(SERVICE_NAME);

    // 6. /api/v1/projects/<svc>/health — schema-valid, includes the backend
    //    container, status is one of the valid enum values.
    const healthRes = await fetch(`${base}/api/v1/projects/${SERVICE_NAME}/health`);
    expect(healthRes.ok, `GET /health returned ${healthRes.status}`).toBe(true);
    const health = HealthResponseSchema.parse(await healthRes.json());
    expect(health.services.length).toBeGreaterThan(0);

    const backendEntry = health.services.find(s => s.name === "backend");
    expect(
      backendEntry,
      `Expected 'backend' in health.services; got: ${JSON.stringify(health.services)}`,
    ).toBeDefined();
    // Accept any of the valid statuses — Spring Boot may still be in start_period.
    // The point is the dashboard renders *something* meaningful for every container.
    expect(["healthy", "unhealthy", "unknown"]).toContain(backendEntry!.status);
    expect(typeof backendEntry!.lastChecked).toBe("number");

    // 7. /api/v1/projects/<svc>/logs — logs are populating from `docker
    //    compose logs`. Spring Boot emits dozens of lines during startup, so
    //    even if the app isn't ready yet there should be backend log output.
    const logsRes = await fetch(`${base}/api/v1/projects/${SERVICE_NAME}/logs`);
    expect(logsRes.ok, `GET /logs returned ${logsRes.status}`).toBe(true);
    const logsBody = LogsResponseSchema.parse(await logsRes.json());
    expect(logsBody.logs.length, "Expected non-empty logs response").toBeGreaterThan(0);
    expect(
      logsBody.logs.some(l => l.service.includes("backend")),
      `Expected at least one log entry from 'backend'; got services: ${
        Array.from(new Set(logsBody.logs.map(l => l.service))).join(", ")
      }`,
    ).toBe(true);
  }, 720_000);
});
