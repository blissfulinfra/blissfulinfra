import { Command } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import path from "node:path";
import { execa } from "execa";
import {
  getTenant,
  getProject,
  getService,
  ensureClusterPorts,
  readProjectRuntime,
  getClusterDir,
} from "../utils/tenant-registry.js";
import { tenantCreateAction, tenantUpAction } from "./tenant.js";
import { projectCreateAction, projectUpAction } from "./project.js";
import { serviceAddV2Action } from "./service-v2.js";
import { deployAction } from "./deploy.js";
import { clusterUpAction } from "./cluster.js";
import { ciSetupAction, ciPushAction } from "./ci.js";
import { sourceWebUrl } from "../utils/gitea.js";
import { ensureKind, ensureKubectl, clusterExists, kubeContext, writeInternalKubeconfig, warnIfLowDockerMemory } from "../utils/kind.js";
import { ensureTerraform } from "../utils/terraform.js";
import { ensureHostDashboardRunning, HOST_DASHBOARD_PORT } from "../utils/host-dashboard-compose.js";
import { GITEA_USER, GITEA_PASSWORD } from "../utils/gitea.js";
import { PrereqMissingError } from "../deploy/errors.js";

// Fixed tenant so the demo is self-contained and re-runnable; the project
// name is per-runtime so both walkthroughs can coexist side by side.
const TENANT = "demo";
const PROJECT_BY_RUNTIME = { kubernetes: "poc", compose: "store" } as const;
const BACKEND_SERVICE = "api";
const FRONTEND_SERVICE = "web";

interface DemoOptions {
  defaults?: boolean;
  runtime?: string;
  backend?: string;
  frontend?: boolean;
  observability?: boolean;
  ci?: boolean;
}

interface DemoPlan {
  runtime: "kubernetes" | "compose";
  backend: "hono" | "spring-boot";
  frontend: boolean;
  observability: boolean;
  ci: boolean;
}

async function resolvePlan(opts: DemoOptions): Promise<DemoPlan> {
  const interactive = !opts.defaults && process.stdout.isTTY;
  const plan: DemoPlan = {
    runtime: opts.runtime === "compose" ? "compose" : "kubernetes",
    backend: opts.backend === "spring-boot" ? "spring-boot" : "hono",
    frontend: opts.frontend ?? false,
    observability: opts.observability ?? false,
    ci: opts.ci ?? false,
  };
  if (!interactive) return plan;

  const answers = await inquirer.prompt([
    {
      type: "list",
      name: "runtime",
      message: "Which runtime do you want to see?",
      when: opts.runtime === undefined,
      choices: [
        { name: "kubernetes — kind cluster, GitOps via ArgoCD, canary deploys (the golden path)", value: "kubernetes" },
        { name: "compose — full local infra: Kafka, Postgres schemas, gateway, everything in Docker", value: "compose" },
      ],
      default: "kubernetes",
    },
    {
      type: "list",
      name: "backend",
      message: "Backend template?",
      when: opts.backend === undefined,
      choices: [
        { name: "hono — TypeScript, ~1 min first build (recommended for a quick demo)", value: "hono" },
        { name: "spring-boot — Kotlin + JVM, Kafka/JPA wired in, ~5 min first Gradle build", value: "spring-boot" },
      ],
      default: "hono",
    },
    {
      type: "confirm",
      name: "frontend",
      message: "Add a react-vite frontend service too?",
      when: opts.frontend === undefined,
      default: false,
    },
    {
      type: "confirm",
      name: "ci",
      message: "Run CI too? (Gitea Actions: registers a runner and builds your service on push)",
      when: (a: { runtime?: string }) => opts.ci === undefined
        && (a.runtime ?? (opts.runtime === "compose" ? "compose" : "kubernetes")) === "kubernetes",
      default: false,
    },
    {
      type: "confirm",
      name: "observability",
      message: "Start Grafana/Prometheus/Loki as well? (enables the observability links; ~1-2 min extra)",
      when: opts.observability === undefined,
      default: false,
    },
  ] as never) as Partial<DemoPlan>;

  return { ...plan, ...answers };
}

async function checkPrereqs(plan: DemoPlan): Promise<void> {
  const missing: string[] = [];
  const brew: string[] = [];

  const checks: Array<readonly [() => Promise<unknown>, string, string]> = plan.runtime === "kubernetes"
    ? [
        [ensureTerraform, "terraform", "hashicorp/tap/terraform"],
        [ensureKind, "kind", "kind"],
        [ensureKubectl, "kubectl", "kubectl"],
      ]
    : [];

  for (const [check, name, formula] of checks) {
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

async function ensureDemoService(
  project: string,
  service: string,
  type: "backend" | "frontend",
  template: string,
): Promise<void> {
  if (await getService(TENANT, project, service)) {
    console.log(chalk.dim(`Service '${service}' already exists — reusing.`));
    return;
  }
  await serviceAddV2Action(TENANT, project, service, { type, template, skipPrompts: true });
}

export async function demoAction(opts: DemoOptions): Promise<void> {
  console.log();
  console.log(chalk.bold("blissful-infra demo") + chalk.dim("  — a guided tour, one command"));

  const plan = await resolvePlan(opts);
  const project = PROJECT_BY_RUNTIME[plan.runtime];
  const services: Array<[string, "backend" | "frontend", string]> = [
    [BACKEND_SERVICE, "backend", plan.backend],
  ];
  if (plan.frontend) {
    services.push([FRONTEND_SERVICE, "frontend", "react-vite"]);
  }
  const TOTAL = (plan.runtime === "kubernetes" ? 6 : 5) + (plan.ci ? 1 : 0);

  console.log(chalk.dim(`  tenant '${TENANT}' → project '${project}' (${plan.runtime} runtime) → ${services.map(([n, , t]) => `${n} (${t})`).join(" + ")}`));
  console.log(chalk.dim(plan.runtime === "kubernetes"
    ? "  → GitOps deploy via Gitea + ArgoCD → Argo Rollouts canary → dashboard"
    : "  → project compose: Kafka + Postgres + gateway + your services → dashboard"));

  banner(1, TOTAL, "Prerequisites");
  await checkPrereqs(plan);
  console.log(chalk.green(plan.runtime === "kubernetes"
    ? "✓ docker, kind, terraform, kubectl all present"
    : "✓ docker present"));

  banner(2, TOTAL, `Tenant '${TENANT}'`);
  if (await getTenant(TENANT)) {
    console.log(chalk.dim(`Tenant '${TENANT}' already exists — reusing.`));
  } else {
    await tenantCreateAction(TENANT, { skipPrompts: true, skipProjectPrompt: true });
  }

  if (plan.runtime === "kubernetes") {
    banner(3, TOTAL, "Cluster (kind + ArgoCD + Argo Rollouts + Gitea, via Terraform)");
    if (await clusterExists(TENANT)) {
      console.log(chalk.dim(`Cluster 'blissful-${TENANT}' already running — reusing.`));
      await ensureClusterPorts(TENANT);
      await writeInternalKubeconfig(TENANT, path.join(getClusterDir(TENANT), "kubeconfig-internal")).catch(() => {});
    } else {
      await clusterUpAction(TENANT);
    }
  }

  banner(plan.runtime === "kubernetes" ? 4 : 3, TOTAL, `Project '${project}' + service${services.length > 1 ? "s" : ""}`);
  if (await getProject(TENANT, project)) {
    const runtime = await readProjectRuntime(TENANT, project);
    if (runtime !== plan.runtime) {
      console.error(chalk.red(`Project '${TENANT}/${project}' exists with the '${runtime}' runtime.`));
      console.error(chalk.cyan(`  blissful-infra project remove ${TENANT} ${project} -y`) + chalk.dim("  then rerun"));
      process.exit(1);
    }
    console.log(chalk.dim(`Project '${project}' already exists — reusing.`));
  } else {
    await projectCreateAction(TENANT, project, { skipPrompts: true, runtime: plan.runtime });
  }
  for (const [name, type, template] of services) {
    await ensureDemoService(project, name, type, template);
  }
  if (plan.runtime === "kubernetes" && plan.backend === "spring-boot") {
    console.log(chalk.dim("Note: on the kubernetes runtime spring-boot scaffolds without a Postgres binding"));
    console.log(chalk.dim("(no in-cluster Postgres yet) — pick the compose runtime for the full DB story."));
  }

  if (plan.runtime === "kubernetes") {
    banner(5, TOTAL, "Deploy (build → kind load → gitops push → ArgoCD sync → canary)");
    for (const [name] of services) {
      await deployAction(name, { tenant: TENANT, project });
    }
  } else {
    banner(4, TOTAL, "Start (docker compose: infra + services; first build takes a few minutes)");
    await projectUpAction(TENANT, project);
  }

  if (plan.ci && plan.runtime === "kubernetes") {
    banner(6, TOTAL, "CI (Gitea Actions: register a runner, push the source, run the pipeline)");
    await ciSetupAction(TENANT);
    for (const [name] of services) {
      await ciPushAction(name, { tenant: TENANT, project });
    }
  }

  if (plan.observability) {
    console.log();
    console.log(chalk.dim("Starting observability stack (Grafana/Prometheus/Loki)..."));
    await tenantUpAction(TENANT);
  }

  banner(TOTAL, TOTAL, "Dashboard");
  await ensureHostDashboardRunning({ silent: false });

  console.log();
  console.log(chalk.green.bold("✓ Demo is up.") + chalk.dim("  Everything below is running on your machine:"));
  console.log();
  console.log(chalk.dim("  Dashboard:  ") + chalk.cyan(`http://localhost:${HOST_DASHBOARD_PORT}`) + chalk.dim(plan.runtime === "kubernetes" ? "   Environments tab → Canary card" : `   pick the '${project}' project`));

  if (plan.runtime === "kubernetes") {
    const ports = await ensureClusterPorts(TENANT);
    const argocdPassword = await readArgoCDPassword();
    console.log(chalk.dim("  Your app:   ") + chalk.cyan(`http://localhost:${HOST_DASHBOARD_PORT}/api/v1/projects/${BACKEND_SERVICE}/preview/?tenant=${TENANT}`) + chalk.dim("   (proxied into the cluster)"));
    if (plan.frontend) {
      console.log(chalk.dim("  Frontend:   ") + chalk.cyan(`http://localhost:${HOST_DASHBOARD_PORT}/api/v1/projects/${FRONTEND_SERVICE}/preview/?tenant=${TENANT}`));
    }
    console.log(chalk.dim("  ArgoCD:     ") + chalk.cyan(`http://localhost:${ports.argocd}`) + chalk.dim(`   admin / ${argocdPassword ?? "(see cluster up output)"}`));
    console.log(chalk.dim("  Gitea:      ") + chalk.cyan(`http://localhost:${ports.gitea}`) + chalk.dim(`   ${GITEA_USER} / ${GITEA_PASSWORD}   (repo ${TENANT}-gitops = the deploy audit trail)`));
    if (plan.ci) {
      console.log(chalk.dim("  CI:         ") + chalk.cyan(`${sourceWebUrl(TENANT, project, BACKEND_SERVICE, ports.gitea!)}/actions`) + chalk.dim("   GitHub-Actions-compatible pipeline"));
    } else {
      console.log(chalk.dim("  CI:         ") + chalk.cyan("blissful-infra ci setup && blissful-infra ci push " + BACKEND_SERVICE) + chalk.dim("   run the pipeline"));
    }
    if (!plan.observability) {
      console.log(chalk.dim("  Optional:   ") + chalk.cyan("blissful-infra tenant up") + chalk.dim(" starts Grafana/Prometheus/Loki (adds observability header links)"));
    }
    console.log();
    console.log(chalk.dim("Try the canary loop:"));
    console.log(chalk.cyan(`  blissful-infra canary status ${BACKEND_SERVICE}`) + chalk.dim("      watch the rollout"));
    console.log(chalk.dim("  edit ") + chalk.cyan(`~/.blissful-infra/tenants/${TENANT}/projects/${project}/services/${BACKEND_SERVICE}/src/`));
    console.log(chalk.cyan(`  blissful-infra demo --defaults`) + chalk.dim("          rerun = redeploy → canary at 10%, paused"));
    console.log(chalk.cyan(`  blissful-infra canary promote ${BACKEND_SERVICE} --full`) + chalk.dim("  ship it"));
    console.log(chalk.cyan(`  blissful-infra rollback ${BACKEND_SERVICE}`) + chalk.dim("            git-revert + ArgoCD converges back"));
  } else {
    const projectEntry = await getProject(TENANT, project);
    const backend = projectEntry?.services.find(s => s.name === BACKEND_SERVICE);
    const frontend = projectEntry?.services.find(s => s.name === FRONTEND_SERVICE);
    if (backend?.ports.http) {
      console.log(chalk.dim("  Backend:    ") + chalk.cyan(`http://localhost:${backend.ports.http}`) + chalk.dim(`   (${plan.backend}${plan.backend === "spring-boot" ? ", Postgres schema auto-provisioned" : ""})`));
    }
    if (frontend?.ports.http) {
      console.log(chalk.dim("  Frontend:   ") + chalk.cyan(`http://localhost:${frontend.ports.http}`) + chalk.dim("   (react-vite via nginx)"));
    }
    if (projectEntry?.portBlock.gateway) {
      console.log(chalk.dim("  Gateway:    ") + chalk.cyan(`http://localhost:${projectEntry.portBlock.gateway}`));
    }
    if (!plan.observability) {
      console.log(chalk.dim("  Optional:   ") + chalk.cyan("blissful-infra tenant up") + chalk.dim(" starts Grafana/Prometheus/Loki"));
    }
    console.log();
    console.log(chalk.dim("Lifecycle:"));
    console.log(chalk.cyan(`  blissful-infra service logs ${BACKEND_SERVICE}`) + chalk.dim("   tail the backend"));
    console.log(chalk.cyan(`  blissful-infra project down ${project}`) + chalk.dim("      stop the project"));
  }
  console.log();
  console.log(chalk.dim("Tear down: ") + chalk.cyan("blissful-infra clean") + chalk.dim("   (or ./demo.sh clean; --all removes every tenant)"));
  console.log();
  console.log(chalk.dim("To enable the AI Chat agent in the dashboard:"));
  console.log(chalk.cyan("  blissful-infra dashboard login") + chalk.dim("              OAuth via Claude Code / Claude Desktop"));
  console.log(chalk.dim("  OR:"));
  console.log(chalk.cyan("  export ANTHROPIC_API_KEY=sk-...") + chalk.dim("            set your API key, then restart dashboard"));
  console.log();
  console.log(chalk.dim("How it fits together: docs/demo-architecture.md"));
  console.log();
}

export const demoCommand = new Command("demo")
  .description("Guided one-command demo: pick a runtime, backend and extras, get a running stack")
  .option("--defaults", "Skip prompts (kubernetes runtime, hono backend, no frontend)")
  .option("--runtime <runtime>", "kubernetes | compose")
  .option("--backend <template>", "hono | spring-boot")
  .option("--frontend", "Also scaffold a react-vite frontend")
  .option("--observability", "Also start Grafana/Prometheus/Loki")
  .option("--ci", "Also register the Gitea Actions runner and run each service's pipeline")
  .action(async (opts: DemoOptions) => {
    await demoAction(opts);
  });
