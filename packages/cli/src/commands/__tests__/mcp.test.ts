import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveMcpApiBase } from "../mcp.js";

// Verify the MCP command's --api / --client flag interaction. The bug we're
// guarding against: post client-model migration, each client's dashboard
// runs on a different port, so a single hardcoded --api default doesn't
// work. The --client flag reads ~/.blissful-infra/registry.json and resolves
// the port automatically.

let testHome: string;

beforeEach(async () => {
  testHome = await mkdtemp(join(tmpdir(), "binf-mcp-"));
  process.env.BLISSFUL_HOME = testHome;
});

afterEach(async () => {
  delete process.env.BLISSFUL_HOME;
  await rm(testHome, { recursive: true, force: true });
});

async function writeRegistry(content: object) {
  await writeFile(join(testHome, "registry.json"), JSON.stringify(content));
}

describe("resolveMcpApiBase", () => {
  it("returns the default API URL when no flags are passed", async () => {
    const url = await resolveMcpApiBase({});
    expect(url).toBe("http://localhost:3002");
  });

  it("honors --api when explicitly passed", async () => {
    const url = await resolveMcpApiBase({ api: "http://localhost:9999" });
    expect(url).toBe("http://localhost:9999");
  });

  it("--api with the default value falls through (lets --client win)", async () => {
    await writeRegistry({
      clients: {
        dev: {
          clientName: "dev",
          blockIndex: 11,
          jenkins: 8101,
          grafana: 3021,
          prometheus: 9101,
          tempo: 3210,
          kafka: 9105,
          postgres: 5443,
          dashboard: 3013,
        },
      },
      nextBlockIndex: 12,
    });
    const url = await resolveMcpApiBase({ api: "http://localhost:3002", client: "dev" });
    expect(url).toBe("http://localhost:3013");
  });

  it("--client looks up the dashboard port from the registry", async () => {
    await writeRegistry({
      clients: {
        acme: {
          clientName: "acme",
          blockIndex: 0,
          jenkins: 8090,
          grafana: 3010,
          prometheus: 9090,
          tempo: 3200,
          kafka: 9094,
          postgres: 5432,
          dashboard: 3002,
        },
        globex: {
          clientName: "globex",
          blockIndex: 1,
          jenkins: 8091,
          grafana: 3011,
          prometheus: 9091,
          tempo: 3201,
          kafka: 9095,
          postgres: 5433,
          dashboard: 3003,
        },
      },
      nextBlockIndex: 2,
    });
    expect(await resolveMcpApiBase({ client: "acme" })).toBe("http://localhost:3002");
    expect(await resolveMcpApiBase({ client: "globex" })).toBe("http://localhost:3003");
  });

  it("--client throws a helpful error when the client is unknown", async () => {
    await writeRegistry({
      clients: {
        dev: {
          clientName: "dev", blockIndex: 0,
          jenkins: 8090, grafana: 3010, prometheus: 9090,
          tempo: 3200, kafka: 9094, postgres: 5432, dashboard: 3002,
        },
      },
      nextBlockIndex: 1,
    });
    await expect(
      resolveMcpApiBase({ client: "unknown" })
    ).rejects.toThrow(/Client 'unknown' not found.*dev/);
  });

  it("--api takes precedence over --client when both differ from default", async () => {
    await writeRegistry({
      clients: {
        dev: {
          clientName: "dev", blockIndex: 0,
          jenkins: 8090, grafana: 3010, prometheus: 9090,
          tempo: 3200, kafka: 9094, postgres: 5432, dashboard: 3013,
        },
      },
      nextBlockIndex: 1,
    });
    // Both flags passed; --api overrides --client.
    const url = await resolveMcpApiBase({
      api: "http://elsewhere:7777",
      client: "dev",
    });
    expect(url).toBe("http://elsewhere:7777");
  });
});
