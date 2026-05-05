import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  allocatePortBlock,
  extraPostgresInstanceNames,
  getClientRequiredPorts,
  registerClient,
  unregisterClient,
  loadRegistry,
  listClients,
  getClientPortBlock,
} from "../client-registry.js";

describe("allocatePortBlock — pure math", () => {
  it("block 0 produces base ports", () => {
    const p = allocatePortBlock("acme", 0);
    expect(p).toMatchObject({
      clientName: "acme",
      blockIndex: 0,
      jenkins: 8090,
      grafana: 3010,
      prometheus: 9090,
      tempo: 3200,  // ADR-0016: replaced jaeger
      kafka: 9094,
      postgres: 5432,
      dashboard: 3002,
    });
  });

  it("block N adds N to every port", () => {
    const p = allocatePortBlock("globex", 5);
    expect(p.jenkins).toBe(8095);
    expect(p.grafana).toBe(3015);
    expect(p.dashboard).toBe(3007);
    expect(p.kafka).toBe(9099);
  });

  it("preserves the client name and block index", () => {
    const p = allocatePortBlock("globex-inc", 3);
    expect(p.clientName).toBe("globex-inc");
    expect(p.blockIndex).toBe(3);
  });
});

describe("allocatePortBlock — multiple postgres instances (ADR-0014)", () => {
  it("returns no postgresInstances field when there are no extras", () => {
    const p = allocatePortBlock("acme", 0);
    expect(p.postgresInstances).toBeUndefined();
  });

  it("allocates expansion ports for extra instances", () => {
    const p = allocatePortBlock("acme", 0, { extraPostgresInstances: ["legacy", "analytics"] });
    expect(p.postgres).toBe(5432);
    expect(p.postgresInstances).toEqual({ legacy: 5600, analytics: 5601 });
  });

  it("blockIndex shifts the expansion range by 10 per block", () => {
    const p = allocatePortBlock("globex", 3, { extraPostgresInstances: ["legacy"] });
    expect(p.postgresInstances).toEqual({ legacy: 5630 });
  });

  it("throws when the extras list exceeds the per-block cap", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `extra${i}`);
    expect(() => allocatePortBlock("acme", 0, { extraPostgresInstances: eleven })).toThrow(/Too many/);
  });
});

describe("extraPostgresInstanceNames — read non-default names from infra (ADR-0014)", () => {
  it("returns [] for boolean shorthand", () => {
    expect(extraPostgresInstanceNames({ kafka: true, postgres: true, jenkins: false } as never)).toEqual([]);
  });

  it("returns [] when only the default instance is named", () => {
    expect(
      extraPostgresInstanceNames({
        kafka: true,
        jenkins: false,
        postgres: [{ name: "default", version: "16" }],
      } as never),
    ).toEqual([]);
  });

  it("returns non-default names in declaration order", () => {
    expect(
      extraPostgresInstanceNames({
        kafka: true,
        jenkins: false,
        postgres: [
          { name: "default", version: "16" },
          { name: "legacy", version: "14" },
          { name: "analytics", version: "16" },
        ],
      } as never),
    ).toEqual(["legacy", "analytics"]);
  });
});

describe("getClientRequiredPorts — feature-flag-aware", () => {
  const ports = allocatePortBlock("acme", 0);

  it("includes jenkins when infrastructure.jenkins is true", () => {
    const result = getClientRequiredPorts(ports, {
      kafka: true, postgres: true, jenkins: true,
      observability: { prometheus: true, grafana: true, tempo: true, jaeger: false, loki: true, clickhouse: false },
    });
    expect(result.find(r => r.service === "Jenkins")?.port).toBe(8090);
  });

  it("excludes jenkins when infrastructure.jenkins is false", () => {
    const result = getClientRequiredPorts(ports, {
      kafka: true, postgres: true, jenkins: false,
      observability: { prometheus: true, grafana: true, tempo: true, jaeger: false, loki: true, clickhouse: false },
    });
    expect(result.find(r => r.service === "Jenkins")).toBeUndefined();
  });

  it("excludes all observability ports when observability is disabled", () => {
    const result = getClientRequiredPorts(ports, {
      kafka: true, postgres: true, jenkins: true,
      observability: { prometheus: false, grafana: false, jaeger: false, loki: false, clickhouse: false },
    });
    expect(result.find(r => r.service === "Prometheus")).toBeUndefined();
    expect(result.find(r => r.service === "Grafana")).toBeUndefined();
    expect(result.find(r => r.service === "Jaeger")).toBeUndefined();
  });

  it("includes one Postgres entry per instance (ADR-0014)", () => {
    const block = allocatePortBlock("acme", 0, { extraPostgresInstances: ["legacy"] });
    const result = getClientRequiredPorts(block, {
      kafka: false, jenkins: false,
      postgres: [
        { name: "default", version: "16" },
        { name: "legacy", version: "14" },
      ],
      observability: { prometheus: false, grafana: false, jaeger: false, loki: false, clickhouse: false },
    } as never);
    const pg = result.filter(r => r.service.startsWith("Postgres"));
    expect(pg.map(p => p.service).sort()).toEqual(["Postgres", "Postgres (legacy)"]);
    expect(pg.find(r => r.service === "Postgres")?.port).toBe(5432);
    expect(pg.find(r => r.service === "Postgres (legacy)")?.port).toBe(5600);
  });

  it("excludes all Postgres entries when postgres is false", () => {
    const result = getClientRequiredPorts(ports, {
      kafka: false, postgres: false, jenkins: false,
      observability: { prometheus: false, grafana: false, jaeger: false, loki: false, clickhouse: false },
    });
    expect(result.find(r => r.service.startsWith("Postgres"))).toBeUndefined();
  });

  it("dashboard is always required", () => {
    const result = getClientRequiredPorts(ports, {
      kafka: false, postgres: false, jenkins: false,
      observability: { prometheus: false, grafana: false, jaeger: false, loki: false, clickhouse: false },
    });
    expect(result.find(r => r.service === "Dashboard")?.port).toBe(3002);
  });
});

describe("registry persistence — register / unregister round-trip", () => {
  let testHome: string;

  beforeEach(async () => {
    testHome = await mkdtemp(join(tmpdir(), "binf-registry-"));
    process.env.BLISSFUL_HOME = testHome;
  });

  afterEach(async () => {
    delete process.env.BLISSFUL_HOME;
    await rm(testHome, { recursive: true, force: true });
  });

  it("loadRegistry returns empty defaults when no file exists", async () => {
    const reg = await loadRegistry();
    expect(reg.clients).toEqual({});
    expect(reg.nextBlockIndex).toBe(0);
  });

  it("registerClient persists and returns the same block on re-register", async () => {
    const first = await registerClient("acme");
    const second = await registerClient("acme");
    expect(second).toEqual(first);
    expect(first.blockIndex).toBe(0);
  });

  it("two different clients get different block indexes", async () => {
    const acme = await registerClient("acme");
    const globex = await registerClient("globex");
    expect(acme.blockIndex).toBe(0);
    expect(globex.blockIndex).toBe(1);
    expect(globex.jenkins).toBe(acme.jenkins + 1);
  });

  it("unregisterClient removes the entry", async () => {
    await registerClient("acme");
    expect(await getClientPortBlock("acme")).not.toBeNull();
    await unregisterClient("acme");
    expect(await getClientPortBlock("acme")).toBeNull();
  });

  it("listClients returns all registered clients", async () => {
    await registerClient("acme");
    await registerClient("globex");
    const list = await listClients();
    expect(list.map(c => c.clientName).sort()).toEqual(["acme", "globex"]);
  });
});
