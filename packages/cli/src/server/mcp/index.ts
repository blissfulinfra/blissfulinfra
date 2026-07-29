/**
 * blissful-infra MCP server.
 *
 * Exposes the tenant → project → service model (ADR-0017) and the local
 * Kubernetes golden path (ADR-0020) as MCP tools, so Claude can drive the same
 * workflow the CLI drives.
 *
 * Execution model (see ADR-0021):
 *   - Reads run in-process against the registry, Docker and kubectl.
 *   - Mutations spawn the CLI as a subprocess. The command actions print with
 *     chalk/ora, and this process's stdout IS the JSON-RPC stream — writing
 *     there would corrupt the protocol.
 *   - Operations measured in minutes (cluster up, deploy) return a jobId
 *     immediately; the agent polls get_job.
 *
 * Usage (stdio — spawned by Claude Desktop / Claude Code / the dashboard):
 *   blissful-infra mcp
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readContext, writeContext } from "../../utils/context.js";
import { getBlissfulHome, listTenants } from "../../utils/tenant-registry.js";
import { clusterExists, kubeContext } from "../../utils/kind.js";
import { getRolloutStatus } from "../../utils/rollouts.js";
import { collectTenantProjectLogs, filterErrorLikeLogs } from "../../utils/collectors.js";
import {
  CoordinateError,
  formatCoords,
  resolveProject,
  resolveService,
  resolveTenant,
  serviceRuntime,
} from "./coords.js";
import { servicePods, serviceContainers, tenantLinks, tenantTree } from "./inspect.js";
import { getJob, listJobs, runCli, startJob, summarizeJob } from "./jobs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** dist/server/mcp/index.js → dist/index.js */
function resolveCliPath(): string {
  return path.join(__dirname, "..", "..", "index.js");
}

export interface McpServerOptions {
  name?: string;
  /** Override the CLI entrypoint used for mutations (tests). */
  cliPath?: string;
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function ok(value: unknown): ToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Every handler funnels through here so a bad coordinate comes back as an
 * actionable message instead of an MCP transport error. The old server
 * returned empty success payloads for unknown names, which left the agent
 * unable to tell a typo from an idle service.
 */
async function handle(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CoordinateError) return fail(err.message);
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/** Result shape for a CLI-backed mutation that finishes quickly. */
function cliResult(label: string, r: { ok: boolean; output: string; exitCode: number }): ToolResult {
  const body = `${label}\nexit code: ${r.exitCode}\n\n${r.output || "(no output)"}`;
  return r.ok ? ok(body) : fail(body);
}

const READ_ONLY = { readOnlyHint: true } as const;
const DESTRUCTIVE = { destructiveHint: true } as const;

const tenantArg = z.string().optional().describe("Tenant name (defaults to the `use` context, or the only tenant)");
const projectArg = z.string().optional().describe("Project name (defaults to the `use` context, or the only project)");

export function createMcpServer(opts: McpServerOptions = {}): McpServer {
  const cliPath = opts.cliPath ?? resolveCliPath();
  const server = new McpServer({ name: opts.name ?? "blissful-infra", version: "2.0.0" });

  // ── Discovery ──────────────────────────────────────────────────────────── //

  server.registerTool(
    "get_context",
    {
      title: "Get context and topology",
      description:
        "Start here. Returns the current tenant/project selection plus the full " +
        "tenant → project → service tree, each project's runtime (compose or kubernetes), " +
        "and whether each tenant's kind cluster is provisioned. The names returned are " +
        "the exact coordinates every other tool accepts.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => handle(async () => {
      const ctx = await readContext();
      return ok({
        blissfulHome: getBlissfulHome(),
        currentTenant: ctx.tenant ?? null,
        currentProject: ctx.project ?? null,
        tenants: await tenantTree(),
      });
    }),
  );

  server.registerTool(
    "set_context",
    {
      title: "Set default tenant/project",
      description:
        "Set the persistent default tenant (and optionally project), equivalent to " +
        "`blissful-infra use <tenant> [project]`. Affects the CLI and dashboard too.",
      inputSchema: {
        tenant: z.string().describe("Tenant to select"),
        project: z.string().optional().describe("Project to select within that tenant"),
      },
    },
    async ({ tenant, project }) => handle(async () => {
      const coords = project
        ? await resolveProject(tenant, project)
        : { tenant: await resolveTenant(tenant), project: undefined };
      await writeContext({ tenant: coords.tenant, project: coords.project });
      return ok({ currentTenant: coords.tenant, currentProject: coords.project ?? null });
    }),
  );

  server.registerTool(
    "describe_service",
    {
      title: "Describe a service",
      description:
        "Full detail for one service: resolved coordinates, project runtime, allocated " +
        "ports, and live container (compose) or pod (kubernetes) status. Takes a SERVICE " +
        "name — call get_context if you need the list.",
      inputSchema: {
        service: z.string().describe("Service name"),
        tenant: tenantArg,
        project: projectArg,
      },
      annotations: READ_ONLY,
    },
    async ({ service, tenant, project }) => handle(async () => {
      const coords = await resolveService(service, tenant, project);
      const runtime = await serviceRuntime(coords);
      const workloads = runtime === "kubernetes"
        ? { pods: await servicePods(coords) }
        : { containers: await serviceContainers(coords) };
      return ok({ coordinates: coords, runtime, ...workloads });
    }),
  );

  server.registerTool(
    "get_links",
    {
      title: "Get tool URLs",
      description:
        "Browser URLs for a tenant's tooling: dashboard, Grafana, Prometheus, Jenkins, " +
        "ArgoCD and Gitea. A null argocd/gitea means the kind cluster has not been " +
        "provisioned yet — run cluster_up.",
      inputSchema: { tenant: tenantArg },
      annotations: READ_ONLY,
    },
    async ({ tenant }) => handle(async () => ok(await tenantLinks(await resolveTenant(tenant)))),
  );

  // ── Scaffolding ────────────────────────────────────────────────────────── //

  server.registerTool(
    "create_tenant",
    {
      title: "Create a tenant",
      description:
        "Scaffold a new tenant (owns Jenkins + the observability stack). Long-running: " +
        "returns a jobId, poll with get_job.",
      inputSchema: {
        name: z.string().describe("Tenant name (lowercase alphanumeric with hyphens)"),
        jenkins: z.boolean().default(true).describe("Include Jenkins"),
        observability: z.boolean().default(true).describe("Include Prometheus, Grafana, Tempo and Loki"),
      },
    },
    async ({ name, jenkins, observability }) => handle(async () => {
      const args = ["tenant", "create", name, "--skip-prompts"];
      if (!jenkins) args.push("--no-jenkins");
      if (!observability) args.push("--no-prometheus", "--no-grafana", "--no-tempo", "--no-loki");
      return ok(summarizeJob(startJob(`create tenant ${name}`, args, cliPath)));
    }),
  );

  server.registerTool(
    "create_project",
    {
      title: "Create a project",
      description:
        "Create a project inside a tenant. runtime='kubernetes' makes its services " +
        "Argo Rollouts on the tenant's kind cluster (requires cluster_up first); " +
        "'compose' (default) runs them as Docker Compose services.",
      inputSchema: {
        name: z.string().describe("Project name (kebab-case)"),
        tenant: tenantArg,
        runtime: z.enum(["compose", "kubernetes"]).default("compose").describe("Project runtime"),
        kafka: z.boolean().default(true).describe("Include Kafka"),
        postgres: z.boolean().default(true).describe("Include Postgres"),
        redis: z.boolean().default(true).describe("Include Redis"),
        gateway: z.boolean().default(true).describe("Include the API gateway"),
      },
    },
    async ({ name, tenant, runtime, kafka, postgres, redis, gateway }) => handle(async () => {
      const t = await resolveTenant(tenant);
      const args = ["project", "create", t, name, "--skip-prompts", "--runtime", runtime];
      if (!kafka) args.push("--no-kafka");
      if (!postgres) args.push("--no-postgres");
      if (!redis) args.push("--no-redis");
      if (!gateway) args.push("--no-gateway");
      return cliResult(`create project ${t}/${name}`, await runCli(args, cliPath, 180_000));
    }),
  );

  server.registerTool(
    "add_service",
    {
      title: "Add a service",
      description:
        "Add a service to a project. Backends: spring-boot (JVM), lambda-python, hono " +
        "(TypeScript — the only one deployable to Cloudflare Workers). Frontends: react-vite.",
      inputSchema: {
        name: z.string().describe("Service name (kebab-case)"),
        type: z.enum(["backend", "frontend", "worker"]).describe("Service type"),
        tenant: tenantArg,
        project: projectArg,
        template: z.string().optional().describe("backend: spring-boot|lambda-python|hono, frontend: react-vite"),
        database: z.boolean().default(true).describe("Allocate a Postgres schema (backends and workers)"),
      },
    },
    async ({ name, type, tenant, project, template, database }) => handle(async () => {
      const coords = await resolveProject(tenant, project);
      const args = ["service", "add", coords.tenant, coords.project, name, "--type", type, "--skip-prompts"];
      if (template) args.push("--template", template);
      if (!database) args.push("--no-database");
      return cliResult(`add service ${coords.tenant}/${coords.project}/${name}`, await runCli(args, cliPath, 180_000));
    }),
  );

  // ── Lifecycle ──────────────────────────────────────────────────────────── //

  server.registerTool(
    "tenant_lifecycle",
    {
      title: "Start/stop/remove a tenant",
      description:
        "Start or stop a tenant's shared infrastructure (Jenkins, observability), or " +
        "remove the tenant entirely. 'remove' deletes all of its data and is irreversible.",
      inputSchema: {
        action: z.enum(["up", "down", "remove"]).describe("Lifecycle action"),
        tenant: tenantArg,
      },
      annotations: DESTRUCTIVE,
    },
    async ({ action, tenant }) => handle(async () => {
      const t = await resolveTenant(tenant);
      const args = ["tenant", action, t];
      if (action === "remove") args.push("--skip-prompts");
      return ok(summarizeJob(startJob(`tenant ${action} ${t}`, args, cliPath)));
    }),
  );

  server.registerTool(
    "project_lifecycle",
    {
      title: "Start/stop/remove a project",
      description:
        "Start or stop a project's shared infrastructure (Kafka, Postgres, gateway), or " +
        "remove the project. 'remove' is irreversible.",
      inputSchema: {
        action: z.enum(["up", "down", "remove"]).describe("Lifecycle action"),
        tenant: tenantArg,
        project: projectArg,
      },
      annotations: DESTRUCTIVE,
    },
    async ({ action, tenant, project }) => handle(async () => {
      const coords = await resolveProject(tenant, project);
      const args = ["project", action, coords.tenant, coords.project];
      if (action === "remove") args.push("--skip-prompts");
      return ok(summarizeJob(startJob(`project ${action} ${coords.tenant}/${coords.project}`, args, cliPath)));
    }),
  );

  server.registerTool(
    "service_lifecycle",
    {
      title: "Start/stop/remove a service",
      description:
        "Start, stop or remove a single service. For kubernetes-runtime projects use " +
        "deploy_service instead — 'up' is the Compose lifecycle.",
      inputSchema: {
        action: z.enum(["up", "down", "remove"]).describe("Lifecycle action"),
        service: z.string().describe("Service name"),
        tenant: tenantArg,
        project: projectArg,
      },
      annotations: DESTRUCTIVE,
    },
    async ({ action, service, tenant, project }) => handle(async () => {
      const coords = await resolveService(service, tenant, project);
      const runtime = await serviceRuntime(coords);
      if (runtime === "kubernetes" && action === "up") {
        return fail(
          `Project '${coords.project}' runs the kubernetes runtime — 'up' does not apply. ` +
          `Use deploy_service to build, push and roll out '${coords.service}'.`,
        );
      }
      const args = ["service", action, coords.tenant, coords.project, coords.service];
      return ok(summarizeJob(startJob(`service ${action} ${formatCoords(coords)}`, args, cliPath)));
    }),
  );

  // ── Kubernetes golden path (ADR-0020) ──────────────────────────────────── //

  server.registerTool(
    "cluster_up",
    {
      title: "Provision the tenant's kind cluster",
      description:
        "Terraform-provision the tenant's kind cluster with ArgoCD, Argo Rollouts and " +
        "Gitea. Required before any kubernetes-runtime project can deploy. Takes several " +
        "minutes: returns a jobId, poll with get_job.",
      inputSchema: { tenant: tenantArg },
    },
    async ({ tenant }) => handle(async () => {
      const t = await resolveTenant(tenant);
      if (await clusterExists(t)) {
        return ok(`Cluster for tenant '${t}' already exists (context ${kubeContext(t)}). Nothing to do.`);
      }
      return ok(summarizeJob(startJob(`cluster up ${t}`, ["cluster", "up", t], cliPath)));
    }),
  );

  server.registerTool(
    "cluster_down",
    {
      title: "Destroy the tenant's kind cluster",
      description: "Terraform-destroy the tenant's kind cluster. Irreversible: all in-cluster state is lost.",
      inputSchema: { tenant: tenantArg },
      annotations: DESTRUCTIVE,
    },
    async ({ tenant }) => handle(async () => {
      const t = await resolveTenant(tenant);
      return ok(summarizeJob(startJob(`cluster down ${t}`, ["cluster", "down", t], cliPath)));
    }),
  );

  server.registerTool(
    "cluster_status",
    {
      title: "Cluster status",
      description: "Whether the tenant's kind cluster exists, its kube context, and its ArgoCD/Gitea URLs.",
      inputSchema: { tenant: tenantArg },
      annotations: READ_ONLY,
    },
    async ({ tenant }) => handle(async () => {
      const t = await resolveTenant(tenant);
      const exists = await clusterExists(t);
      return ok({
        tenant: t,
        provisioned: exists,
        kubeContext: exists ? kubeContext(t) : null,
        links: await tenantLinks(t),
        hint: exists ? undefined : "Run cluster_up to provision it.",
      });
    }),
  );

  server.registerTool(
    "deploy_service",
    {
      title: "Deploy a service",
      description:
        "Deploy a service. target='kubernetes' (default) builds the image, loads it into " +
        "the tenant's kind cluster, pushes manifests to Gitea and lets ArgoCD run the " +
        "canary. target='cloudflare' promotes the service to Cloudflare Workers/Pages. " +
        "Returns a jobId — poll with get_job. Use dryRun to preview.",
      inputSchema: {
        service: z.string().describe("Service name"),
        tenant: tenantArg,
        project: projectArg,
        target: z.enum(["kubernetes", "cloudflare"]).default("kubernetes").describe("Deploy target"),
        tag: z.string().optional().describe("Image tag (defaults to the service's git short SHA)"),
        dryRun: z.boolean().default(false).describe("Preview without making changes"),
      },
    },
    async ({ service, tenant, project, target, tag, dryRun }) => handle(async () => {
      const coords = await resolveService(service, tenant, project);
      const runtime = await serviceRuntime(coords);
      if (target === "kubernetes" && runtime !== "kubernetes") {
        return fail(
          `Project '${coords.project}' runs the compose runtime, so there is nothing to deploy to kubernetes.\n` +
          `Either start it with service_lifecycle(action='up'), deploy it to Cloudflare with ` +
          `target='cloudflare', or create a kubernetes-runtime project.`,
        );
      }
      const args = ["deploy", coords.service, "--tenant", coords.tenant, "--project", coords.project, "--target", target];
      if (tag) args.push("--tag", tag);
      if (dryRun) args.push("--dry-run");
      // A dry run just prints a plan — no reason to make the agent poll for it.
      if (dryRun) return cliResult(`deploy ${formatCoords(coords)} (dry run)`, await runCli(args, cliPath, 60_000));
      return ok(summarizeJob(startJob(`deploy ${formatCoords(coords)} → ${target}`, args, cliPath)));
    }),
  );

  server.registerTool(
    "rollback_service",
    {
      title: "Roll back a service",
      description:
        "Roll back a service to its previous revision. Default is a GitOps revert (ArgoCD " +
        "reconciles); immediate=true does a direct rollout undo, which drifts from git.",
      inputSchema: {
        service: z.string().describe("Service name"),
        tenant: tenantArg,
        project: projectArg,
        immediate: z.boolean().default(false).describe("Skip GitOps, undo the rollout directly"),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ service, tenant, project, immediate }) => handle(async () => {
      const coords = await resolveService(service, tenant, project);
      const args = ["rollback", coords.service, "--tenant", coords.tenant, "--project", coords.project];
      if (immediate) args.push("--immediate");
      return ok(summarizeJob(startJob(`rollback ${formatCoords(coords)}`, args, cliPath)));
    }),
  );

  server.registerTool(
    "canary_status",
    {
      title: "Canary rollout status",
      description:
        "Current Argo Rollout state for a service: phase, canary step, traffic weight and " +
        "message. Poll this after deploy_service to decide whether to promote or abort.",
      inputSchema: {
        service: z.string().describe("Service name"),
        tenant: tenantArg,
        project: projectArg,
      },
      annotations: READ_ONLY,
    },
    async ({ service, tenant, project }) => handle(async () => {
      const coords = await resolveService(service, tenant, project);
      if ((await serviceRuntime(coords)) !== "kubernetes") {
        return fail(`Project '${coords.project}' runs the compose runtime — it has no canary rollout.`);
      }
      const status = await getRolloutStatus(coords.service, coords.project, kubeContext(coords.tenant));
      if (!status) {
        return fail(
          `No rollout found for ${formatCoords(coords)}. ` +
          `Either it has never been deployed (run deploy_service) or the cluster is down (check cluster_status).`,
        );
      }
      return ok({ coordinates: coords, ...status });
    }),
  );

  server.registerTool(
    "canary_control",
    {
      title: "Drive a canary rollout",
      description:
        "Advance or stop a canary: 'promote' moves to the next step, 'promote-full' jumps " +
        "to 100%, 'abort' rolls back to stable, 'pause'/'resume' hold and release it.",
      inputSchema: {
        action: z.enum(["promote", "promote-full", "abort", "pause", "resume"]).describe("Canary action"),
        service: z.string().describe("Service name"),
        tenant: tenantArg,
        project: projectArg,
      },
      annotations: DESTRUCTIVE,
    },
    async ({ action, service, tenant, project }) => handle(async () => {
      const coords = await resolveService(service, tenant, project);
      if ((await serviceRuntime(coords)) !== "kubernetes") {
        return fail(`Project '${coords.project}' runs the compose runtime — it has no canary rollout.`);
      }
      const verb = action === "promote-full" ? "promote" : action;
      const args = ["canary", verb, coords.service, "--tenant", coords.tenant, "--project", coords.project];
      if (action === "promote-full") args.push("--full");
      return cliResult(`canary ${action} ${formatCoords(coords)}`, await runCli(args, cliPath, 120_000));
    }),
  );

  // ── Observability ──────────────────────────────────────────────────────── //

  server.registerTool(
    "get_logs",
    {
      title: "Get logs",
      description:
        "Recent container logs for a project, optionally narrowed to one service, to a " +
        "text match, or to error-like lines only.",
      inputSchema: {
        tenant: tenantArg,
        project: projectArg,
        service: z.string().optional().describe("Narrow to a single service"),
        filter: z.string().optional().describe("Case-insensitive substring match"),
        errorsOnly: z.boolean().default(false).describe("Keep only error/warning/exception lines"),
        limit: z.number().int().min(1).max(1000).default(100).describe("Max lines to return"),
      },
      annotations: READ_ONLY,
    },
    async ({ tenant, project, service, filter, errorsOnly, limit }) => handle(async () => {
      const coords = await resolveProject(tenant, project);
      if (service) await resolveService(service, coords.tenant, coords.project);

      let logs = await collectTenantProjectLogs(coords.tenant, coords.project, limit);
      if (service) logs = logs.filter(l => l.service === service);
      if (filter) {
        const needle = filter.toLowerCase();
        logs = logs.filter(l => l.message.toLowerCase().includes(needle));
      }
      if (errorsOnly) logs = filterErrorLikeLogs(logs);

      if (logs.length === 0) {
        return ok(
          `No matching log lines for ${coords.tenant}/${coords.project}` +
          `${service ? `/${service}` : ""}. The containers may be stopped — check describe_service.`,
        );
      }
      return ok(logs.slice(-limit).map(l => `[${l.timestamp}] ${l.service}: ${l.message}`).join("\n"));
    }),
  );

  server.registerTool(
    "run_pipeline",
    {
      title: "Run the local CI pipeline",
      description:
        "Run the local build/test/scan pipeline for a service. Returns a jobId — poll with get_job.",
      inputSchema: {
        service: z.string().describe("Service name"),
        tenant: tenantArg,
        project: projectArg,
        skipTests: z.boolean().default(false).describe("Skip the test stage"),
        skipScan: z.boolean().default(false).describe("Skip the security scan stage"),
      },
    },
    async ({ service, tenant, project, skipTests, skipScan }) => handle(async () => {
      const coords = await resolveService(service, tenant, project);
      const args = ["pipeline", coords.service, "--tenant", coords.tenant, "--project", coords.project, "--local"];
      if (skipTests) args.push("--skip-tests");
      if (skipScan) args.push("--skip-scan");
      return ok(summarizeJob(startJob(`pipeline ${formatCoords(coords)}`, args, cliPath)));
    }),
  );

  // ── Jobs ───────────────────────────────────────────────────────────────── //

  server.registerTool(
    "get_job",
    {
      title: "Get job status",
      description:
        "Status and output tail for a job started by cluster_up, deploy_service and " +
        "friends. Poll until status is 'succeeded' or 'failed'.",
      inputSchema: {
        jobId: z.string().describe("Job id returned by the tool that started it"),
        tailLines: z.number().int().min(1).max(500).default(40).describe("Output lines to return"),
      },
      annotations: READ_ONLY,
    },
    async ({ jobId, tailLines }) => handle(async () => {
      const job = getJob(jobId);
      if (!job) {
        const known = listJobs().map(j => j.id);
        return fail(`No job '${jobId}'. Known jobs this session: ${known.length ? known.join(", ") : "(none)"}.`);
      }
      return ok(summarizeJob(job, tailLines));
    }),
  );

  server.registerTool(
    "list_jobs",
    {
      title: "List jobs",
      description: "Every job started in this MCP session, newest first.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => handle(async () => ok(listJobs().map(j => summarizeJob(j, 5)))),
  );

  return server;
}

export async function startMcpServer(opts: McpServerOptions = {}): Promise<void> {
  const server = createMcpServer(opts);
  await server.connect(new StdioServerTransport());
}

/** Re-exported for the verify harness and tests. */
export { listTenants };
