import { PrereqMissingError } from "./errors.js";
import type { ServiceCoords } from "../commands/deploy.js";

export interface KubernetesDeployOptions {
  tag?: string;
  dryRun?: boolean;
}

/**
 * Kubernetes-runtime deploy: build image → kind load → gitops push → ArgoCD
 * sync → Argo Rollout canary. The full pipeline lands with the cluster
 * provisioning work; until then this is a stub that points at `cluster up`.
 */
export async function deployKubernetes(
  _coords: ServiceCoords,
  _opts: KubernetesDeployOptions,
): Promise<void> {
  throw new PrereqMissingError(
    "cluster",
    "The tenant has no kind cluster yet. Provision one first:\n  blissful-infra cluster up",
  );
}
