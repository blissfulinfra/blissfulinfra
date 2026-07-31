import { Command } from "commander";
import chalk from "chalk";
import { execa } from "execa";
import {
  getTenant,
  getProject,
  getService,
  ensureClusterPorts,
  readProjectRuntime,
  getClusterDir,
} from "../utils/tenant-registry.js";
import { tenantCreateAction } from "./tenant.js";
import { projectCreateAction } from "./project.js";
import { serviceAddV2Action } from "./service-v2.js";
import { deployAction } from "./deploy.js";
import { clusterUpAction } from "./cluster.js";
import { ensureKind, ensureKubectl, clusterExists, kubeContext, writeInternalKubeconfig, warnIfLowDockerMemory } from "../utils/kind.js";
import { ensureTerraform } from "../utils/terraform.js";
import { ensureHostDashboardRunning, HOST_DASHBOARD_PORT } from "../utils/host-dashboard-compose.js";
import { GITEA_USER, GITEA_PASSWORD } from "../utils/gitea.js";
import { PrereqMissingError } from "../deploy/errors.js";

// Fixed coordinates so the demo is self-contained and re-runnable. Every step
// below is idempotent: rerunning `blissful-infra demo` skips what exists and
// redeploys, so it doubles as the "ship a change, watch the canary" loop.
const TENANT = "demo";
const PROJECT = "poc";
const SERVICE = "api";

async function checkPrereqs(): Promise<void> {
  const missing: string[] = [];
  const brew: string[] = [];

  for (const [check, name, formula] of [
    [ensureTerraform, "terraform", "hashicorp/tap/terraform"],
    [ensureKind, "kind", "kind"],
    [ensureKubectl, "kubectl", "kubectl"],
  ] as const) {
    try {
      await check();
    } catch (err) {
      if (err instanceof PrereqMissingError) {
        missing.push(name);
        brew.push(formula);
      } else {
        throw err;
      }
    }
  }

  let dockerUp = true;
  try {
    await execa("docker", ["info"], { stdio: "pipe" });
  } catch {
    dockerUp = false;
  }

  if (dockerUp) {
    await warnIfLowDockerMemory();
  }

  if (missing.length > 0 || !dockerUp) {
    console.log();
    if (missing.length > 0) {
      console.error(chalk.red(`Missing tools: ${missing.join(", ")}`));
      console.error(chalk.dim("Install them with:"));
      console.error(chalk.cyan(`  brew install ${brew.join(" ")}`));
    }
    if (!dockerUp) {
      console.error(chalk.red("Docker is not running — start Docker Desktop first."));
    }
    console.log();
    process.exit(1);
  }
}

async function readArgoCDPassword(): Promise<string | null> {
  try {
    const { stdout } = await execa("kubectl", [
      "--context", kubeContext(TENANT),
      "-n", "argocd", "get", "secret", "argocd-initial-admin-secret",
      "-o", "jsonpath={.data.password}",
    ], { stdio: "pipe", timeout: 10000 });
    return Buffer.from(stdout, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

function banner(step: number, total: number, title: string): void {
  console.log();
  console.log(chalk.bold.blue(`━━━ [${step}/${total}] ${title} `.padEnd(64, "━")));
}

export async function demoAction(): Promise<void> {
  const TOTAL = 6;
  console.log();
  console.log(chalk.bold("blissful-infra demo") + chalk.dim("  — the Kubernetes golden path, one command"));
  console.log(chalk.dim(`  tenant '${TENANT}' → kind cluster → project '${PROJECT}' (kubernetes runtime) → service '${SERVICE}' (hono)`));
  console.log(chalk.dim("  → GitOps deploy via Gitea + ArgoCD → Argo Rollouts canary → dashboard"));

  banner(1, TOTAL, "Prerequisites");
  await checkPrereqs();
  console.log(chalk.green("✓ docker, kind, terraform, kubectl all present"));

  banner(2, TOTAL, `Tenant '${TENANT}'`);
  if (await getTenant(TENANT)) {
    console.log(chalk.dim(`Tenant '${TENANT}' already exists — reusing.`));
  } else {
    await tenantCreateAction(TENANT, { skipPrompts: true, skipProjectPrompt: true });
  }

  banner(3, TOTAL, "Cluster (kind + ArgoCD + Argo Rollouts + Gitea, via Terraform)");
  if (await clusterExists(TENANT)) {
    console.log(chalk.dim(`Cluster 'blissful-${TENANT}' already running — reusing.`));
    await ensureClusterPorts(TENANT);
    const path = await import("node:path");
    await writeInternalKubeconfig(TENANT, path.join(getClusterDir(TENANT), "kubeconfig-internal")).catch(() => {});
  } else {
    await clusterUpAction(TENANT);
  }

  banner(4, TOTAL, `Project '${PROJECT}' + service '${SERVICE}'`);
  if (await getProject(TENANT, PROJECT)) {
    const runtime = await readProjectRuntime(TENANT, PROJECT);
    if (runtime !== "kubernetes") {
      console.error(chalk.red(`Project '${TENANT}/${PROJECT}' exists but runs on the '${runtime}' runtime.`));
      console.error(chalk.dim("The demo needs it on kubernetes. Remove it and rerun:"));
      console.error(chalk.cyan(`  blissful-infra project remove ${TENANT} ${PROJECT} -y`));
      process.exit(1);
    }
    console.log(chalk.dim(`Project '${PROJECT}' already exists — reusing.`));
  } else {
    await projectCreateAction(TENANT, PROJECT, { skipPrompts: true, runtime: "kubernetes" });
  }
  if (await getService(TENANT, PROJECT, SERVICE)) {
    console.log(chalk.dim(`Service '${SERVICE}' already exists — reusing.`));
  } else {
    await serviceAddV2Action(TENANT, PROJECT, SERVICE, {
      type: "backend",
      template: "hono",
      skipPrompts: true,
    });
  }

  banner(5, TOTAL, "Deploy (build → kind load → gitops push → ArgoCD sync → canary)");
  await deployAction(SERVICE, { tenant: TENANT, project: PROJECT });

  banner(6, TOTAL, "Dashboard");
  await ensureHostDashboardRunning({ silent: false });

  const ports = await ensureClusterPorts(TENANT);
  const argocdPassword = await readArgoCDPassword();

  console.log();
  console.log(chalk.green.bold("✓ Demo is up.") + chalk.dim("  Everything below is running on your machine:"));
  console.log();
  console.log(chalk.dim("  Dashboard:  ") + chalk.cyan(`http://localhost:${HOST_DASHBOARD_PORT}`) + chalk.dim("   Environments tab → Canary card"));
  console.log(chalk.dim("  ArgoCD:     ") + chalk.cyan(`http://localhost:${ports.argocd}`) + chalk.dim(`   admin / ${argocdPassword ?? "(see cluster up output)"}`));
  console.log(chalk.dim("  Gitea:      ") + chalk.cyan(`http://localhost:${ports.gitea}`) + chalk.dim(`   ${GITEA_USER} / ${GITEA_PASSWORD}   (repo ${TENANT}-gitops = the deploy audit trail)`));
  console.log();
  console.log(chalk.dim("Try the canary loop:"));
  console.log(chalk.cyan(`  blissful-infra canary status ${SERVICE}`) + chalk.dim("      watch the rollout"));
  console.log(chalk.dim("  edit ") + chalk.cyan(`~/.blissful-infra/tenants/${TENANT}/projects/${PROJECT}/services/${SERVICE}/src/app.ts`));
  console.log(chalk.cyan(`  blissful-infra demo`) + chalk.dim("                     rerun = redeploy → canary at 10%, paused"));
  console.log(chalk.cyan(`  blissful-infra canary promote ${SERVICE} --full`) + chalk.dim("  ship it"));
  console.log(chalk.cyan(`  blissful-infra rollback ${SERVICE}`) + chalk.dim("            git-revert + ArgoCD converges back"));
  console.log();
  console.log(chalk.dim("Tear down: ") + chalk.cyan("blissful-infra cluster down demo") + chalk.dim(" then ") + chalk.cyan("blissful-infra tenant remove demo"));
  console.log();
}

export const demoCommand = new Command("demo")
  .description("One-command golden path: kind cluster + ArgoCD + Argo Rollouts canary deploy, end to end")
  .action(demoAction);
