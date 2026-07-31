import { execa } from "execa";
import { PrereqMissingError } from "../deploy/errors.js";

/** One kind cluster per tenant (ADR-0020). */
export function clusterName(tenant: string): string {
  return `blissful-${tenant}`;
}

/** kubectl context name kind registers for the tenant's cluster. */
export function kubeContext(tenant: string): string {
  return `kind-${clusterName(tenant)}`;
}

export async function ensureKind(): Promise<void> {
  try {
    await execa("kind", ["version"], { stdio: "pipe" });
  } catch {
    throw new PrereqMissingError("kind", "Install it with:\n  brew install kind");
  }
}

export async function ensureKubectl(): Promise<void> {
  try {
    await execa("kubectl", ["version", "--client"], { stdio: "pipe" });
  } catch {
    throw new PrereqMissingError("kubectl", "Install it with:\n  brew install kubectl");
  }
}

export async function clusterExists(tenant: string): Promise<boolean> {
  try {
    const { stdout } = await execa("kind", ["get", "clusters"], { stdio: "pipe" });
    return stdout.split("\n").map(l => l.trim()).includes(clusterName(tenant));
  } catch {
    return false;
  }
}

/**
 * Load a locally-built image into the tenant's kind cluster so pods can pull
 * it without a registry (imagePullPolicy must not be Always).
 */
export async function kindLoadImage(tenant: string, image: string): Promise<void> {
  await execa("kind", ["load", "docker-image", image, "--name", clusterName(tenant)], {
    stdio: "inherit",
  });
}

/** Write the cluster's kubeconfig to a file and return its path. */
export async function writeKubeconfig(tenant: string, filePath: string): Promise<string> {
  const { stdout } = await execa("kind", ["get", "kubeconfig", "--name", clusterName(tenant)], {
    stdio: "pipe",
  });
  const fs = await import("node:fs/promises");
  await fs.writeFile(filePath, stdout, { mode: 0o600 });
  return filePath;
}

/**
 * Write the cluster's INTERNAL kubeconfig (server = the control-plane node's
 * name on kind's docker network). This is what containers joined to the kind
 * network — like the dashboard — must use; the regular kubeconfig points at
 * the host loopback, which a container can't reach.
 */
export async function writeInternalKubeconfig(tenant: string, filePath: string): Promise<string> {
  const { stdout } = await execa("kind", [
    "get", "kubeconfig", "--internal", "--name", clusterName(tenant),
  ], { stdio: "pipe" });
  const fs = await import("node:fs/promises");
  await fs.writeFile(filePath, stdout, { mode: 0o600 });
  return filePath;
}

/**
 * The kind node + ArgoCD + Gitea + Argo Rollouts need roughly 4GB; below
 * ~10GB total the Docker VM OOM-kills containers (exit 137) once anything
 * else — builds, other stacks, Jenkins — runs alongside. Warn loudly, since
 * the failure otherwise looks like containers vanishing at random.
 */
export async function warnIfLowDockerMemory(): Promise<void> {
  try {
    const { stdout } = await execa("docker", ["info", "--format", "{{.MemTotal}}"], { stdio: "pipe" });
    const gb = Number(stdout.trim()) / 1024 ** 3;
    if (gb > 0 && gb < 10) {
      const chalk = (await import("chalk")).default;
      console.log(chalk.yellow(`⚠ Docker Desktop has only ${gb.toFixed(1)}GB of memory.`));
      console.log(chalk.yellow("  The cluster platform needs ~4GB; under memory pressure Docker OOM-kills"));
      console.log(chalk.yellow("  containers (they vanish with exit 137). Recommended: 12GB+ via"));
      console.log(chalk.yellow("  Docker Desktop → Settings → Resources → Memory."));
    }
  } catch { /* docker not reachable — other checks handle that */ }
}
