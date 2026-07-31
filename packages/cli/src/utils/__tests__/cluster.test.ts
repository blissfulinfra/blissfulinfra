import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import {
  tenantPortBlock,
  projectPortBlock,
  servicePorts,
  ensureClusterPorts,
  MAX_TENANTS,
  MAX_PROJECTS_PER_TENANT,
  MAX_SERVICES_PER_PROJECT,
} from "../tenant-registry.js";
import { renderClusterWorkspace } from "../terraform.js";
import { HOST_DASHBOARD_PORT } from "../host-dashboard-compose.js";

let testHome: string;

beforeEach(async () => {
  testHome = await mkdtemp(join(tmpdir(), "binf-cluster-"));
  process.env.BLISSFUL_HOME = testHome;
});

afterEach(async () => {
  delete process.env.BLISSFUL_HOME;
  await rm(testHome, { recursive: true, force: true });
});

describe("cluster port allocation", () => {
  // Note: a pre-existing jenkins/gateway range overlap (8081+t vs 8080+offset)
  // is documented in ADR-0020 and out of scope here. This test pins the NEW
  // cluster ranges: they must never collide with any other allocated port.
  it("kubeApi/argocd/gitea never collide with any non-cluster port", () => {
    const clusterKeys = new Set(["kubeApi", "argocd", "gitea"]);
    const otherPorts = new Set<number>();
    const clusterPorts = new Map<number, string>();

    for (let t = 0; t < MAX_TENANTS; t++) {
      const tb = tenantPortBlock(`t${t}`, t);
      for (const [k, v] of Object.entries(tb)) {
        if (typeof v !== "number" || k === "blockIndex") continue;
        if (clusterKeys.has(k)) {
          expect(clusterPorts.has(v), `cluster port ${v} allocated twice`).toBe(false);
          clusterPorts.set(v, `tenant[${t}].${k}`);
        } else {
          otherPorts.add(v);
        }
      }
      for (let p = 0; p < MAX_PROJECTS_PER_TENANT; p++) {
        const pb = projectPortBlock(`t${t}`, `p${p}`, t, p);
        for (const [k, v] of Object.entries(pb)) {
          if (typeof v === "number" && k !== "projectIndex") otherPorts.add(v);
        }
        for (let s = 0; s < MAX_SERVICES_PER_PROJECT; s++) {
          const sp = servicePorts(`t${t}`, `p${p}`, `s${s}`, "backend", t, p, s);
          if (sp.http) otherPorts.add(sp.http);
          if (sp.metrics) otherPorts.add(sp.metrics);
        }
      }
    }

    for (const [port, owner] of clusterPorts) {
      expect(otherPorts.has(port), `${owner} (${port}) collides with an existing range`).toBe(false);
    }
  });

  it("no tenant/project/service port ever lands on the host dashboard port", () => {
    // Regression: grafana base 3000 put blockIndex 2's Grafana on 3002, the
    // host control-plane dashboard's fixed port.
    const claim = (port: number | undefined, owner: string) => {
      if (port === undefined) return;
      expect(port, `${owner} collides with the host dashboard (${HOST_DASHBOARD_PORT})`).not.toBe(HOST_DASHBOARD_PORT);
    };
    for (let t = 0; t < MAX_TENANTS; t++) {
      const tb = tenantPortBlock(`t${t}`, t);
      for (const [k, v] of Object.entries(tb)) {
        if (typeof v === "number" && k !== "blockIndex") claim(v, `tenant[${t}].${k}`);
      }
      for (let p = 0; p < MAX_PROJECTS_PER_TENANT; p++) {
        const pb = projectPortBlock(`t${t}`, `p${p}`, t, p);
        for (const [k, v] of Object.entries(pb)) {
          if (typeof v === "number" && k !== "projectIndex") claim(v, `project[${t}.${p}].${k}`);
        }
        for (let sv = 0; sv < MAX_SERVICES_PER_PROJECT; sv++) {
          const sp = servicePorts(`t${t}`, `p${p}`, `s${sv}`, "backend", t, p, sv);
          claim(sp.http, `service[${t}.${p}.${sv}].http`);
          claim(sp.metrics, `service[${t}.${p}.${sv}].metrics`);
        }
      }
    }
  });
});

describe("ensureClusterPorts", () => {
  async function seedRegistry(portBlock: Record<string, unknown>): Promise<void> {
    await mkdir(testHome, { recursive: true });
    await writeFile(join(testHome, "registry.json"), JSON.stringify({
      version: 1,
      tenants: [{ name: "acme", portBlock, projects: [] }],
    }));
  }

  const legacyBlock = {
    tenant: "acme", blockIndex: 2,
    dashboard: 3012, jenkins: 8083, grafana: 3002,
    prometheus: 9092, tempo: 3202, loki: 3102,
  };

  it("backfills cluster ports on a pre-k8s registry entry", async () => {
    await seedRegistry(legacyBlock);
    const block = await ensureClusterPorts("acme");
    expect(block.kubeApi).toBe(6552);
    expect(block.argocd).toBe(8442);
    expect(block.gitea).toBe(3302);

    const persisted = JSON.parse(await readFile(join(testHome, "registry.json"), "utf-8"));
    expect(persisted.tenants[0].portBlock.kubeApi).toBe(6552);
  });

  it("is idempotent", async () => {
    await seedRegistry(legacyBlock);
    const first = await ensureClusterPorts("acme");
    const second = await ensureClusterPorts("acme");
    expect(second).toEqual(first);
  });

  it("throws for unknown tenants", async () => {
    await seedRegistry(legacyBlock);
    await expect(ensureClusterPorts("ghost")).rejects.toThrow(/not found/);
  });
});

describe("renderClusterWorkspace", () => {
  const ports = {
    tenant: "acme", blockIndex: 0,
    dashboard: 3010, jenkins: 8081, grafana: 3000,
    prometheus: 9090, tempo: 3200, loki: 3100,
    kubeApi: 6550, argocd: 8440, gitea: 3300,
  };

  it("renders every template file with no {{ placeholders left", async () => {
    const dir = await renderClusterWorkspace("acme", ports);
    const files = await readdir(dir);
    expect(files).toContain("main.tf");
    expect(files).toContain("versions.tf");
    expect(files).toContain("argocd.tf");
    expect(files).toContain("rollouts.tf");
    expect(files).toContain("gitea.tf");

    for (const f of files) {
      const content = await readFile(join(dir, f), "utf-8");
      expect(content, `${f} has unrendered placeholders`).not.toMatch(/\{\{[A-Z_]+\}\}/);
    }
  });

  it("substitutes the cluster name and all three ports into main.tf", async () => {
    const dir = await renderClusterWorkspace("acme", ports);
    const main = await readFile(join(dir, "main.tf"), "utf-8");
    expect(main).toContain('"blissful-acme"');
    expect(main).toContain("api_server_port    = 6550");
    expect(main).toContain("host_port      = 8440");
    expect(main).toContain("host_port      = 3300");
  });

  it("refuses to render without cluster ports", async () => {
    const { kubeApi, argocd, gitea, ...legacy } = ports;
    await expect(renderClusterWorkspace("acme", legacy as typeof ports)).rejects.toThrow(/cluster ports/);
  });
});

// L2: only runs when terraform is installed (CI and most dev machines skip).
const hasTerraform = await execa("terraform", ["version"], { reject: false })
  .then(r => r.exitCode === 0)
  .catch(() => false);

describe.skipIf(!hasTerraform)("terraform validate (L2)", () => {
  it("rendered workspace passes terraform validate", async () => {
    const dir = await renderClusterWorkspace("acme", {
      tenant: "acme", blockIndex: 0,
      dashboard: 3010, jenkins: 8081, grafana: 3000,
      prometheus: 9090, tempo: 3200, loki: 3100,
      kubeApi: 6550, argocd: 8440, gitea: 3300,
    });
    await execa("terraform", [`-chdir=${dir}`, "init", "-backend=false"], { timeout: 120000 });
    const { exitCode } = await execa("terraform", [`-chdir=${dir}`, "validate"], { timeout: 30000 });
    expect(exitCode).toBe(0);
  }, 180000);
});
