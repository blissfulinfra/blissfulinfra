import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { PrereqMissingError } from "../deploy/errors.js";
import { getTemplateDir } from "./template.js";
import { getClusterDir } from "./tenant-registry.js";
import type { TenantPortBlock } from "@blissful-infra/shared";

export async function ensureTerraform(): Promise<void> {
  try {
    await execa("terraform", ["version"], { stdio: "pipe" });
  } catch {
    throw new PrereqMissingError(
      "terraform",
      "Install it with:\n  brew tap hashicorp/tap && brew install hashicorp/tap/terraform",
    );
  }
}

/**
 * Render templates/cluster/terraform/ into the tenant's cluster workspace at
 * ~/.blissful-infra/tenants/<tenant>/cluster/. Plain {{VAR}} substitution —
 * the cluster workspace has its own small variable set, distinct from the
 * scaffolding TemplateVariables.
 */
export async function renderClusterWorkspace(
  tenant: string,
  ports: TenantPortBlock,
): Promise<string> {
  if (!ports.kubeApi || !ports.argocd || !ports.gitea) {
    throw new Error(`Tenant '${tenant}' has no cluster ports allocated (run ensureClusterPorts first).`);
  }
  const vars: Record<string, string> = {
    TENANT_NAME: tenant,
    KUBE_API_PORT: String(ports.kubeApi),
    ARGOCD_PORT: String(ports.argocd),
    GITEA_PORT: String(ports.gitea),
  };

  const srcDir = getTemplateDir("cluster/terraform");
  const destDir = getClusterDir(tenant);
  await fs.mkdir(destDir, { recursive: true });

  for (const entry of await fs.readdir(srcDir)) {
    const content = await fs.readFile(path.join(srcDir, entry), "utf-8");
    const rendered = content.replace(/\{\{([A-Z_]+)\}\}/g, (match, name: string) =>
      vars[name] ?? match);
    await fs.writeFile(path.join(destDir, entry), rendered);
  }
  return destDir;
}

async function runTerraform(dir: string, args: string[]): Promise<void> {
  await execa("terraform", [`-chdir=${dir}`, ...args], { stdio: "inherit" });
}

export async function terraformInit(dir: string): Promise<void> {
  // Skip re-init when providers are already installed — `terraform init` is
  // the slow, network-bound step.
  try {
    await fs.access(path.join(dir, ".terraform"));
    return;
  } catch {
    await runTerraform(dir, ["init"]);
  }
}

export async function terraformApply(dir: string): Promise<void> {
  await runTerraform(dir, ["apply", "-auto-approve"]);
}

export async function terraformDestroy(dir: string): Promise<void> {
  await runTerraform(dir, ["destroy", "-auto-approve"]);
}
