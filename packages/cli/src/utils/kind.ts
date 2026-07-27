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
