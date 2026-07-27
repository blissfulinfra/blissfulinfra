import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { getTenantDir } from "./tenant-registry.js";
import { getTemplateDir } from "./template.js";

export interface GitopsCoords {
  tenant: string;
  project: string;
  service: string;
}

/** Local working checkout of the tenant's gitops repo. */
export function getGitopsDir(tenant: string): string {
  return path.join(getTenantDir(tenant), "gitops");
}

export function serviceManifestDir(coords: GitopsCoords): string {
  return path.join(getGitopsDir(coords.tenant), "projects", coords.project, coords.service);
}

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execa("git", ["-C", dir, ...args], { stdio: "pipe" });
  return stdout;
}

/**
 * Clone-or-update the tenant's gitops checkout. The remote URL is refreshed
 * every time (ports can change across cluster recreations) and identity is
 * pinned locally so commits don't depend on the user's git config.
 */
export async function ensureCheckout(tenant: string, pushUrl: string): Promise<string> {
  const dir = getGitopsDir(tenant);
  try {
    await fs.access(path.join(dir, ".git"));
    await git(dir, ["remote", "set-url", "origin", pushUrl]);
    await git(dir, ["fetch", "origin", "main"]);
    await git(dir, ["checkout", "main"]);
    await git(dir, ["reset", "--hard", "origin/main"]);
  } catch {
    await fs.rm(dir, { recursive: true, force: true });
    await execa("git", ["clone", pushUrl, dir], { stdio: "pipe" });
  }
  await git(dir, ["config", "user.email", "deploy@blissful-infra.local"]);
  await git(dir, ["config", "user.name", "blissful-infra"]);
  return dir;
}

const MANIFEST_VAR = /\{\{([A-Z_]+)\}\}/g;

/**
 * Render templates/gitops/service/ into projects/<project>/<service>/ inside
 * the gitops checkout. Returns the manifest dir.
 */
export async function renderServiceManifests(
  coords: GitopsCoords,
  imageName: string,
  imageTag: string,
  gitopsRepoUrl: string,
): Promise<string> {
  const vars: Record<string, string> = {
    TENANT_NAME: coords.tenant,
    PROJECT_NAME: coords.project,
    SERVICE_NAME: coords.service,
    IMAGE_NAME: imageName,
    IMAGE_TAG: imageTag,
    GITOPS_REPO_URL: gitopsRepoUrl,
  };
  const srcDir = getTemplateDir("gitops/service");
  const destDir = serviceManifestDir(coords);
  await fs.mkdir(destDir, { recursive: true });
  for (const entry of await fs.readdir(srcDir)) {
    const content = await fs.readFile(path.join(srcDir, entry), "utf-8");
    const rendered = content.replace(MANIFEST_VAR, (match, name: string) => vars[name] ?? match);
    await fs.writeFile(path.join(destDir, entry), rendered);
  }
  return destDir;
}

export async function serviceManifestsExist(coords: GitopsCoords): Promise<boolean> {
  try {
    await fs.access(path.join(serviceManifestDir(coords), "kustomization.yaml"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Surgically rewrite the image newTag in the service's kustomization.yaml.
 * Idempotent — bumping to the current tag is a no-op commit-wise.
 */
export async function bumpImageTag(coords: GitopsCoords, imageTag: string): Promise<void> {
  const file = path.join(serviceManifestDir(coords), "kustomization.yaml");
  const content = await fs.readFile(file, "utf-8");
  const updated = content.replace(/newTag:\s*"[^"]*"/, `newTag: "${imageTag}"`);
  await fs.writeFile(file, updated);
}

/** HEAD commit sha of the gitops checkout (what ArgoCD must sync to). */
export async function headSha(tenant: string): Promise<string> {
  return (await git(getGitopsDir(tenant), ["rev-parse", "HEAD"])).trim();
}

/** Commit + push everything staged under the checkout. False if no changes. */
export async function commitAndPush(tenant: string, message: string): Promise<boolean> {
  const dir = getGitopsDir(tenant);
  await git(dir, ["add", "-A"]);
  const status = await git(dir, ["status", "--porcelain"]);
  if (!status.trim()) return false;
  await git(dir, ["commit", "-m", message]);
  await git(dir, ["push", "origin", "main"]);
  return true;
}

/**
 * Revert the most recent commit that touched this service's manifests (the
 * GitOps rollback: ArgoCD converges back to the pre-deploy state). Returns
 * the reverted commit sha, or null when there's nothing to revert.
 */
export async function revertLastDeploy(coords: GitopsCoords): Promise<string | null> {
  const dir = getGitopsDir(coords.tenant);
  const rel = path.join("projects", coords.project, coords.service);
  const log = await git(dir, ["log", "-n", "1", "--format=%H", "--", rel]);
  const sha = log.trim();
  if (!sha) return null;
  await git(dir, ["revert", "--no-commit", sha]);
  await git(dir, ["commit", "-m", `rollback ${coords.project}/${coords.service} (revert ${sha.slice(0, 7)})`]);
  await git(dir, ["push", "origin", "main"]);
  return sha;
}
