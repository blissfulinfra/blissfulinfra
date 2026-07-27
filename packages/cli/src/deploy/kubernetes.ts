import path from "node:path";
import chalk from "chalk";
import ora from "ora";
import { execa } from "execa";
import { setTimeout as sleep } from "node:timers/promises";
import { PrereqMissingError, DeployFailedError } from "./errors.js";
import type { ServiceCoords } from "../commands/deploy.js";
import { ensureKind, ensureKubectl, clusterExists, clusterName, kindLoadImage } from "../utils/kind.js";
import { ensureClusterPorts, getServiceDir } from "../utils/tenant-registry.js";
import { ensureGiteaReachable, ensureOrgRepo } from "../utils/gitea.js";
import {
  ensureCheckout,
  renderServiceManifests,
  serviceManifestsExist,
  bumpImageTag,
  serviceManifestDir,
  commitAndPush,
  headSha,
} from "../utils/gitops.js";
import { saveDeployment } from "../utils/deployment-storage.js";

export interface KubernetesDeployOptions {
  tag?: string;
  dryRun?: boolean;
}

async function resolveTag(serviceDir: string, explicit?: string): Promise<string> {
  if (explicit) return explicit;
  try {
    const { stdout } = await execa("git", ["-C", serviceDir, "rev-parse", "--short", "HEAD"], { stdio: "pipe" });
    return stdout.trim();
  } catch {
    return `t${Date.now()}`;
  }
}

/**
 * Nudge ArgoCD to poll the repo now instead of waiting out its ~3 min default
 * refresh interval, then wait until the app has synced the EXACT revision we
 * pushed — matching on sync status alone races the previous revision.
 */
async function waitForArgoSync(
  coords: ServiceCoords,
  targetRevision: string,
  timeoutMs = 240000,
): Promise<string> {
  const context = `kind-${clusterName(coords.tenant)}`;
  const app = `${coords.project}-${coords.service}`;
  const deadline = Date.now() + timeoutMs;
  let last = "Unknown/Unknown @ none";
  await execa("kubectl", [
    "--context", context, "-n", "argocd", "annotate", "application", app,
    "argocd.argoproj.io/refresh=normal", "--overwrite",
  ], { stdio: "pipe", timeout: 15000 }).catch(() => { /* first deploy: app just created */ });
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execa("kubectl", [
        "--context", context, "-n", "argocd", "get", "application", app,
        "-o", "jsonpath={.status.sync.status}/{.status.health.status} @ {.status.sync.revision}",
      ], { stdio: "pipe", timeout: 10000 });
      last = stdout || last;
      const [state, revision] = last.split(" @ ");
      const [sync, health] = (state ?? "").split("/");
      // A canary mid-steps reports Synced/Progressing (or Paused) — that's a
      // successful handoff, the Rollout takes over from here.
      if (sync === "Synced" && revision === targetRevision
          && health && health !== "Missing" && health !== "Unknown") {
        return state;
      }
    } catch {
      // App may not exist yet right after apply
    }
    await sleep(5000);
  }
  throw new DeployFailedError(
    `ArgoCD app '${app}' did not sync revision ${targetRevision.slice(0, 7)} within ${timeoutMs / 1000}s (last: ${last}).\n` +
    `Inspect it in the ArgoCD UI or: kubectl -n argocd get application ${app} -o yaml`,
  );
}

/**
 * Kubernetes-runtime deploy (ADR-0020):
 *   docker build → kind load → render/bump manifests in the tenant's gitops
 *   repo → push to in-cluster Gitea → apply the ArgoCD Application (first
 *   deploy only) → ArgoCD syncs → the Argo Rollout runs its canary steps.
 */
export async function deployKubernetes(
  coords: ServiceCoords,
  opts: KubernetesDeployOptions,
): Promise<void> {
  await ensureKind();
  await ensureKubectl();
  if (!(await clusterExists(coords.tenant))) {
    throw new PrereqMissingError(
      "cluster",
      `Tenant '${coords.tenant}' has no kind cluster. Provision one first:\n  blissful-infra cluster up ${coords.tenant}`,
    );
  }

  const ports = await ensureClusterPorts(coords.tenant);
  const serviceDir = getServiceDir(coords.tenant, coords.project, coords.service);
  const tag = await resolveTag(serviceDir, opts.tag);
  const imageName = `blissful-${coords.tenant}/${coords.project}-${coords.service}`;
  const image = `${imageName}:${tag}`;
  const context = `kind-${clusterName(coords.tenant)}`;

  console.log();
  console.log(chalk.bold("blissful-infra deploy"), chalk.cyan(`${coords.tenant}/${coords.project}/${coords.service}`));
  console.log(chalk.dim(`  Image:     ${image}`));
  console.log(chalk.dim(`  Cluster:   ${clusterName(coords.tenant)}  Namespace: ${coords.project}`));
  console.log();

  if (opts.dryRun) {
    console.log(chalk.yellow("Dry run — would execute:"));
    console.log(chalk.dim(`  docker build -t ${image} ${serviceDir}`));
    console.log(chalk.dim(`  kind load docker-image ${image} --name ${clusterName(coords.tenant)}`));
    console.log(chalk.dim(`  gitops: render/bump projects/${coords.project}/${coords.service} → newTag ${tag} → push`));
    console.log(chalk.dim(`  kubectl apply -f application.yaml  (first deploy only)`));
    return;
  }

  console.log(chalk.bold("→ Building image") + chalk.dim(" (first Gradle build is the slow part)"));
  await execa("docker", ["build", "-t", image, "."], { cwd: serviceDir, stdio: "inherit" });

  console.log(chalk.bold("\n→ Loading image into the cluster"));
  await kindLoadImage(coords.tenant, image);

  const spinner = ora("Preparing gitops repo...").start();
  await ensureGiteaReachable(ports.gitea!);
  const { pushUrl, inClusterUrl } = await ensureOrgRepo(coords.tenant, ports.gitea!);
  await ensureCheckout(coords.tenant, pushUrl);

  const firstDeploy = !(await serviceManifestsExist(coords));
  if (firstDeploy) {
    spinner.text = "Rendering service manifests...";
    await renderServiceManifests(coords, imageName, tag, inClusterUrl);
  } else {
    spinner.text = `Bumping image tag to ${tag}...`;
    await bumpImageTag(coords, tag);
  }

  const pushed = await commitAndPush(
    coords.tenant,
    `deploy ${coords.project}/${coords.service} ${tag}`,
  );
  spinner.succeed(pushed ? `GitOps repo updated (tag ${tag})` : "GitOps repo already at this tag");

  if (firstDeploy) {
    const appSpinner = ora("Registering ArgoCD Application...").start();
    await execa("kubectl", [
      "--context", context, "apply",
      "-f", path.join(serviceManifestDir(coords), "application.yaml"),
    ], { stdio: "pipe" });
    appSpinner.succeed(`ArgoCD Application '${coords.project}-${coords.service}' registered`);
  }

  const targetRevision = await headSha(coords.tenant);
  const syncSpinner = ora(`Waiting for ArgoCD to sync ${targetRevision.slice(0, 7)}...`).start();
  const status = await waitForArgoSync(coords, targetRevision);
  syncSpinner.succeed(`ArgoCD synced ${targetRevision.slice(0, 7)} (${status})`);

  await saveDeployment(serviceDir, {
    id: `deploy-${Date.now()}`,
    timestamp: Date.now(),
    projectName: coords.service,
    gitSha: tag,
    status: "success",
    regression: false,
    environment: coords.project,
    imageTag: tag,
    strategy: "canary",
  });

  console.log();
  console.log(chalk.green.bold("✓ Deployed."), chalk.dim("The Rollout is running its canary steps."));
  console.log(chalk.dim("  Watch:    ") + chalk.cyan(`blissful-infra canary status ${coords.service}`));
  console.log(chalk.dim("  Promote:  ") + chalk.cyan(`blissful-infra canary promote ${coords.service} --full`));
  console.log(chalk.dim("  Abort:    ") + chalk.cyan(`blissful-infra canary abort ${coords.service}`));
  console.log(chalk.dim("  ArgoCD:   ") + chalk.cyan(`http://localhost:${ports.argocd}`));
  console.log();
}
