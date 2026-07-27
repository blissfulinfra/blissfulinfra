import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import {
  renderServiceManifests,
  bumpImageTag,
  serviceManifestDir,
  serviceManifestsExist,
} from "../gitops.js";
import { giteaInClusterRepoUrl, giteaPushUrl } from "../gitea.js";

let testHome: string;

const COORDS = { tenant: "acme", project: "shop", service: "orders-api" };

beforeEach(async () => {
  testHome = await mkdtemp(join(tmpdir(), "binf-gitops-"));
  process.env.BLISSFUL_HOME = testHome;
});

afterEach(async () => {
  delete process.env.BLISSFUL_HOME;
  await rm(testHome, { recursive: true, force: true });
});

async function render(tag = "abc1234"): Promise<string> {
  return renderServiceManifests(COORDS, "blissful-acme/shop-orders-api", tag, giteaInClusterRepoUrl("acme"));
}

describe("renderServiceManifests", () => {
  it("renders all manifests with no placeholders left", async () => {
    const dir = await render();
    const files = await readdir(dir);
    expect(files.sort()).toEqual([
      "application.yaml", "configmap.yaml", "kustomization.yaml",
      "rollout.yaml", "service-canary.yaml", "service-stable.yaml",
    ]);
    for (const f of files) {
      const content = await readFile(join(dir, f), "utf-8");
      expect(content, `${f} has unrendered placeholders`).not.toMatch(/\{\{[A-Z_]+\}\}/);
    }
  });

  it("wires the rollout to canary/stable services and actuator probes", async () => {
    const dir = await render();
    const rollout = await readFile(join(dir, "rollout.yaml"), "utf-8");
    expect(rollout).toContain("canaryService: orders-api-canary");
    expect(rollout).toContain("stableService: orders-api-stable");
    expect(rollout).toContain("path: /actuator/health");
    expect(rollout).not.toContain("- analysis:");
    expect(rollout).not.toContain("templateName:");
    expect(rollout).toContain("imagePullPolicy: IfNotPresent");
  });

  it("points the ArgoCD Application at the in-cluster gitea repo and project namespace", async () => {
    const dir = await render();
    const app = await readFile(join(dir, "application.yaml"), "utf-8");
    expect(app).toContain("name: shop-orders-api");
    expect(app).toContain("repoURL: http://gitea-http.gitea.svc.cluster.local:3000/blissful/acme-gitops.git");
    expect(app).toContain("path: projects/shop/orders-api");
    expect(app).toContain("namespace: shop");
    expect(app).toContain("CreateNamespace=true");
  });

  it("kustomization lists the workload resources but not application.yaml", async () => {
    const dir = await render();
    const kustomization = await readFile(join(dir, "kustomization.yaml"), "utf-8");
    for (const r of ["rollout.yaml", "service-stable.yaml", "service-canary.yaml", "configmap.yaml"]) {
      expect(kustomization).toContain(`- ${r}`);
    }
    expect(kustomization).not.toContain("- application.yaml");
    expect(kustomization).toContain('newTag: "abc1234"');
  });
});

describe("bumpImageTag", () => {
  it("rewrites only the newTag", async () => {
    const dir = await render("abc1234");
    const before = await readFile(join(dir, "kustomization.yaml"), "utf-8");
    await bumpImageTag(COORDS, "def5678");
    const after = await readFile(join(dir, "kustomization.yaml"), "utf-8");
    expect(after).toContain('newTag: "def5678"');
    expect(after).not.toContain("abc1234");
    expect(after.replace('newTag: "def5678"', 'newTag: "abc1234"')).toBe(before);
  });

  it("is idempotent", async () => {
    await render("abc1234");
    await bumpImageTag(COORDS, "def5678");
    const once = await readFile(join(serviceManifestDir(COORDS), "kustomization.yaml"), "utf-8");
    await bumpImageTag(COORDS, "def5678");
    const twice = await readFile(join(serviceManifestDir(COORDS), "kustomization.yaml"), "utf-8");
    expect(twice).toBe(once);
  });
});

describe("serviceManifestsExist", () => {
  it("false before render, true after", async () => {
    expect(await serviceManifestsExist(COORDS)).toBe(false);
    await render();
    expect(await serviceManifestsExist(COORDS)).toBe(true);
  });
});

describe("gitea URLs", () => {
  it("push URL embeds dev creds and the tenant gitea port", () => {
    expect(giteaPushUrl("acme", 3300)).toBe(
      "http://blissful:blissful-dev-pw@localhost:3300/blissful/acme-gitops.git",
    );
  });
});

// L2: validate the rendered manifests build with real kustomize (via kubectl).
const hasKubectl = await execa("kubectl", ["version", "--client"], { reject: false })
  .then(r => r.exitCode === 0)
  .catch(() => false);

describe.skipIf(!hasKubectl)("kubectl kustomize (L2)", () => {
  it("rendered service dir builds", async () => {
    const dir = await render();
    const { stdout, exitCode } = await execa("kubectl", ["kustomize", dir], { timeout: 30000 });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("kind: Rollout");
    expect(stdout).toContain("blissful-acme/shop-orders-api:abc1234");
  }, 60000);
});
