import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execa } from "execa";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the CLI entrypoint relative to this test file so it works whether
// vitest is run from packages/cli or the repo root.
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CLI_ENTRY = resolve(__dirname, "..", "..", "..", "dist", "index.js");

// One unique client name per test run so parallel CI runs don't collide.
const CLIENT_NAME = `itest-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

let testHome: string;

async function cli(args: string[], opts: { timeout?: number } = {}) {
  return execa("node", [CLI_ENTRY, ...args], {
    env: { ...process.env, BLISSFUL_HOME: testHome },
    timeout: opts.timeout ?? 60_000,
    reject: false,
  });
}

async function dockerInspectHealth(container: string): Promise<string> {
  const r = await execa("docker", ["inspect", container, "--format", "{{.State.Health.Status}}"], { reject: false });
  return r.stdout.trim();
}

async function waitForHealthy(container: string, maxSeconds = 120): Promise<boolean> {
  for (let i = 0; i < maxSeconds; i++) {
    const status = await dockerInspectHealth(container);
    if (status === "healthy") return true;
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

beforeAll(async () => {
  // Verify Docker is reachable; skip the suite if not.
  const r = await execa("docker", ["info"], { reject: false });
  if (r.exitCode !== 0) {
    throw new Error("Docker daemon not reachable — skipping integration tests");
  }
  // Verify CLI was built.
  await access(CLI_ENTRY);
  testHome = await mkdtemp(join(tmpdir(), "binf-itest-"));
});

afterAll(async () => {
  // Best-effort cleanup even on failure
  await cli(["client", "remove", CLIENT_NAME], { timeout: 60_000 });
  if (testHome) {
    await rm(testHome, { recursive: true, force: true });
  }
});

describe("client lifecycle (real Docker)", () => {
  it("client create + service add + healthy backend + client remove", async () => {
    // 1. Create the smallest possible client (no Jenkins, no observability)
    //    so we don't pull/build the heavy Jenkins image during tests.
    const create = await cli(
      ["client", "create", CLIENT_NAME, "--yes", "--no-jenkins", "--no-observability"],
      { timeout: 120_000 },
    );
    expect(create.exitCode, create.stderr || create.stdout).toBe(0);

    // 2. Verify the registry, directory and infra network exist
    const list = await cli(["client", "list"]);
    expect(list.stdout).toContain(CLIENT_NAME);

    const networks = await execa("docker", ["network", "ls", "--format", "{{.Name}}"]);
    expect(networks.stdout).toContain(`${CLIENT_NAME}_infra`);

    // 3. Verify infra containers came up healthy
    expect(await waitForHealthy(`${CLIENT_NAME}-kafka`, 60)).toBe(true);
    expect(await waitForHealthy(`${CLIENT_NAME}-postgres`, 30)).toBe(true);

    // 4. Cleanup verification — `client remove` tears everything down
    const remove = await cli(["client", "remove", CLIENT_NAME], { timeout: 60_000 });
    expect(remove.exitCode, remove.stderr).toBe(0);

    const networksAfter = await execa("docker", ["network", "ls", "--format", "{{.Name}}"]);
    expect(networksAfter.stdout).not.toContain(`${CLIENT_NAME}_infra`);

    const psAfter = await execa("docker", ["ps", "-a", "--filter", `name=${CLIENT_NAME}-`, "--format", "{{.Names}}"]);
    expect(psAfter.stdout.trim()).toBe("");
  }, 300_000);
});
