import http from "node:http";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { loadConfig } from "../utils/config.js";
import { PLUGIN_REGISTRY, DATA_PLATFORM_REGISTRY } from "../utils/plugin-registry.js";
import { toExecError } from "../utils/errors.js";
import { getTenant, listTenants, findServiceProject, getServiceDir, readProjectRuntime, readServiceConfig } from "../utils/tenant-registry.js";
import { kubeContext } from "../utils/kind.js";
import {
  loadSavedOntology,
  saveOntology,
  getNodeConfig,
  setNodeConfig,
  wireEdge,
} from "../utils/ontology.js";
import {
  collectDockerLogs,
  collectContext,
  formatContextForPrompt,
} from "../utils/collectors.js";
import { type ChatMessage } from "../utils/ollama.js";
import {
  getProvider,
  getModelInfo,
  aiChat,
  listAllModels,
  type AIProvider,
} from "../utils/ai-provider.js";
import {
  saveMetrics,
  loadMetrics,
  getMetricsSummary,
  exportMetricsToJson,
  exportMetricsToCsv,
  getStorageInfo,
  clearMetrics,
  type ContainerMetricsData,
  type HttpMetricsData,
} from "../utils/metrics-storage.js";
import {
  checkAlerts,
  loadAlertsConfig,
  saveAlertsConfig,
  getActiveAlerts,
  getAlertHistory,
  addThreshold,
  updateThreshold,
  deleteThreshold,
  acknowledgeAlerts,
  initializeAlerts,
  type AlertThreshold,
  type MetricsSnapshot,
} from "../utils/alerts.js";
import {
  persistLogs,
  searchLogs,
  loadLogConfig,
  saveLogConfig,
  getLogStorageStats,
  forceRotate,
  clearLogs,
  type LogRetentionConfig,
} from "../utils/log-storage.js";
import {
  saveDeployment,
  updateDeployment,
  loadDeployments,
  type DeploymentRecord,
} from "../utils/deployment-storage.js";
import {
  type Service,
  type ServiceHealth,
  type HealthResponse,
  type ProjectStatus,
  type ContainerMetrics,
  type HttpMetrics,
  type ProjectMetrics,
  type CanaryStatus,
  CanaryActionSchema,
  CreateDeploymentRequestSchema,
  UpdateDeploymentRequestSchema,
} from "@blissful-infra/shared";

const SYSTEM_PROMPT = `You are a helpful infrastructure assistant for the blissful-infra project. You help developers understand their application logs, diagnose issues, and suggest improvements.

You have access to blissful-infra MCP tools (prefixed mcp__blissful-infra__):
- list_projects: enumerate tenants, projects, and services
- get_health / get_metrics: live status + Prometheus metrics
- query_logs / get_logs: search Loki / docker logs for any service
- list_deployments: deployment history
- get_pipeline / trigger_build: CI state

Behavior:
1. If the question can be answered from the recent logs / commits already in the prompt, do that.
2. If you need more (different service, different time window, a specific metric, a deployment timeline, etc.), CALL THE MCP TOOLS. Don't guess and don't say "I don't have access" — you do.
3. Quote concrete log lines or metric values when you ground a claim.
4. Suggest specific, actionable fixes.

Keep responses concise and focused. Use markdown for code blocks and lists.`;


const DOCKER_MODE = process.env.DOCKER_MODE === "true";

// ─── Gatling job state ────────────────────────────────────────────────────────
interface GatlingJob {
  status: "running" | "completed" | "error";
  startedAt: number;
  completedAt?: number;
  logLines: string[];
  exitCode?: number;
}
const gatlingJobs = new Map<string, GatlingJob>();
// ─────────────────────────────────────────────────────────────────────────────

const SERVICE_URLS: Record<string, string> = DOCKER_MODE
  ? { backend: "http://backend:8080", frontend: "http://frontend:80" }
  : { backend: "http://localhost:8080", frontend: "http://localhost:3000" };

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function createApiServer(workingDir: string, port = 3002) {
  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://localhost:${port}`);

    // API versioning — only `/api/v1/...` is accepted. Reject any other
    // `/api/...` request with 404 + a clear message so callers know to
    // migrate. (Static asset paths under `/api/...` are not a concern: the
    // dashboard's static fallthrough excludes anything starting with
    // `/api/v1/`.) New versions branch off here as `/api/v2/...`.
    if (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/v1/") && url.pathname !== "/api/v1") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: "Unsupported API version",
        hint: "Use /api/v1/... — the unversioned /api/ form has been removed.",
      }));
      return;
    }

    // Tenant resolution: control-plane mode (no env binding) reads ?tenant=
    // from the query string. Legacy single-tenant mode (TENANT_NAME env set)
    // ignores the query string. This is how one dashboard manages every tenant.
    const tenantFromRequest = (): string | null => {
      return process.env.TENANT_NAME ?? url.searchParams.get("tenant") ?? null;
    };

    // In the container, kubectl must use each cluster's INTERNAL kubeconfig
    // (host-loopback API endpoints are unreachable from here). All internal
    // kubeconfigs merge via KUBECONFIG; context names match the host's
    // (kind-blissful-<tenant>), so every --context call works unchanged.
    if (DOCKER_MODE) {
      await refreshContainerKubeconfigs();
    }

    try {
      // GET /api/links - Tool URLs (Tempo/Grafana/etc) for the current
      // tenant. The dashboard sends ?tenant=<name> in control-plane mode so
      // links resolve to the right tenant's ports.
      if (req.method === "GET" && url.pathname === "/api/v1/links") {
        const currentTenant = tenantFromRequest();
        let contextProject: string | null = null;
        if (currentTenant) {
          try {
            const raw = await fs.readFile("/blissful-home/context.json", "utf-8");
            const parsed = JSON.parse(raw) as { tenant?: string; project?: string };
            if (parsed.tenant === currentTenant) {
              contextProject = parsed.project ?? null;
            }
          } catch { /* no context */ }
        }
        // Look up host ports for the requested tenant so observability links
        // point at the right port block.
        let tenantPorts: { grafana?: number; prometheus?: number; tempo?: number; jenkins?: number; argocd?: number; gitea?: number } = {};
        if (currentTenant) {
          const t = await getTenant(currentTenant);
          if (t) tenantPorts = t.portBlock;
        }
        // A link is only a link if something answers it: ports are allocated
        // at tenant create, but Jenkins/observability only run after
        // `tenant up` and ArgoCD/Gitea only while the kind cluster is up.
        // Emitting URLs for absent containers gave the header dead buttons.
        let upContainers = new Set<string>();
        try {
          const { stdout } = await execa("docker", ["ps", "--format", "{{.Names}}"], { reject: false });
          upContainers = new Set(stdout.trim().split("\n").filter(Boolean));
        } catch { /* docker unavailable — no links */ }
        const containerUp = (name: string) => upContainers.has(name);
        const clusterUp = currentTenant ? containerUp(`blissful-${currentTenant}-control-plane`) : false;
        const grafanaUp = currentTenant ? containerUp(`${currentTenant}-grafana`) : false;

        const links: Record<string, string | null> = {
          // The dashboard's `links.clientName` badge predates the rename to
          // tenants; it carries the tenant name until the UI field is renamed.
          clientName: currentTenant,
          tenantName: currentTenant,
          projectName: contextProject,
          tempoUrl: grafanaUp && tenantPorts.grafana ? `http://localhost:${tenantPorts.grafana}/explore?left=${encodeURIComponent('{"datasource":"Tempo","queries":[{"refId":"A"}]}')}` : null,
          jaegerUrl: null,
          grafanaUrl: grafanaUp && tenantPorts.grafana ? `http://localhost:${tenantPorts.grafana}/d/tenant-overview` : null,
          prometheusUrl: currentTenant && containerUp(`${currentTenant}-prometheus`) && tenantPorts.prometheus ? `http://localhost:${tenantPorts.prometheus}` : null,
          jenkinsUrl: currentTenant && containerUp(`${currentTenant}-jenkins`) && tenantPorts.jenkins ? `http://localhost:${tenantPorts.jenkins}` : null,
          // Kubernetes runtime (ADR-0020) — live only while the cluster is.
          argocdUrl: clusterUp && tenantPorts.argocd ? `http://localhost:${tenantPorts.argocd}` : null,
          giteaUrl: clusterUp && tenantPorts.gitea ? `http://localhost:${tenantPorts.gitea}` : null,
          // Dev credentials, surfaced in the dashboard's connections card.
          // Everything here is local-only, fixed, dev-grade by design.
          argocdPassword: clusterUp && currentTenant ? await readArgoCDAdminPassword(currentTenant) : null,
          giteaUser: clusterUp ? "blissful" : null,
          giteaPassword: clusterUp ? "blissful-dev-pw" : null,
          gitopsRepo: clusterUp && currentTenant ? `blissful/${currentTenant}-gitops` : null,
          kubeContextName: clusterUp && currentTenant ? `kind-blissful-${currentTenant}` : null,
          grafanaUser: grafanaUp ? "admin" : null,
          grafanaPassword: grafanaUp ? "admin" : null,
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(links));
        return;
      }

      // Grafana proxy: /api/v1/grafana/* forwards to the tenant's Grafana instance
      const grafanaMatch = url.pathname.match(/^\/api\/v1\/grafana(\/.*)?$/);
      if (grafanaMatch) {
        const currentTenant = tenantFromRequest();
        if (!currentTenant) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "tenant query param required" }));
          return;
        }
        try {
          const tenant = await getTenant(currentTenant);
          if (!tenant) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Tenant not found" }));
            return;
          }

          // Check if Grafana is running
          let upContainers = new Set<string>();
          try {
            const { stdout } = await execa("docker", ["ps", "--format", "{{.Names}}"], { reject: false });
            upContainers = new Set(stdout.trim().split("\n").filter(Boolean));
          } catch { /* docker unavailable */ }

          const grafanaPort = tenant.portBlock.grafana;
          const grafanaUp = upContainers.has(`${currentTenant}-grafana`);

          if (!grafanaUp || !grafanaPort) {
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Grafana is not running" }));
            return;
          }

          const path = grafanaMatch[1] ?? "/";
          const target = `http://localhost:${grafanaPort}${path}${url.search}`;
          const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
          const upstream = await fetch(target, {
            method: req.method,
            headers: new Headers(
              Object.entries(req.headers)
                .filter(([k, v]) => !["host", "connection"].includes(k.toLowerCase()) && typeof v === "string")
                .map(([k, v]) => [k, v as string])
            ),
            body,
            signal: AbortSignal.timeout(30000),
          });
          const buf = Buffer.from(await upstream.arrayBuffer());
          const responseHeaders: Record<string, string> = {};
          upstream.headers.forEach((value, key) => {
            if (!["content-encoding", "transfer-encoding"].includes(key.toLowerCase())) {
              responseHeaders[key] = value;
            }
          });
          res.writeHead(upstream.status, responseHeaders);
          res.end(buf);
        } catch (e) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Could not reach Grafana", details: String(e) }));
        }
        return;
      }

      // GET /api/projects - List all projects in working directory
      if (req.method === "GET" && url.pathname === "/api/v1/projects") {
        const projects = await listProjects(workingDir, tenantFromRequest());
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ projects }));
        return;
      }

      // GET /api/projects/:name - Get specific project status
      const projectMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)$/);
      if (req.method === "GET" && projectMatch) {
        const projectName = projectMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());
        const status = await getProjectStatus(projectDir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(status));
        return;
      }

      // POST /api/projects - Create new project
      if (req.method === "POST" && url.pathname === "/api/v1/projects") {
        const body = await readBody(req);
        const { name, type, backend, frontend, plugins, autoStart } = JSON.parse(body);

        if (!name) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing service name" }));
          return;
        }

        // Tenant flow only (ADR-0017): tenant from env or ?tenant=, project
        // from context.json or the ?project= query param.
        const tenantForCreate = tenantFromRequest();
        if (!tenantForCreate) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "No tenant resolvable (set ?tenant= or TENANT_NAME)" }));
          return;
        }

        const result: { success: boolean; error?: string; project?: string } =
          await addServiceToTenant(tenantForCreate, {
            name,
            type: type || "backend",
            backend,
            frontend,
            plugins,
          });

        if (!result.success) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
          return;
        }
        // Auto-start: only in tenant mode (the other branches still own their
        // own lifecycle). Defaults to on; pass autoStart=false to skip.
        if (tenantForCreate && result.project && autoStart !== false) {
          const startResult = await startProjectCompose(tenantForCreate, result.project, name);
          res.writeHead(startResult.success ? 200 : 207, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ...result, ...startResult }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return;
      }

      // GET /api/v1/tenants — list every tenant in the registry with quick
      // status. Used by the dashboard's tenant-management drawer so the user
      // can see + clean up failed-create leftovers.
      if (req.method === "GET" && url.pathname === "/api/v1/tenants") {
        const summaries = await listAllTenantSummaries();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ tenants: summaries }));
        return;
      }

      // DELETE /api/v1/tenants/:name — remove a tenant entirely (down + dir
      // wipe + registry deregister). Same effect as `blissful-infra tenant
      // remove <name> --skip-prompts`. Refuses to delete the tenant the
      // dashboard itself is running inside (self-removal would orphan us).
      const tenantDeleteMatch = url.pathname.match(/^\/api\/v1\/tenants\/([^/]+)$/);
      if (req.method === "DELETE" && tenantDeleteMatch) {
        const name = tenantDeleteMatch[1];
        if (process.env.TENANT_NAME && name === process.env.TENANT_NAME) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Cannot remove tenant '${name}': dashboard is running inside it. Run on the host: blissful-infra tenant remove ${name}` }));
          return;
        }
        const result = await removeTenantViaCli(name);
        res.writeHead(result.success ? 200 : 400, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return;
      }

      // POST /api/v1/tenants — create a new tenant from the dashboard. Routes
      // through the CLI subprocess with --skip-prompts. Only works when the
      // dashboard has BLISSFUL_HOME mounted (which it does in tenant mode).
      // Pass `autoStart: true` (default) to also boot the tenant once
      // scaffolding succeeds. The response includes `dashboardUrl` and
      // `dashboardPort` when the start succeeds so the UI can deep link.
      if (req.method === "POST" && url.pathname === "/api/v1/tenants") {
        const body = await readBody(req);
        const { name, jenkins, prometheus, grafana, tempo, loki, autoStart } = JSON.parse(body) as {
          name?: string; jenkins?: boolean; prometheus?: boolean; grafana?: boolean;
          tempo?: boolean; loki?: boolean; autoStart?: boolean;
        };
        if (!name) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing tenant name" }));
          return;
        }
        const tenantResult = await createTenantViaCli(name, { jenkins, prometheus, grafana, tempo, loki });
        if (!tenantResult.success) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify(tenantResult));
          return;
        }
        if (autoStart === false) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ...tenantResult, started: false }));
          return;
        }
        const startResult = await startTenantViaCompose(name);
        res.writeHead(startResult.success ? 200 : 207, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ...tenantResult, ...startResult }));
        return;
      }

      // POST /api/v1/tenants/:name/up — boot a tenant that's already been
      // scaffolded. Exposed separately from create so the UI can retry a
      // failed start without re-creating the tenant.
      const tenantUpMatch = url.pathname.match(/^\/api\/v1\/tenants\/([^/]+)\/up$/);
      if (req.method === "POST" && tenantUpMatch) {
        const startResult = await startTenantViaCompose(tenantUpMatch[1]);
        res.writeHead(startResult.success ? 200 : 400, { "Content-Type": "application/json" });
        res.end(JSON.stringify(startResult));
        return;
      }

      // POST /api/v1/tenants/:tenant/projects — create a project inside a
      // tenant. Tenant in the path is just for routing clarity; we still
      // verify it matches the dashboard's TENANT_NAME for safety.
      const tenantProjectsMatch = url.pathname.match(/^\/api\/v1\/tenants\/([^/]+)\/projects$/);
      if (req.method === "POST" && tenantProjectsMatch) {
        const tenantArg = tenantProjectsMatch[1];
        if (process.env.TENANT_NAME && tenantArg !== process.env.TENANT_NAME) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Cross-tenant project creation denied" }));
          return;
        }
        const body = await readBody(req);
        const { name, kafka, postgres, redis, gateway, autoStart } = JSON.parse(body) as {
          name?: string; kafka?: boolean; postgres?: boolean; redis?: boolean; gateway?: boolean;
          autoStart?: boolean;
        };
        if (!name) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing project name" }));
          return;
        }
        const projectResult = await createProjectViaCli(tenantArg, name, { kafka, postgres, redis, gateway });
        if (!projectResult.success) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify(projectResult));
          return;
        }
        if (autoStart === false) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ...projectResult, started: false }));
          return;
        }
        const startResult = await startProjectCompose(tenantArg, name);
        res.writeHead(startResult.success ? 200 : 207, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ...projectResult, ...startResult }));
        return;
      }

      // POST /api/v1/tenants/:tenant/projects/:project/up — boot a scaffolded
      // project. Same as the create endpoint's auto-start branch but
      // standalone so the UI can retry after a failed start.
      const projectUpMatch = url.pathname.match(/^\/api\/v1\/tenants\/([^/]+)\/projects\/([^/]+)\/up$/);
      if (req.method === "POST" && projectUpMatch) {
        const startResult = await startProjectCompose(projectUpMatch[1], projectUpMatch[2]);
        res.writeHead(startResult.success ? 200 : 400, { "Content-Type": "application/json" });
        res.end(JSON.stringify(startResult));
        return;
      }

      // POST /api/v1/tenants/:tenant/projects/:project/services/:service/up
      // — boot just one service inside an already-scaffolded project.
      const serviceUpMatch = url.pathname.match(
        /^\/api\/v1\/tenants\/([^/]+)\/projects\/([^/]+)\/services\/([^/]+)\/up$/,
      );
      if (req.method === "POST" && serviceUpMatch) {
        const startResult = await startProjectCompose(serviceUpMatch[1], serviceUpMatch[2], serviceUpMatch[3]);
        res.writeHead(startResult.success ? 200 : 400, { "Content-Type": "application/json" });
        res.end(JSON.stringify(startResult));
        return;
      }

      // POST /api/projects/:name/up - Start project
      const upMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/up$/);
      if (req.method === "POST" && upMatch) {
        const projectName = upMatch[1];

        // Use the CLI's up command which generates docker-compose.yaml
        const cliPath = path.join(__dirname, "..", "index.js");
        try {
          await execa("node", [cliPath, "up", projectName], {
            cwd: workingDir,
            stdio: "pipe",
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        } catch (error) {
          const execaError = toExecError(error);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: false,
            error: execaError.stderr || execaError.message || "Failed to start project"
          }));
        }
        return;
      }

      // POST /api/projects/:name/down - Stop project
      const downMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/down$/);
      if (req.method === "POST" && downMatch) {
        const projectName = downMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());
        await execa("docker", ["compose", "down"], {
          cwd: projectDir,
          stdio: "pipe",
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // GET /api/projects/:name/logs - Get project logs
      const logsMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/logs$/);
      if (req.method === "GET" && logsMatch) {
        const projectName = logsMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());
        const logs = await collectDockerLogs(projectDir, { tail: 100 });

        // Persist logs to storage in background
        persistLogs(projectDir, logs).catch(() => {});

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ logs }));
        return;
      }

      // GET /api/projects/:name/logs/loki - Proxy to Loki query_range, returns LogEntry[]
      const lokiLogsMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/logs\/loki$/);
      if (req.method === "GET" && lokiLogsMatch) {
        const projectName = lokiLogsMatch[1];
        // Control-plane mode: Loki lives inside the *tenant's* network, so we
        // reach it via the host port. Legacy single-tenant mode shares the
        // network so `loki:3100` resolves directly.
        const queryTenantForLoki = url.searchParams.get("tenant");
        let lokiHost = DOCKER_MODE ? "loki" : "localhost";
        let lokiPort = 3100;
        if (DOCKER_MODE && queryTenantForLoki && !process.env.TENANT_NAME) {
          const t = await getTenant(queryTenantForLoki);
          if (t) {
            lokiHost = "host.docker.internal";
            lokiPort = t.portBlock.loki;
          }
        }
        const serviceFilter = url.searchParams.get("service");
        const textFilter = url.searchParams.get("filter");
        const levelFilter = url.searchParams.get("level");
        const limit = url.searchParams.get("limit") || "200";

        // In tenant mode (ADR-0017): Promtail labels are {tenant, project,
        // service} from the com.blissful.* compose labels. In legacy client
        // mode: there was no `project` label, just `service`. We adapt the
        // query shape based on what env we're running in.
        const currentTenantForLogs = tenantFromRequest();
        let logqlQuery: string;
        if (currentTenantForLogs) {
          const parts: string[] = [`tenant="${currentTenantForLogs}"`, `project="${projectName}"`];
          if (serviceFilter) parts.push(`service="${serviceFilter}"`);
          logqlQuery = `{${parts.join(", ")}}`;
        } else {
          logqlQuery = `{project="${projectName}"${serviceFilter ? `, service="${serviceFilter}"` : ""}}`;
        }
        // Push level filtering into LogQL so `limit` applies to matching
        // lines, not to total traffic. Without this, a chatty service can
        // exhaust the line budget before any error reaches the client.
        const levelPattern: Record<string, string> = {
          error: "(?i)error|exception|fatal|severe",
          warn: "(?i)warn",
          debug: "(?i)debug|trace",
        };
        if (levelFilter && levelPattern[levelFilter]) {
          logqlQuery += ` |~ \`${levelPattern[levelFilter]}\``;
        }
        if (textFilter) logqlQuery += ` |= \`${textFilter}\``;

        const nowNs = BigInt(Date.now()) * 1_000_000n;
        const startNs = nowNs - 3_600_000_000_000n; // 1 hour ago

        const lokiUrl = new URL(`http://${lokiHost}:${lokiPort}/loki/api/v1/query_range`);
        lokiUrl.searchParams.set("query", logqlQuery);
        lokiUrl.searchParams.set("limit", limit);
        lokiUrl.searchParams.set("start", startNs.toString());
        lokiUrl.searchParams.set("end", nowNs.toString());
        // Newest-first so a small `limit` keeps the most-recent N lines instead
        // of being drained by chatty services. We re-sort ascending below so
        // the UI still renders oldest→newest.
        lokiUrl.searchParams.set("direction", "backward");

        try {
          const lokiRes = await fetch(lokiUrl.toString(), { signal: AbortSignal.timeout(5000) });
          if (!lokiRes.ok) throw new Error(`Loki ${lokiRes.status}`);
          const data = await lokiRes.json() as { data?: { result?: Array<{ stream: Record<string, string>; values: [string, string][] }> } };
          const logs: Array<{ timestamp: string; service: string; message: string }> = [];
          for (const stream of data.data?.result ?? []) {
            const service = stream.stream?.service || stream.stream?.container || "unknown";
            for (const [ts, msg] of stream.values ?? []) {
              logs.push({ timestamp: new Date(Number(BigInt(ts) / 1_000_000n)).toISOString(), service, message: msg });
            }
          }
          logs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ logs, source: "loki" }));
        } catch {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ logs: [], source: "loki", error: "Loki unavailable" }));
        }
        return;
      }

      // GET /api/projects/:name/logs/loki/services - Available service labels from Loki
      const lokiServicesMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/logs\/loki\/services$/);
      if (req.method === "GET" && lokiServicesMatch) {
        const projectName = lokiServicesMatch[1];
        const currentTenantForLogs = tenantFromRequest();
        let lokiHost = DOCKER_MODE ? "loki" : "localhost";
        let lokiPort = 3100;
        if (DOCKER_MODE && currentTenantForLogs && !process.env.TENANT_NAME) {
          const t = await getTenant(currentTenantForLogs);
          if (t) {
            lokiHost = "host.docker.internal";
            lokiPort = t.portBlock.loki;
          }
        }
        try {
          const nowNs = BigInt(Date.now()) * 1_000_000n;
          const startNs = nowNs - 3_600_000_000_000n;
          const lokiUrl = new URL(`http://${lokiHost}:${lokiPort}/loki/api/v1/label/service/values`);
          // Match the relevant subset of logs so the dropdown only lists
          // services that actually have lines indexed in Loki.
          const scopeQuery = currentTenantForLogs
            ? `{tenant="${currentTenantForLogs}", project="${projectName}"}`
            : `{project="${projectName}"}`;
          lokiUrl.searchParams.set("query", scopeQuery);
          lokiUrl.searchParams.set("start", startNs.toString());
          lokiUrl.searchParams.set("end", nowNs.toString());
          const lokiRes = await fetch(lokiUrl.toString(), { signal: AbortSignal.timeout(3000) });
          const data = await lokiRes.json() as { data?: string[] };
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ services: data.data ?? [] }));
        } catch {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ services: [] }));
        }
        return;
      }

      // GET /api/projects/:name/logs/search - Search stored logs
      const logsSearchMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/logs\/search$/);
      if (req.method === "GET" && logsSearchMatch) {
        const projectName = logsSearchMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());

        const service = url.searchParams.get("service") || undefined;
        const level = url.searchParams.get("level") || undefined;
        const query = url.searchParams.get("q") || undefined;
        const startTime = url.searchParams.get("start") || undefined;
        const endTime = url.searchParams.get("end") || undefined;
        const limit = url.searchParams.get("limit")
          ? parseInt(url.searchParams.get("limit")!, 10)
          : 500;

        const logs = await searchLogs(projectDir, {
          service,
          level,
          query,
          startTime,
          endTime,
          limit,
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ logs, count: logs.length }));
        return;
      }

      // GET /api/projects/:name/logs/config - Get log retention config
      const logConfigMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/logs\/config$/);
      if (req.method === "GET" && logConfigMatch) {
        const projectName = logConfigMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());

        const config = await loadLogConfig(projectDir);
        const stats = await getLogStorageStats(projectDir);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ config, stats }));
        return;
      }

      // PUT /api/projects/:name/logs/config - Update log retention config
      const logConfigUpdateMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/logs\/config$/);
      if (req.method === "PUT" && logConfigUpdateMatch) {
        const projectName = logConfigUpdateMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());
        const body = await readBody(req);
        const config = JSON.parse(body) as LogRetentionConfig;

        await saveLogConfig(projectDir, config);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // POST /api/projects/:name/logs/rotate - Force log rotation
      const logRotateMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/logs\/rotate$/);
      if (req.method === "POST" && logRotateMatch) {
        const projectName = logRotateMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());

        await forceRotate(projectDir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // DELETE /api/projects/:name/logs/stored - Clear stored logs
      const logClearMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/logs\/stored$/);
      if (req.method === "DELETE" && logClearMatch) {
        const projectName = logClearMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());

        await clearLogs(projectDir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // POST /api/projects/:name/agent - Query agent for project
      const agentMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/agent$/);
      if (req.method === "POST" && agentMatch) {
        const projectName = agentMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());
        const body = await readBody(req);
        const { query, model: requestedModel, provider: requestedProvider } = JSON.parse(body);

        if (!query) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing query" }));
          return;
        }

        // In tenant mode, pass the tenant so the context collector can find
        // logs via docker labels (the dashboard container has no compose
        // dir on disk for the new tenant model).
        const agentTenant = tenantFromRequest();
        const response = await handleAgentQuery(
          projectDir,
          query,
          requestedModel,
          requestedProvider,
          agentTenant ? { tenant: agentTenant, project: projectName } : undefined,
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ response }));
        return;
      }

      // DELETE /api/projects/:name - Delete project
      const deleteMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)$/);
      if (req.method === "DELETE" && deleteMatch) {
        const projectName = deleteMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());

        // Stop containers first
        try {
          await execa("docker", ["compose", "down", "-v"], {
            cwd: projectDir,
            stdio: "pipe",
          });
        } catch {
          // Ignore errors if containers not running
        }

        // Remove directory
        await fs.rm(projectDir, { recursive: true, force: true });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // GET /api/templates - List available templates
      if (req.method === "GET" && url.pathname === "/api/v1/templates") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          types: ["fullstack", "backend", "frontend"],
          backends: ["spring-boot", "lambda-python"],
          frontends: ["react-vite"],
          databases: ["none", "postgres", "redis", "postgres-redis"],
        }));
        return;
      }

      // GET /api/projects/:name/metrics - Get container metrics
      const metricsMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/metrics$/);
      if (req.method === "GET" && metricsMatch) {
        const projectName = metricsMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());
        const metrics = await getContainerMetrics(projectDir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(metrics));
        return;
      }

      // GET /api/projects/:name/health - Get service health status
      const healthMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/health$/);
      if (req.method === "GET" && healthMatch) {
        const projectName = healthMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());
        const health = await checkServiceHealth(projectDir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(health));
        return;
      }

      // GET /api/projects/:name/plugins - Get plugin statuses with metadata
      const pluginsMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/plugins$/);
      if (req.method === "GET" && pluginsMatch) {
        const projectName = pluginsMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());
        const plugins = await getPluginStatuses(projectDir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(plugins));
        return;
      }

      // GET /api/projects/:name/metrics/history - Get historical metrics
      const historyMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/metrics\/history$/);
      if (req.method === "GET" && historyMatch) {
        const projectName = historyMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());

        // Parse query params
        const startTime = url.searchParams.get("start")
          ? parseInt(url.searchParams.get("start")!, 10)
          : Date.now() - 3600000; // Default: last hour
        const endTime = url.searchParams.get("end")
          ? parseInt(url.searchParams.get("end")!, 10)
          : Date.now();
        const limit = url.searchParams.get("limit")
          ? parseInt(url.searchParams.get("limit")!, 10)
          : 500;

        const metrics = await loadMetrics(projectDir, { startTime, endTime, limit });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ metrics, count: metrics.length }));
        return;
      }

      // GET /api/projects/:name/metrics/summary - Get aggregated metrics summary
      const summaryMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/metrics\/summary$/);
      if (req.method === "GET" && summaryMatch) {
        const projectName = summaryMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());

        const startTime = url.searchParams.get("start")
          ? parseInt(url.searchParams.get("start")!, 10)
          : undefined;
        const endTime = url.searchParams.get("end")
          ? parseInt(url.searchParams.get("end")!, 10)
          : undefined;

        const summary = await getMetricsSummary(projectDir, { startTime, endTime });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(summary));
        return;
      }

      // GET /api/projects/:name/metrics/storage - Get storage info
      const storageMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/metrics\/storage$/);
      if (req.method === "GET" && storageMatch) {
        const projectName = storageMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());

        const info = await getStorageInfo(projectDir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(info));
        return;
      }

      // POST /api/projects/:name/metrics/export - Export metrics to file
      const exportMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/metrics\/export$/);
      if (req.method === "POST" && exportMatch) {
        const projectName = exportMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());
        const body = await readBody(req);
        const { format = "json", start, end } = JSON.parse(body || "{}");

        const startTime = start ? parseInt(start, 10) : undefined;
        const endTime = end ? parseInt(end, 10) : undefined;

        // Generate export file path
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const outputDir = path.join(projectDir, ".blissful-infra", "exports");
        await fs.mkdir(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, `metrics-${timestamp}.${format}`);

        let count: number;
        if (format === "csv") {
          count = await exportMetricsToCsv(projectDir, outputPath, { startTime, endTime });
        } else {
          count = await exportMetricsToJson(projectDir, outputPath, { startTime, endTime });
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, path: outputPath, count, format }));
        return;
      }

      // DELETE /api/projects/:name/metrics - Clear metrics history
      const clearMetricsMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/metrics$/);
      if (req.method === "DELETE" && clearMetricsMatch) {
        const projectName = clearMetricsMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());

        await clearMetrics(projectDir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // GET /api/projects/:name/alerts - Get active alerts and config
      const alertsMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/alerts$/);
      if (req.method === "GET" && alertsMatch) {
        const projectName = alertsMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());

        await initializeAlerts(projectDir);
        const config = await loadAlertsConfig(projectDir);
        const activeAlerts = await getActiveAlerts(projectDir);
        const history = await getAlertHistory(projectDir, 20);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ config, activeAlerts, recentHistory: history }));
        return;
      }

      // PUT /api/projects/:name/alerts/config - Update alerts config
      const alertsConfigMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/alerts\/config$/);
      if (req.method === "PUT" && alertsConfigMatch) {
        const projectName = alertsConfigMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());
        const body = await readBody(req);
        const config = JSON.parse(body);

        await saveAlertsConfig(projectDir, config);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // POST /api/projects/:name/alerts/thresholds - Add new threshold
      const addThresholdMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/alerts\/thresholds$/);
      if (req.method === "POST" && addThresholdMatch) {
        const projectName = addThresholdMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());
        const body = await readBody(req);
        const thresholdData = JSON.parse(body) as Omit<AlertThreshold, "id">;

        const newThreshold = await addThreshold(projectDir, thresholdData);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, threshold: newThreshold }));
        return;
      }

      // PUT /api/projects/:name/alerts/thresholds/:id - Update threshold
      const updateThresholdMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/alerts\/thresholds\/([^/]+)$/);
      if (req.method === "PUT" && updateThresholdMatch) {
        const projectName = updateThresholdMatch[1];
        const thresholdId = updateThresholdMatch[2];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());
        const body = await readBody(req);
        const updates = JSON.parse(body);

        const success = await updateThreshold(projectDir, thresholdId, updates);
        res.writeHead(success ? 200 : 404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success }));
        return;
      }

      // DELETE /api/projects/:name/alerts/thresholds/:id - Delete threshold
      const deleteThresholdMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/alerts\/thresholds\/([^/]+)$/);
      if (req.method === "DELETE" && deleteThresholdMatch) {
        const projectName = deleteThresholdMatch[1];
        const thresholdId = deleteThresholdMatch[2];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());

        const success = await deleteThreshold(projectDir, thresholdId);
        res.writeHead(success ? 200 : 404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success }));
        return;
      }

      // POST /api/projects/:name/alerts/acknowledge - Acknowledge all active alerts
      const ackAlertsMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/alerts\/acknowledge$/);
      if (req.method === "POST" && ackAlertsMatch) {
        const projectName = ackAlertsMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());

        const count = await acknowledgeAlerts(projectDir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, acknowledged: count }));
        return;
      }

      // GET /api/models - List available AI models
      if (req.method === "GET" && url.pathname === "/api/v1/models") {
        const provider = await getProvider();
        const models = await listAllModels();
        const modelInfo = await getModelInfo();

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          available: provider !== null,
          provider,
          models: models.map(m => ({
            name: m.name,
            provider: m.provider,
            displayName: m.displayName,
          })),
          recommended: modelInfo ? { provider: modelInfo.provider, model: modelInfo.model } : null,
        }));
        return;
      }

      // Phase 2: Pipeline and Deployment Endpoints

      // GET /api/projects/:name/environments - List all environments
      const envsMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/environments$/);
      if (req.method === "GET" && envsMatch) {
        const projectName = envsMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());
        const environments = await getProjectEnvironments(projectDir, projectName, tenantFromRequest());
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ environments }));
        return;
      }

      // POST /api/projects/:name/deploy - Trigger deployment
      const deployMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/deploy$/);
      if (req.method === "POST" && deployMatch) {
        const projectName = deployMatch[1];
        const body = await readBody(req);
        const { tag } = JSON.parse(body || "{}");
        const deployTenant = tenantFromRequest();

        const cliPath = path.join(__dirname, "..", "index.js");
        try {
          const args = ["deploy", projectName];
          if (deployTenant) args.push("--tenant", deployTenant);
          if (tag) args.push("--tag", tag);

          await execa("node", [cliPath, ...args], {
            cwd: workingDir,
            stdio: "pipe",
          });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        } catch (error) {
          const execaError = toExecError(error);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: false,
            error: execaError.stderr || execaError.message || "Deployment failed"
          }));
        }
        return;
      }

      // POST /api/projects/:name/rollback - Trigger rollback
      // Preview proxy (kubernetes runtime): forwards to the service's
      // combined NodePort Service so the browser can open the deployed app
      // (and watch canary traffic mix across versions). From the dashboard
      // container the kind node is reachable by name on the kind network; on
      // the host the NodePort isn't published, so we fail with guidance.
      const previewMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/preview(\/.*)?$/);
      if (previewMatch) {
        const serviceName = previewMatch[1];
        // Sub-resources (./assets/*.js, ./vite.svg) are requested WITHOUT the
        // ?tenant= query param — relative URLs don't inherit query strings.
        // The first preview request stamps a path-scoped cookie; later ones
        // read it back. Falls through to context.json as a last resort.
        const cookieTenant = /(?:^|;\s*)blissful_preview_tenant=([^;]+)/
          .exec(req.headers.cookie ?? "")?.[1];
        const previewTenant = tenantFromRequest()
          ?? (cookieTenant ? decodeURIComponent(cookieTenant) : null)
          ?? await readContextTenant();
        const owning = previewTenant ? await findServiceProject(previewTenant, serviceName) : null;
        const nodePort = owning?.service.ports.http;
        if (!previewTenant || !owning || !nodePort) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `No previewable service '${serviceName}' (needs a tenant and an http port)` }));
          return;
        }
        const targetHost = DOCKER_MODE
          ? `blissful-${previewTenant}-control-plane`
          : "127.0.0.1";
        const rest = previewMatch[2] ?? "/";
        const query = url.search ? url.search.replace(/([?&])tenant=[^&]*&?/, "$1").replace(/[?&]$/, "") : "";
        const target = `http://${targetHost}:${nodePort}${rest}${query}`;
        try {
          const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
          const upstream = await fetch(target, {
            method: req.method,
            headers: { "content-type": req.headers["content-type"] ?? "application/octet-stream" },
            body,
            signal: AbortSignal.timeout(10000),
          });
          const contentType = upstream.headers.get("content-type") ?? "";
          const isHtml = contentType.includes("text/html");

          if (isHtml && req.method === "GET" && rest === "/") {
            // For HTML responses on the root path, wrap in iframe to fix React Router path issues.
            // When React loads, it will see the iframe's src URL as its location, not the preview proxy path.
            // Use localhost for the browser iframe even when in DOCKER_MODE, since NodePorts are published to the host.
            const iframeUrl = `http://localhost:${nodePort}/${query.replace(/^\?/, "")}`;
            const wrapperHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { margin: 0; overflow: hidden; }
    iframe { border: none; width: 100%; height: 100vh; display: block; }
  </style>
</head>
<body>
  <iframe src="${iframeUrl}" sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-presentation allow-top-navigation allow-top-navigation-by-user-activation"></iframe>
</body>
</html>`;
            res.writeHead(200, {
              "Content-Type": "text/html; charset=utf-8",
              "Set-Cookie": `blissful_preview_tenant=${encodeURIComponent(previewTenant)}; Path=/api/v1/projects/; SameSite=Lax`,
            });
            res.end(wrapperHtml);
          } else {
            const buf = Buffer.from(await upstream.arrayBuffer());
            res.writeHead(upstream.status, {
              "Content-Type": contentType,
              "Set-Cookie": `blissful_preview_tenant=${encodeURIComponent(previewTenant)}; Path=/api/v1/projects/; SameSite=Lax`,
            });
            res.end(buf);
          }
        } catch {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: `Could not reach ${serviceName} at ${target}`,
            hint: DOCKER_MODE
              ? "Is the service deployed and its pods Ready? (blissful-infra canary status)"
              : `NodePorts aren't published to the host. Use the containerized dashboard, or: kubectl --context kind-blissful-${previewTenant} -n ${owning.project} port-forward svc/${serviceName} 8080:8080`,
          }));
        }
        return;
      }

      // Canary rollout endpoints (kubernetes runtime). :name is the service;
      // the owning project (= namespace) resolves through the registry.
      const canaryStatusMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/canary$/);
      if (req.method === "GET" && canaryStatusMatch) {
        const serviceName = canaryStatusMatch[1];
        const canaryTenant = tenantFromRequest();
        const owning = canaryTenant ? await findServiceProject(canaryTenant, serviceName) : null;
        if (!owning) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ canary: null }));
          return;
        }
        const { getRolloutStatus } = await import("../utils/rollouts.js");
        const status = await getRolloutStatus(serviceName, owning.project, kubeContext(canaryTenant!));
        const canary: CanaryStatus | null = status ? {
          service: serviceName,
          project: owning.project,
          status: status.status,
          step: status.step,
          totalSteps: status.totalSteps,
          currentWeight: status.currentWeight,
          message: status.message,
        } : null;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ canary }));
        return;
      }

      const canaryActionMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/canary\/([^/]+)$/);
      if (req.method === "POST" && canaryActionMatch) {
        const serviceName = canaryActionMatch[1];
        const parsedAction = CanaryActionSchema.safeParse(canaryActionMatch[2]);
        if (!parsedAction.success) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Unknown canary action '${canaryActionMatch[2]}'` }));
          return;
        }
        const canaryTenant = tenantFromRequest();
        const owning = canaryTenant ? await findServiceProject(canaryTenant, serviceName) : null;
        if (!owning) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Service '${serviceName}' not found in tenant` }));
          return;
        }
        const rollouts = await import("../utils/rollouts.js");
        const namespace = owning.project;
        const ctx = kubeContext(canaryTenant!);
        const ok = await ({
          "promote":      () => rollouts.promoteRollout(serviceName, namespace, false, ctx),
          "promote-full": () => rollouts.promoteRollout(serviceName, namespace, true, ctx),
          "abort":        () => rollouts.abortRollout(serviceName, namespace, ctx),
          "pause":        () => rollouts.pauseRollout(serviceName, namespace, ctx),
          "resume":       () => rollouts.resumeRollout(serviceName, namespace, ctx),
        }[parsedAction.data])();
        res.writeHead(ok ? 200 : 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: ok }));
        return;
      }

      const rollbackMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/rollback$/);
      if (req.method === "POST" && rollbackMatch) {
        const projectName = rollbackMatch[1];
        const body = await readBody(req);
        const { revision } = JSON.parse(body || "{}");
        const rollbackTenant = tenantFromRequest();

        const cliPath = path.join(__dirname, "..", "index.js");
        try {
          const args = ["rollback", projectName];
          if (rollbackTenant) args.push("--tenant", rollbackTenant);
          if (revision) args.push("--revision", revision);

          await execa("node", [cliPath, ...args], {
            cwd: workingDir,
            stdio: "pipe",
          });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        } catch (error) {
          const execaError = toExecError(error);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: false,
            error: execaError.stderr || execaError.message || "Rollback failed"
          }));
        }
        return;
      }

      // GET /api/projects/:name/pipeline - Get pipeline status
      const pipelineMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/pipeline$/);
      if (req.method === "GET" && pipelineMatch) {
        const projectName = pipelineMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());
        const pipelineStatus = await getPipelineStatus(projectDir, projectName);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(pipelineStatus));
        return;
      }

      // POST /api/projects/:name/pipeline - Run pipeline locally
      const pipelineRunMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/pipeline$/);
      if (req.method === "POST" && pipelineRunMatch) {
        const projectName = pipelineRunMatch[1];
        const body = await readBody(req);
        const { push = false, skipTests = false, skipScan = false } = JSON.parse(body || "{}");

        const cliPath = path.join(__dirname, "..", "index.js");
        try {
          const args = ["pipeline", projectName, "--local"];
          if (push) args.push("--push");
          if (skipTests) args.push("--skip-tests");
          if (skipScan) args.push("--skip-scan");

          await execa("node", [cliPath, ...args], {
            cwd: workingDir,
            stdio: "pipe",
          });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        } catch (error) {
          const execaError = toExecError(error);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: false,
            error: execaError.stderr || execaError.message || "Pipeline failed"
          }));
        }
        return;
      }

      // POST /api/projects/:name/perf/gatling/run - Start a Gatling load test
      const gatlingRunMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/perf\/gatling\/run$/);
      if (req.method === "POST" && gatlingRunMatch) {
        const projectName = gatlingRunMatch[1];
        const existing = gatlingJobs.get(projectName);
        if (existing?.status === "running") {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Load test already running" }));
          return;
        }

        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());
        const gatlingDir = path.join(projectDir, "gatling");
        const job: GatlingJob = { status: "running", startedAt: Date.now(), logLines: [] };
        gatlingJobs.set(projectName, job);

        const gradleCmd = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
        const child = execa(gradleCmd, ["gatlingRun", "--no-daemon"], {
          cwd: gatlingDir,
          stdio: "pipe",
          reject: false,
        });

        const appendLine = (line: string) => {
          job.logLines.push(line);
          if (job.logLines.length > 500) job.logLines.shift();
        };

        child.stdout?.on("data", (chunk: Buffer) =>
          chunk.toString().split("\n").filter(Boolean).forEach(appendLine)
        );
        child.stderr?.on("data", (chunk: Buffer) =>
          chunk.toString().split("\n").filter(Boolean).forEach(appendLine)
        );

        child.then((result) => {
          job.status = result.exitCode === 0 ? "completed" : "error";
          job.exitCode = result.exitCode ?? undefined;
          job.completedAt = Date.now();
        }).catch(() => {
          job.status = "error";
          job.completedAt = Date.now();
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ started: true }));
        return;
      }

      // GET /api/projects/:name/perf/gatling/status
      const gatlingStatusMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/perf\/gatling\/status$/);
      if (req.method === "GET" && gatlingStatusMatch) {
        const projectName = gatlingStatusMatch[1];
        const job = gatlingJobs.get(projectName);
        if (!job) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "idle" }));
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            status: job.status,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
            exitCode: job.exitCode,
          }));
        }
        return;
      }

      // GET /api/projects/:name/perf/gatling/log
      const gatlingLogMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/perf\/gatling\/log$/);
      if (req.method === "GET" && gatlingLogMatch) {
        const projectName = gatlingLogMatch[1];
        const job = gatlingJobs.get(projectName);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          lines: job ? job.logLines.slice(-100) : [],
          running: job?.status === "running",
        }));
        return;
      }

      // GET /api/projects/:name/perf/gatling/results
      const gatlingResultsMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/perf\/gatling\/results$/);
      if (req.method === "GET" && gatlingResultsMatch) {
        const projectName = gatlingResultsMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());
        const reportsDir = path.join(projectDir, "gatling", "build", "reports", "gatling");
        try {
          const runs = await fs.readdir(reportsDir);
          if (runs.length === 0) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "No Gatling results found" }));
            return;
          }
          // Find most recent run by mtime
          const withStats = await Promise.all(
            runs.map(async (r) => ({
              name: r,
              mtime: (await fs.stat(path.join(reportsDir, r))).mtimeMs,
            }))
          );
          withStats.sort((a, b) => b.mtime - a.mtime);
          const statsFile = path.join(reportsDir, withStats[0].name, "js", "stats.json");
          const raw = JSON.parse(await fs.readFile(statsFile, "utf8"));
          const s = raw.stats ?? raw;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            requests: s.numberOfRequests?.total ?? 0,
            requestsOk: s.numberOfRequests?.ok ?? 0,
            requestsFailed: s.numberOfRequests?.ko ?? 0,
            minMs: s.minResponseTime?.total ?? 0,
            maxMs: s.maxResponseTime?.total ?? 0,
            meanMs: s.meanResponseTime?.total ?? 0,
            p50Ms: s.percentiles1?.total ?? 0,
            p75Ms: s.percentiles2?.total ?? 0,
            p95Ms: s.percentiles3?.total ?? 0,
            p99Ms: s.percentiles4?.total ?? 0,
            rps: s.meanNumberOfRequestsPerSecond?.total ?? 0,
            errorRate: s.numberOfRequests?.total
              ? (s.numberOfRequests.ko / s.numberOfRequests.total) * 100
              : 0,
          }));
        } catch {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "No Gatling results found" }));
        }
        return;
      }

      // GET /api/projects/:name/deployments - List deployment records
      const deploymentsMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/deployments$/);
      if (req.method === "GET" && deploymentsMatch) {
        const projectName = deploymentsMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());
        const limit = url.searchParams.get("limit")
          ? parseInt(url.searchParams.get("limit")!, 10)
          : 50;
        const deployments = await loadDeployments(projectDir, limit);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ deployments }));
        return;
      }

      // POST /api/projects/:name/deployments - Create deployment record
      if (req.method === "POST" && deploymentsMatch) {
        const projectName = deploymentsMatch[1];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());
        const body = await readBody(req);
        const parsed = CreateDeploymentRequestSchema.safeParse(JSON.parse(body || "{}"));
        if (!parsed.success) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid request", details: parsed.error.flatten() }));
          return;
        }
        const { gitSha, status = "running" } = parsed.data;

        const now = Date.now();
        const id = `deploy-${now}`;
        const latencyBefore = await queryPrometheusP95(projectName);
        const jaegerTraceUrl = buildJaegerTraceUrl(now - 5 * 60 * 1000, now);

        const record: DeploymentRecord = {
          id,
          timestamp: now,
          projectName,
          gitSha,
          status,
          regression: false,
          ...(latencyBefore !== null ? { latencyBefore } : {}),
          jaegerTraceUrl,
        };

        await saveDeployment(projectDir, record);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(record));
        return;
      }

      // PATCH /api/projects/:name/deployments/:id - Update deployment record
      const deploymentByIdMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/deployments\/([^/]+)$/);
      if (req.method === "PATCH" && deploymentByIdMatch) {
        const projectName = deploymentByIdMatch[1];
        const deploymentId = deploymentByIdMatch[2];
        const projectDir = await resolveProjectDir(workingDir, projectName, tenantFromRequest());
        const body = await readBody(req);
        const parsed = UpdateDeploymentRequestSchema.safeParse(JSON.parse(body || "{}"));
        if (!parsed.success) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid request", details: parsed.error.flatten() }));
          return;
        }
        const { status, latencyAfter } = parsed.data;

        // Load existing record to compute delta
        const deployments = await loadDeployments(projectDir, 200);
        const existing = deployments.find((d) => d.id === deploymentId);

        const updates: Partial<DeploymentRecord> = {};
        if (status !== undefined) updates.status = status;
        if (latencyAfter !== undefined) {
          updates.latencyAfter = latencyAfter;
          if (existing?.latencyBefore !== undefined && existing.latencyBefore > 0) {
            const delta = latencyAfter - existing.latencyBefore;
            updates.latencyDelta = delta;
            updates.regression = delta / existing.latencyBefore > 0.2;
          } else {
            updates.latencyDelta = undefined;
            updates.regression = false;
          }
          // Build Jaeger URL for the deploy window
          if (existing) {
            updates.jaegerTraceUrl = buildJaegerTraceUrl(existing.timestamp, Date.now());
          }
        }

        const found = await updateDeployment(projectDir, deploymentId, updates);
        if (!found) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Deployment not found" }));
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // GET /api/v1/client/infra - Aggregate infra health for the current
      // tenant (or legacy client). Returns infra components (dashboard,
      // jenkins, prometheus, grafana, tempo, loki at the tenant level;
      // kafka, postgres, gateway per project) with live container status.
      if (req.method === "GET" && url.pathname === "/api/v1/client/infra") {
        const tenantName = tenantFromRequest();
        if (tenantName) {
          const infra = await collectTenantInfraStatus(tenantName);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ client: tenantName, infra }));
          return;
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No tenant resolvable (set ?tenant= or TENANT_NAME)" }));
        return;
      }

      // ── Ontology endpoints (tenant model, ADR-0017) ────────────────────
      // The path param is the tenant name. When the server is bound to a
      // tenant (TENANT_NAME), cross-tenant access is denied; in control-plane
      // mode any registered tenant is reachable. The live graph is derived
      // from the registry on every GET; user positions and hand-drawn edges
      // overlay from ~/.blissful-infra/tenants/<tenant>/ontology.json.
      const resolveOntologyTenant = async (name: string): Promise<string | null> => {
        const bound = process.env.TENANT_NAME;
        if (bound) return name === bound ? name : null;
        return (await getTenant(name)) ? name : null;
      };

      const ontologyGetMatch = url.pathname.match(/^\/api\/v1\/ontology\/([^/]+)$/);
      if (req.method === "GET" && ontologyGetMatch) {
        const tenant = await resolveOntologyTenant(ontologyGetMatch[1]);
        if (!tenant) {
          res.writeHead(process.env.TENANT_NAME ? 403 : 404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unknown or inaccessible tenant" }));
          return;
        }
        const graph = await buildTenantOntology(tenant);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(graph));
        return;
      }

      if (req.method === "PUT" && ontologyGetMatch) {
        const tenant = await resolveOntologyTenant(ontologyGetMatch[1]);
        if (!tenant) {
          res.writeHead(process.env.TENANT_NAME ? 403 : 404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unknown or inaccessible tenant" }));
          return;
        }
        const body = await readBody(req);
        await saveOntology(tenant, JSON.parse(body));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      const ontologyConfigMatch = url.pathname.match(/^\/api\/v1\/ontology\/([^/]+)\/nodes\/([^/]+)\/config$/);
      if (req.method === "GET" && ontologyConfigMatch) {
        const tenant = await resolveOntologyTenant(ontologyConfigMatch[1]);
        if (!tenant) {
          res.writeHead(process.env.TENANT_NAME ? 403 : 404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unknown or inaccessible tenant" }));
          return;
        }
        try {
          const config = await getNodeConfig(tenant, decodeURIComponent(ontologyConfigMatch[2]));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(config));
        } catch (error) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: toExecError(error).message }));
        }
        return;
      }

      if (req.method === "PUT" && ontologyConfigMatch) {
        const tenant = await resolveOntologyTenant(ontologyConfigMatch[1]);
        if (!tenant) {
          res.writeHead(process.env.TENANT_NAME ? 403 : 404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unknown or inaccessible tenant" }));
          return;
        }
        const body = await readBody(req);
        const { content } = JSON.parse(body);
        await setNodeConfig(tenant, decodeURIComponent(ontologyConfigMatch[2]), content);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      const ontologyWireMatch = url.pathname.match(/^\/api\/v1\/ontology\/([^/]+)\/edges\/([^/]+)\/wire$/);
      if (req.method === "POST" && ontologyWireMatch) {
        const tenant = await resolveOntologyTenant(ontologyWireMatch[1]);
        if (!tenant) {
          res.writeHead(process.env.TENANT_NAME ? 403 : 404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unknown or inaccessible tenant" }));
          return;
        }
        const saved = await loadSavedOntology(tenant);
        const edgeId = decodeURIComponent(ontologyWireMatch[2]);
        const edge = saved?.edges.find(e => e.id === edgeId);
        if (!saved || !edge) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Edge not found (only saved, hand-drawn edges can be wired)" }));
          return;
        }
        try {
          const result = await wireEdge(tenant, edge);
          const updated = { ...saved, edges: saved.edges.map(e => e.id === result.edge.id ? result.edge : e) };
          await saveOntology(tenant, updated);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ...result.edge, codegen: { written: result.written, warnings: result.warnings } }));
        } catch (error) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: toExecError(error).message }));
        }
        return;
      }

      // Static file serving for dashboard (Docker/production mode)
      const dashboardDistDir = process.env.DASHBOARD_DIST_DIR;
      if (dashboardDistDir && !url.pathname.startsWith("/api/v1/")) {
        const safePath = path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
        const filePath = path.join(dashboardDistDir, safePath === "/" ? "index.html" : safePath);

        try {
          const fileStat = await fs.stat(filePath);
          if (fileStat.isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            res.writeHead(200, {
              "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
              "Content-Length": fileStat.size,
            });
            createReadStream(filePath).pipe(res);
            return;
          }
        } catch {
          // File not found, fall through to SPA handler
        }

        // SPA fallback: serve index.html for client-side routing
        const indexPath = path.join(dashboardDistDir, "index.html");
        try {
          const indexStat = await fs.stat(indexPath);
          res.writeHead(200, {
            "Content-Type": "text/html",
            "Content-Length": indexStat.size,
          });
          createReadStream(indexPath).pipe(res);
          return;
        } catch {
          // index.html not found
        }
      }

      // 404 for unknown routes
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    } catch (error) {
      console.error("API error:", error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Internal server error",
        })
      );
    }
  });

  // Web terminal — opt-in. Only wired up inside the dashboard container
  // (DOCKER_MODE) where /var/run/docker.sock and the blissful CLI are
  // available. Host-side `blissful-infra dashboard` foreground runs are
  // legacy and don't need a browser shell.
  if (process.env.DOCKER_MODE === "true") {
    void import("./terminal.js").then(({ attachTerminalWebSocket }) => {
      attachTerminalWebSocket(server);
    }).catch(err => {
      console.error("Failed to attach terminal WebSocket:", err);
    });
  }

  return {
    start: () => {
      return new Promise<void>((resolve) => {
        server.listen(port, () => {
          resolve();
        });
      });
    },
    stop: () => {
      return new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
    port,
  };
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      resolve(body);
    });
    req.on("error", reject);
  });
}

/**
 * Query Prometheus for the P95 HTTP latency over the last 5 minutes.
 * Returns the value in milliseconds, or null on failure.
 */
async function queryPrometheusP95(projectName: string): Promise<number | null> {
  const prometheusHost = DOCKER_MODE ? "prometheus" : "localhost";
  const prometheusUrl = `http://${prometheusHost}:9090/api/v1/query`;
  const query = `histogram_quantile(0.95, rate(http_server_requests_seconds_bucket{job="${projectName}"}[5m]))`;

  try {
    const url = new URL(prometheusUrl);
    url.searchParams.set("query", query);
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json() as {
      data?: { result?: Array<{ value: [number, string] }> };
    };
    const result = data.data?.result;
    if (!result || result.length === 0) return null;
    const valueStr = result[0].value?.[1];
    if (!valueStr || valueStr === "NaN") return null;
    const seconds = parseFloat(valueStr);
    if (isNaN(seconds)) return null;
    return seconds * 1000; // convert to milliseconds
  } catch {
    return null;
  }
}

/**
 * Build a trace-explorer URL for a given time window. ADR-0016 swapped
 * Jaeger for Tempo; traces now live behind Grafana's Explore tab pointed
 * at the Tempo datasource. The function name keeps `Jaeger` for back-compat
 * with the deployment-record field (`jaegerTraceUrl`), which is on disk in
 * existing JSONL files and would be a separate migration to rename.
 */
function buildJaegerTraceUrl(startMs: number, endMs: number): string {
  const grafanaBase = process.env.GRAFANA_URL ?? "http://localhost:3001";
  const exploreState = encodeURIComponent(JSON.stringify({
    datasource: "tempo",
    queries: [{ refId: "A", queryType: "traceqlSearch", filters: [{ id: "service-name", tag: "service.name", operator: "=", scope: "resource", value: "backend" }] }],
    range: { from: String(startMs), to: String(endMs) },
  }));
  return `${grafanaBase}/explore?left=${exploreState}`;
}

/**
 * Resolve the on-disk directory for a project/service URL parameter.
 *
 * Every endpoint that takes `:name` from a `/api/v1/projects/:name/...` route
 * MUST use this helper instead of `path.join(workingDir, name)` directly.
 * With a tenant, `:name` is a service name — the registry is scanned for the
 * owning project and the service dir is returned
 * (~/.blissful-infra/tenants/<t>/projects/<p>/services/<name>). Without one,
 * fall back to a plain join under workingDir.
 */
// Exported for testing.
export async function resolveProjectDir(
  workingDir: string,
  name: string,
  tenant?: string | null,
): Promise<string> {
  if (tenant) {
    const found = await findServiceProject(tenant, name);
    if (found) return getServiceDir(tenant, found.project, name);
  }
  return path.join(workingDir, name);
}

async function listProjects(workingDir: string, currentTenant?: string | null): Promise<ProjectStatus[]> {
  // Tenant mode (ADR-0017): registry lives at /blissful-home/registry.json
  // (mounted into the container). Each project in the tenant becomes one
  // sidebar item with its services listed underneath. `currentTenant` lets
  // the control-plane dashboard scope to a tenant via ?tenant=<name>.
  const tenantName = currentTenant ?? process.env.TENANT_NAME;
  if (tenantName) {
    return listTenantProjects(tenantName);
  }
  // No tenant resolvable — nothing to list in the tenant model.
  return [];
}

/**
 * Tenant-mode listing for the new ADR-0017 hierarchy. Reads the registry
 * (mounted at /blissful-home) and returns one ProjectStatus entry per project
 * in the tenant. Each project's `services` field lists its services with
 * live container status.
 *
 * This shape-preserves the legacy `/api/v1/projects` response so the existing
 * dashboard sidebar renders the new model without UI changes. Phase 7b will
 * do the proper 3-level tree view.
 */
async function refreshContainerKubeconfigs(): Promise<void> {
  try {
    const home = process.env.BLISSFUL_HOME ?? "/blissful-home";
    const tenantsDir = path.join(home, "tenants");
    const files: string[] = [];
    for (const entry of await fs.readdir(tenantsDir)) {
      const f = path.join(tenantsDir, entry, "cluster", "kubeconfig-internal");
      try {
        await fs.access(f);
        files.push(f);
      } catch { /* tenant has no cluster */ }
    }
    if (files.length > 0) {
      process.env.KUBECONFIG = files.join(":");
    }
  } catch { /* no tenants dir yet */ }
}

/** Tenant from the CLI's `use` context — last-resort preview resolution. */
async function readContextTenant(): Promise<string | null> {
  try {
    const home = process.env.BLISSFUL_HOME ?? "/blissful-home";
    const raw = await fs.readFile(path.join(home, "context.json"), "utf-8");
    return (JSON.parse(raw) as { tenant?: string }).tenant ?? null;
  } catch {
    return null;
  }
}

const argocdPasswordCache = new Map<string, { value: string | null; at: number }>();

/** ArgoCD's generated admin password, from the cluster secret. Cached 60s. */
async function readArgoCDAdminPassword(tenant: string): Promise<string | null> {
  const cached = argocdPasswordCache.get(tenant);
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  let value: string | null = null;
  try {
    const { stdout } = await execa("kubectl", [
      "--context", kubeContext(tenant),
      "-n", "argocd", "get", "secret", "argocd-initial-admin-secret",
      "-o", "jsonpath={.data.password}",
    ], { stdio: "pipe", timeout: 8000 });
    value = stdout ? Buffer.from(stdout, "base64").toString("utf-8") : null;
  } catch { /* cluster not reachable */ }
  argocdPasswordCache.set(tenant, { value, at: Date.now() });
  return value;
}

async function listTenantProjects(tenantName: string): Promise<ProjectStatus[]> {
  // Read the registry directly (no CLI subprocess). BLISSFUL_HOME is set on
  // the dashboard container to point at the mounted host registry.
  const registryPath = path.join(process.env.BLISSFUL_HOME ?? "/blissful-home", "registry.json");
  let registry: { tenants?: Array<{
    name: string;
    projects: Array<{
      name: string;
      portBlock: { kafka: number; postgres: number; redis?: number; gateway: number };
      services: Array<{ name: string; type: string; ports: { http?: number } }>;
    }>;
  }> };
  try {
    registry = JSON.parse(await fs.readFile(registryPath, "utf-8"));
  } catch {
    return [];
  }

  const tenant = registry.tenants?.find(t => t.name === tenantName);
  if (!tenant) return [];

  // One `docker ps` call gets everything in this tenant's project namespaces
  let containers: { name: string; state: string }[] = [];
  try {
    const { stdout } = await execa("docker", [
      "ps", "-a", "--no-trunc",
      "--filter", `name=${tenantName}-`,
      "--format", "{{.Names}}|{{.State}}",
    ], { reject: false });
    containers = stdout.trim().split("\n").filter(Boolean).map(line => {
      const [name, state] = line.split("|");
      return { name, state };
    });
  } catch { /* docker unavailable */ }

  // Kubernetes-runtime projects run as pods inside the kind node, so their
  // containers never appear in the host's docker ps — derive their status
  // from pod readiness instead (one kubectl call per k8s project).
  const projectRuntimes = new Map<string, string>();
  for (const p of tenant.projects) {
    projectRuntimes.set(p.name, await readProjectRuntime(tenantName, p.name));
  }

  const k8sStatuses = new Map<string, Map<string, "running" | "starting" | "stopped">>();
  for (const p of tenant.projects) {
    if (projectRuntimes.get(p.name) !== "kubernetes") continue;
    const svcStatuses = new Map<string, "running" | "starting" | "stopped">();
    try {
      const { stdout } = await execa("kubectl", [
        "--context", kubeContext(tenantName), "get", "pods", "-n", p.name, "-o", "json",
      ], { stdio: "pipe", timeout: 8000 });
      const pods = (JSON.parse(stdout).items ?? []) as Array<{
        metadata?: { labels?: Record<string, string> };
        status?: { phase?: string; containerStatuses?: Array<{ ready?: boolean }> };
      }>;
      for (const s of p.services) {
        const own = pods.filter(pod => pod.metadata?.labels?.app === s.name);
        if (own.length === 0) {
          svcStatuses.set(s.name, "stopped");
        } else {
          const anyReady = own.some(pod =>
            pod.status?.phase === "Running" &&
            (pod.status?.containerStatuses ?? []).some(cs => cs.ready));
          svcStatuses.set(s.name, anyReady ? "running" : "starting");
        }
      }
    } catch {
      // Cluster unreachable (not provisioned / docker down) — pods can't be
      // running, report stopped rather than lying with docker-ps state.
      for (const s of p.services) svcStatuses.set(s.name, "stopped");
    }
    k8sStatuses.set(p.name, svcStatuses);
  }

  // Per-service scaffold details (template, DB schema) come from each
  // service.yaml — best-effort, absent fields just hide their UI rows.
  const serviceDetails = new Map<string, { template?: string; dbSchema?: string }>();
  await Promise.all(tenant.projects.flatMap(p => p.services.map(async s => {
    try {
      const cfg = await readServiceConfig(tenantName, p.name, s.name);
      serviceDetails.set(`${p.name}/${s.name}`, {
        template: cfg.backend?.template ?? cfg.frontend?.template ?? (cfg.worker ? `worker-${cfg.worker.runtime}` : undefined),
        dbSchema: cfg.database?.schema,
      });
    } catch { /* unreadable service.yaml */ }
  })));

  return tenant.projects.map(p => {
    const runtime = (projectRuntimes.get(p.name) ?? "compose") as "compose" | "kubernetes";
    // Service-level statuses + connection details
    const k8s = k8sStatuses.get(p.name);
    const services = p.services.map(s => {
      const details = serviceDetails.get(`${p.name}/${s.name}`) ?? {};
      const url = runtime === "kubernetes"
        ? `/api/v1/projects/${s.name}/preview/`
        : s.ports.http ? `http://localhost:${s.ports.http}` : undefined;
      const base = {
        name: s.name,
        port: s.ports.http,
        serviceType: s.type,
        template: details.template,
        dbSchema: runtime === "compose" ? details.dbSchema : undefined,
        url,
      };
      if (k8s) {
        return { ...base, status: k8s.get(s.name) ?? "stopped" };
      }
      const cName = `${tenantName}-${p.name}-${s.name}`;
      const c = containers.find(x => x.name === cName);
      const status: "running" | "stopped" | "starting" | "unhealthy" =
        c?.state === "running" ? "running"
        : c ? "stopped"
        : "stopped";
      return { ...base, status };
    });

    // Project-level rollup: running if ANY service container is running
    const anyRunning = services.some(s => s.status === "running");
    const allStopped = services.every(s => s.status === "stopped");
    const status: "running" | "stopped" | "unknown" =
      services.length === 0 ? "unknown" : anyRunning ? "running" : allStopped ? "stopped" : "unknown";

    return {
      name: p.name,
      path: `tenants/${tenantName}/projects/${p.name}`,
      status,
      type: "project",
      runtime,
      infra: runtime === "compose" ? {
        kafka: p.portBlock.kafka,
        postgres: p.portBlock.postgres,
        redis: p.portBlock.redis,
        gateway: p.portBlock.gateway,
      } : undefined,
      services,
    };
  });
}

/**
 * Collect every infrastructure container in a tenant — both tenant-level
 * (dashboard, jenkins, observability) and project-level (kafka, postgres,
 * gateway, per project) — annotated with live docker status. Used by the
 * Client Overview view in the dashboard.
 */
async function collectTenantInfraStatus(tenantName: string): Promise<Array<{
  id: string;
  type: string;
  label: string;
  port?: number;
  status: "running" | "stopped" | "unknown";
}>> {
  const registryPath = path.join(process.env.BLISSFUL_HOME ?? "/blissful-home", "registry.json");
  let tenant: {
    portBlock: { dashboard: number; jenkins: number; grafana: number; prometheus: number; tempo: number; loki: number; blockIndex: number };
    projects: Array<{
      name: string;
      portBlock: { kafka: number; postgres: number; gateway: number };
    }>;
  } | undefined;
  try {
    const raw = JSON.parse(await fs.readFile(registryPath, "utf-8")) as {
      tenants?: Array<{
        name: string;
        portBlock: { dashboard: number; jenkins: number; grafana: number; prometheus: number; tempo: number; loki: number; blockIndex: number };
        projects: Array<{ name: string; portBlock: { kafka: number; postgres: number; gateway: number } }>;
      }>;
    };
    tenant = raw.tenants?.find(t => t.name === tenantName);
  } catch { /* no registry */ }
  if (!tenant) return [];

  // One docker ps call for all tenant-prefixed containers
  let containers: { name: string; state: string }[] = [];
  try {
    const { stdout } = await execa("docker", [
      "ps", "-a", "--no-trunc",
      "--filter", `name=${tenantName}-`,
      "--format", "{{.Names}}|{{.State}}",
    ], { reject: false });
    containers = stdout.trim().split("\n").filter(Boolean).map(line => {
      const [name, state] = line.split("|");
      return { name, state };
    });
  } catch { /* docker unavailable */ }

  const statusOf = (containerName: string): "running" | "stopped" | "unknown" => {
    const c = containers.find(x => x.name === containerName);
    if (!c) return "unknown";
    return c.state === "running" ? "running" : "stopped";
  };

  const infra: Array<{ id: string; type: string; label: string; port?: number; status: "running" | "stopped" | "unknown" }> = [];

  // Tenant-level
  infra.push({ id: "tenant:dashboard",  type: "dashboard",  label: "Dashboard",  port: tenant.portBlock.dashboard,  status: statusOf(`${tenantName}-dashboard`) });
  infra.push({ id: "tenant:jenkins",    type: "jenkins",    label: "Jenkins",    port: tenant.portBlock.jenkins,    status: statusOf(`${tenantName}-jenkins`) });
  infra.push({ id: "tenant:prometheus", type: "prometheus", label: "Prometheus", port: tenant.portBlock.prometheus, status: statusOf(`${tenantName}-prometheus`) });
  infra.push({ id: "tenant:grafana",    type: "grafana",    label: "Grafana",    port: tenant.portBlock.grafana,    status: statusOf(`${tenantName}-grafana`) });
  infra.push({ id: "tenant:tempo",      type: "tempo",      label: "Tempo",      port: tenant.portBlock.tempo,      status: statusOf(`${tenantName}-tempo`) });
  infra.push({ id: "tenant:loki",       type: "loki",       label: "Loki",       port: tenant.portBlock.loki,       status: statusOf(`${tenantName}-loki`) });

  // Per-project infra
  for (const p of tenant.projects) {
    infra.push({ id: `project:${p.name}:kafka`,    type: "kafka",    label: `Kafka (${p.name})`,    port: p.portBlock.kafka,    status: statusOf(`${tenantName}-${p.name}-kafka`) });
    infra.push({ id: `project:${p.name}:postgres`, type: "postgres", label: `Postgres (${p.name})`, port: p.portBlock.postgres, status: statusOf(`${tenantName}-${p.name}-postgres`) });
    infra.push({ id: `project:${p.name}:gateway`,  type: "dashboard", label: `Gateway (${p.name})`, port: p.portBlock.gateway,  status: statusOf(`${tenantName}-${p.name}-gateway`) });
  }

  return infra;
}

/**
 * Build a full tenant/project/service ontology graph from the registry +
 * docker ps state. Emits:
 *   - Tenant infra: dashboard, jenkins, prometheus, grafana, tempo, loki
 *   - Per-project infra: kafka, postgres, gateway (positioned in a column
 *     under the project header)
 *   - Service nodes per project (positioned next to their project's infra)
 *   - Auto edges:
 *       service → kafka  (if project has kafka)
 *       service → postgres (if the service has a database binding)
 *
 * Saved positions + user-drawn edges overlay from
 * `~/.blissful-infra/tenants/<tenant>/ontology.json` so the user's manual
 * tweaks persist across re-renders.
 */
async function buildTenantOntology(tenantName: string): Promise<{
  clientName: string;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
}> {
  const home = process.env.BLISSFUL_HOME ?? "/blissful-home";
  const registryPath = path.join(home, "registry.json");

  type RegProject = {
    name: string;
    portBlock: { kafka: number; postgres: number; gateway: number };
    services: Array<{ name: string; type: string; ports: { http?: number } }>;
  };
  type RegTenant = {
    name: string;
    portBlock: { dashboard: number; jenkins: number; grafana: number; prometheus: number; tempo: number; loki: number };
    projects: RegProject[];
  };

  let tenant: RegTenant | undefined;
  try {
    const raw = JSON.parse(await fs.readFile(registryPath, "utf-8")) as { tenants?: RegTenant[] };
    tenant = raw.tenants?.find(t => t.name === tenantName);
  } catch { /* no registry */ }

  if (!tenant) {
    return { clientName: tenantName, nodes: [], edges: [] };
  }

  // Saved overlay — preserves manual positions + user-drawn edges across runs.
  let saved: { nodes?: Array<{ id: string; position?: { x: number; y: number } }>; edges?: Array<Record<string, unknown>> } = {};
  try {
    const tenantDir = path.join(home, "tenants", tenantName);
    saved = JSON.parse(await fs.readFile(path.join(tenantDir, "ontology.json"), "utf-8"));
  } catch { /* no saved ontology yet */ }
  const savedPos = new Map<string, { x: number; y: number }>(
    (saved.nodes ?? []).filter(n => n.position).map(n => [n.id, n.position!]),
  );

  // Container status — one docker ps for the whole tenant
  let containers: { name: string; state: string }[] = [];
  try {
    const { stdout } = await execa("docker", [
      "ps", "-a", "--no-trunc",
      "--filter", `name=${tenantName}-`,
      "--format", "{{.Names}}|{{.State}}",
    ], { reject: false });
    containers = stdout.trim().split("\n").filter(Boolean).map(line => {
      const [name, state] = line.split("|");
      return { name, state };
    });
  } catch { /* docker unavailable */ }
  const statusOf = (containerName: string): "running" | "stopped" | "unknown" => {
    const c = containers.find(x => x.name === containerName);
    if (!c) return "unknown";
    return c.state === "running" ? "running" : "stopped";
  };

  // Layout: tenant infra in a top strip; each project gets a horizontal slot
  // with its infra in the left column and services to the right.
  const nodes: Array<Record<string, unknown>> = [];
  const edges: Array<Record<string, unknown>> = [];

  const place = (id: string, fallback: { x: number; y: number }) => savedPos.get(id) ?? fallback;

  // Tenant infra strip — top of the canvas
  const tenantInfra: Array<[string, string, string, number]> = [
    [`tenant:dashboard`,  "dashboard",  "Dashboard",  tenant.portBlock.dashboard],
    [`tenant:jenkins`,    "jenkins",    "Jenkins",    tenant.portBlock.jenkins],
    [`tenant:prometheus`, "prometheus", "Prometheus", tenant.portBlock.prometheus],
    [`tenant:grafana`,    "grafana",    "Grafana",    tenant.portBlock.grafana],
    [`tenant:tempo`,      "tempo",      "Tempo",      tenant.portBlock.tempo],
    [`tenant:loki`,       "loki",       "Loki",       tenant.portBlock.loki],
  ];
  tenantInfra.forEach(([id, type, label, port], i) => {
    nodes.push({
      id, type, label, port,
      status: statusOf(`${tenantName}-${id.slice("tenant:".length)}`),
      position: place(id, { x: 60 + i * 160, y: 40 }),
    });
  });

  // Kubernetes runtime strip (ADR-0020) — shown when any project runs on the
  // tenant's kind cluster. Component status proxies through the kind node
  // container (they all run inside it); the docker ps name filter above
  // already caught `blissful-<tenant>-control-plane` as a substring match.
  const projectRuntimes = new Map<string, string>();
  for (const p of tenant.projects) {
    projectRuntimes.set(p.name, await readProjectRuntime(tenantName, p.name));
  }
  if ([...projectRuntimes.values()].includes("kubernetes")) {
    const kindStatus = statusOf(`blissful-${tenantName}-control-plane`);
    const fullBlock = tenant.portBlock as typeof tenant.portBlock & { argocd?: number; gitea?: number };
    const k8sInfra: Array<[string, string, string, number | undefined]> = [
      ["tenant:argocd",        "argocd",        "ArgoCD",        fullBlock.argocd],
      ["tenant:gitea",         "gitea",         "Gitea",         fullBlock.gitea],
      ["tenant:argo-rollouts", "argo-rollouts", "Argo Rollouts", undefined],
    ];
    k8sInfra.forEach(([id, type, label, port], i) => {
      nodes.push({
        id, type, label, port,
        status: kindStatus,
        position: place(id, { x: 60 + (tenantInfra.length + i) * 160, y: 40 }),
      });
    });
  }

  // Per-project lane — infra + services side by side
  const PROJECT_LANE_HEIGHT = 240;
  const PROJECT_LANE_TOP_PAD = 200;
  tenant.projects.forEach((p, projectIdx) => {
    const laneY = PROJECT_LANE_TOP_PAD + projectIdx * PROJECT_LANE_HEIGHT;

    // Project infra in the left column of the lane
    const projInfra: Array<[string, string, string, number]> = [
      [`project:${p.name}:kafka`,    "kafka",    `Kafka (${p.name})`,    p.portBlock.kafka],
      [`project:${p.name}:postgres`, "postgres", `Postgres (${p.name})`, p.portBlock.postgres],
      [`project:${p.name}:gateway`,  "dashboard", `Gateway (${p.name})`, p.portBlock.gateway],
    ];
    projInfra.forEach(([id, type, label, port], i) => {
      const role = id.split(":")[2];
      nodes.push({
        id, type, label, port,
        status: statusOf(`${tenantName}-${p.name}-${role}`),
        position: place(id, { x: 60 + i * 180, y: laneY }),
      });
    });

    // Services to the right
    p.services.forEach((s, sIdx) => {
      const serviceId = `service:${p.name}:${s.name}`;
      // Stagger services into a column to the right of project infra. Wider
      // spacing so the fan-out edges (to kafka, postgres, loki, tempo,
      // prometheus) don't all overlap.
      nodes.push({
        id: serviceId,
        type: "service",
        label: `${s.name}`,
        port: s.ports.http,
        status: statusOf(`${tenantName}-${p.name}-${s.name}`),
        position: place(serviceId, { x: 700 + Math.floor(sIdx / 4) * 220, y: laneY - 30 + (sIdx % 4) * 90 }),
      });

      const has = (id: string) => nodes.find(n => n.id === id);

      // Project-level data dependencies
      if (s.type !== "frontend" && has(`project:${p.name}:kafka`)) {
        edges.push({
          id: `${serviceId}__kafka`, source: serviceId, target: `project:${p.name}:kafka`,
          type: "kafka", label: "events", wired: false,
        });
      }
      if ((s.type === "backend" || s.type === "worker") && has(`project:${p.name}:postgres`)) {
        edges.push({
          id: `${serviceId}__postgres`, source: serviceId, target: `project:${p.name}:postgres`,
          type: "database", label: "schema", wired: false,
        });
      }
      // Gateway routes inbound traffic to frontends and backends with an
      // http port. Drawn so the user sees the request path through the edge.
      if (s.ports.http && has(`project:${p.name}:gateway`)) {
        edges.push({
          id: `gateway__${serviceId}`, source: `project:${p.name}:gateway`, target: serviceId,
          type: "http", label: s.type === "frontend" ? "/" : `/${s.name}`, wired: false,
        });
      }

      // Tenant-level observability fan-in: every service produces logs,
      // traces, and metrics — show those so the canvas reflects what's
      // actually flowing at runtime.
      if (has("tenant:loki")) {
        edges.push({
          id: `${serviceId}__loki`, source: serviceId, target: "tenant:loki",
          type: "custom", label: "logs", wired: false,
        });
      }
      if (has("tenant:tempo")) {
        edges.push({
          id: `${serviceId}__tempo`, source: serviceId, target: "tenant:tempo",
          type: "custom", label: "traces", wired: false,
        });
      }
      if (has("tenant:prometheus")) {
        edges.push({
          id: `${serviceId}__prometheus`, source: serviceId, target: "tenant:prometheus",
          type: "custom", label: "metrics", wired: false,
        });
      }
    });
  });

  // Overlay any user-drawn edges from the saved file (de-duped by id)
  const savedIds = new Set(edges.map(e => e.id as string));
  for (const e of saved.edges ?? []) {
    if (!savedIds.has(e.id as string)) {
      edges.push(e);
    }
  }

  return { clientName: tenantName, nodes, edges };
}

async function getProjectStatus(projectDir: string): Promise<ProjectStatus> {
  const config = await loadConfig(projectDir);

  if (!config) {
    return {
      name: path.basename(projectDir),
      path: projectDir,
      status: "unknown",
      type: "unknown",
      services: [],
    };
  }

  // Get container status
  const services: Service[] = [];
  let anyRunning = false;

  try {
    const { stdout } = await execa(
      "docker",
      ["compose", "ps", "-a", "--format", "json"],
      {
        cwd: projectDir,
        reject: false,
      }
    );

    // Parse JSON lines output
    const lines = stdout.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const container = JSON.parse(line);
        const name = container.Service || container.Name;
        const state = container.State?.toLowerCase() || "unknown";
        const health = (container.Health || "").toLowerCase();
        const isRunning = state === "running";
        const isUnhealthy = isRunning && health === "unhealthy";

        if (isRunning && !isUnhealthy) anyRunning = true;

        // Extract port from container
        let port: number | undefined;
        const ports = container.Publishers || [];
        if (ports.length > 0 && ports[0].PublishedPort) {
          port = ports[0].PublishedPort;
        }

        services.push({
          name,
          status: isUnhealthy ? "unhealthy" : isRunning ? "running" : "stopped",
          port,
        });
      } catch {
        // Skip invalid JSON lines
      }
    }
  } catch {
    // Docker compose not running or error
  }

  // If no services from docker, infer from config
  if (services.length === 0) {
    const derivedType = config.backend ? "backend" : (config.frontend ? "frontend" : "fullstack");
    const isFullstack = derivedType === "fullstack";
    const isFrontendOnly = derivedType === "frontend";

    if (!isFrontendOnly) {
      services.push({ name: "app", status: "stopped", port: 8080 });
      services.push({ name: "kafka", status: "stopped", port: 9092 });
    }

    if (isFullstack || isFrontendOnly) {
      services.push({ name: "frontend", status: "stopped", port: 3000 });
    }

    if (config.database === "postgres" || config.database === "postgres-redis") {
      services.push({ name: "postgres", status: "stopped", port: 5432 });
    }

    if (config.database === "redis" || config.database === "postgres-redis") {
      services.push({ name: "redis", status: "stopped", port: 6379 });
    }
  }

  return {
    name: config.name,
    path: projectDir,
    status: anyRunning ? "running" : "stopped",
    type: config.backend ?? "app",
    backend: config.backend,
    frontend: config.frontend,
    database: config.database,
    services,
  };
}

/**
 * Add a service to the current client by shelling out to the CLI's
 * `service add` command. Runs inside the dashboard container, which has
 * BLISSFUL_HOME mounted (see infra-compose.ts) so the CLI sees the real
 * registry + client directories. The `--yes` flag skips all interactive
 * prompts; missing infra deps get auto-enabled.
 */
/**
 * Add a service in the new tenant/project/service model. The dashboard's
 * "New Service" form sends a flat payload; we map it to a `service add`
 * subprocess invocation against the CLI.
 *
 * Project comes from /blissful-home/context.json (mounted into the dashboard
 * container). If no project is in context, returns a helpful error pointing
 * the user at `blissful-infra use <tenant>/<project>` from the host shell.
 *
 * Type mapping from the legacy form fields:
 *   - explicit type=backend|frontend|worker → use as-is
 *   - type=fullstack → backend (frontend should be added as a second service)
 */
/**
 * Spawn `blissful-infra tenant create <name>` from inside the dashboard
 * container. Same trick as addServiceToTenant: the CLI lives in /app, the
 * registry is mounted at /blissful-home, no cwd dependency.
 */
async function createTenantViaCli(
  name: string,
  opts: { jenkins?: boolean; prometheus?: boolean; grafana?: boolean; tempo?: boolean; loki?: boolean },
): Promise<{ success: boolean; error?: string }> {
  const cliPath = path.join(__dirname, "..", "index.js");
  const args = [cliPath, "tenant", "create", name, "--skip-prompts"];
  if (opts.jenkins    === false) args.push("--no-jenkins");
  if (opts.prometheus === false) args.push("--no-prometheus");
  if (opts.grafana    === false) args.push("--no-grafana");
  if (opts.tempo      === false) args.push("--no-tempo");
  if (opts.loki       === false) args.push("--no-loki");

  try {
    await execa("node", args, { stdio: "pipe", cwd: __dirname });
    return { success: true };
  } catch (error) {
    const execError = toExecError(error);
    return { success: false, error: execError.stderr || execError.message || "Failed to create tenant" };
  }
}

/**
 * Boot a tenant by shelling out to `docker compose up -d` against the host
 * daemon. Used by the dashboard's POST /tenants/:name/up endpoint and by the
 * auto-start branch of POST /tenants.
 *
 * Bind mounts in the tenant compose file are relative (e.g. `./prometheus`),
 * so we set `--project-directory` to the *host* path of the tenant's dir.
 * That way compose resolves bind mounts against the host filesystem, which
 * is the only view the daemon has. HOST_BLISSFUL_HOME is injected by
 * tenant-compose.ts when generating the parent tenant's dashboard service.
 */
async function startTenantViaCompose(
  name: string,
): Promise<{ success: boolean; started?: boolean; dashboardPort?: number; dashboardUrl?: string; error?: string }> {
  const tenant = await getTenant(name);
  if (!tenant) return { success: false, error: `Tenant '${name}' not found` };

  const containerTenantDir = path.join(process.env.BLISSFUL_HOME ?? "/blissful-home", "tenants", name);
  const composeFilePath = path.join(containerTenantDir, "docker-compose.tenant.yaml");
  try {
    await fs.access(composeFilePath);
  } catch {
    return { success: false, error: `Compose file missing for tenant '${name}'` };
  }

  const hostBlissfulHome = process.env.HOST_BLISSFUL_HOME ?? process.env.BLISSFUL_HOME;
  if (!hostBlissfulHome) {
    return { success: false, error: "HOST_BLISSFUL_HOME not set: dashboard cannot resolve host bind-mount paths" };
  }
  const hostTenantDir = path.join(hostBlissfulHome, "tenants", name);

  try {
    await execa("docker", [
      "compose",
      "--project-directory", hostTenantDir,
      "-f", composeFilePath,
      "up", "-d",
    ], { stdio: "pipe" });
  } catch (error) {
    const e = toExecError(error);
    return { success: false, error: e.stderr || e.message || "docker compose up failed" };
  }

  return {
    success: true,
    started: true,
    dashboardPort: tenant.portBlock.dashboard,
    dashboardUrl: `http://localhost:${tenant.portBlock.dashboard}`,
  };
}

/**
 * Snapshot every tenant in the registry with enough detail for the dashboard
 * to render a "switch / clean up" list. Status comes from a single docker ps
 * filtered by the per-tenant dashboard container.
 */
async function listAllTenantSummaries(): Promise<Array<{
  name: string;
  blockIndex: number;
  dashboardPort: number;
  projectCount: number;
  serviceCount: number;
  status: "running" | "stopped" | "unknown";
  isCurrent: boolean;
}>> {
  const tenants = await listTenants();
  // A tenant counts as running if ANY of its containers are up: tenant-level
  // infra (<t>-jenkins, <t>-grafana, ...), project containers (<t>-<p>-...)
  // or its kind cluster node (blissful-<t>-control-plane). The old check
  // looked for <t>-dashboard, which stopped existing when the dashboard
  // became host-level — every tenant read as stopped forever.
  let containerNames: string[] = [];
  try {
    const { stdout } = await execa("docker", ["ps", "--format", "{{.Names}}"], { reject: false });
    containerNames = stdout.trim().split("\n").filter(Boolean);
  } catch { /* docker unavailable */ }
  const tenantIsRunning = (name: string): boolean =>
    containerNames.some(n => n.startsWith(`${name}-`) || n === `blissful-${name}-control-plane`);

  const currentTenant = process.env.TENANT_NAME ?? null;
  return tenants.map(t => ({
    name: t.name,
    blockIndex: t.portBlock.blockIndex,
    dashboardPort: t.portBlock.dashboard,
    projectCount: t.projects.length,
    serviceCount: t.projects.reduce((sum, p) => sum + p.services.length, 0),
    status: tenantIsRunning(t.name) ? "running" as const : "stopped" as const,
    isCurrent: currentTenant === t.name,
  }));
}

/**
 * `blissful-infra tenant remove <name> --skip-prompts` via subprocess.
 * Includes a best-effort `docker compose down` so containers don't linger
 * after the registry entry + dir are wiped.
 */
async function removeTenantViaCli(name: string): Promise<{ success: boolean; error?: string }> {
  const cliPath = path.join(__dirname, "..", "index.js");
  try {
    await execa("node", [cliPath, "tenant", "remove", name, "--skip-prompts"], {
      stdio: "pipe",
      cwd: __dirname,
    });
    return { success: true };
  } catch (error) {
    const e = toExecError(error);
    return { success: false, error: e.stderr || e.message || `Failed to remove tenant '${name}'` };
  }
}

/**
 * Bring up a project (or just one of its services) by shelling out to
 * `docker compose up -d` against the host daemon. Same host-path trick as
 * startTenantViaCompose: --project-directory points at the *host* path of
 * the project dir so relative bind mounts resolve correctly.
 *
 * When `service` is provided, only that service (+ its depends_on) is
 * started. Otherwise the whole project compose comes up.
 */
async function startProjectCompose(
  tenant: string,
  project: string,
  service?: string,
): Promise<{ success: boolean; started?: boolean; error?: string }> {
  const containerProjectDir = path.join(
    process.env.BLISSFUL_HOME ?? "/blissful-home",
    "tenants", tenant, "projects", project,
  );
  const composeFilePath = path.join(containerProjectDir, "docker-compose.project.yaml");
  try {
    await fs.access(composeFilePath);
  } catch {
    return { success: false, error: `Compose file missing for ${tenant}/${project}` };
  }

  const hostBlissfulHome = process.env.HOST_BLISSFUL_HOME ?? process.env.BLISSFUL_HOME;
  if (!hostBlissfulHome) {
    return { success: false, error: "HOST_BLISSFUL_HOME not set: dashboard cannot resolve host bind-mount paths" };
  }
  const hostProjectDir = path.join(hostBlissfulHome, "tenants", tenant, "projects", project);

  const composeArgs = [
    "compose",
    "--project-directory", hostProjectDir,
    "-f", composeFilePath,
    "up", "-d", "--build",
  ];
  if (service) composeArgs.push(service);

  try {
    await execa("docker", composeArgs, { stdio: "pipe" });
  } catch (error) {
    const e = toExecError(error);
    return { success: false, error: e.stderr || e.message || "docker compose up failed" };
  }
  return { success: true, started: true };
}

/** `blissful-infra project create <tenant> <project>` via subprocess. */
async function createProjectViaCli(
  tenant: string,
  project: string,
  opts: { kafka?: boolean; postgres?: boolean; redis?: boolean; gateway?: boolean },
): Promise<{ success: boolean; error?: string }> {
  const cliPath = path.join(__dirname, "..", "index.js");
  const args = [cliPath, "project", "create", tenant, project, "--skip-prompts"];
  if (opts.kafka    === false) args.push("--no-kafka");
  if (opts.postgres === false) args.push("--no-postgres");
  if (opts.redis    === false) args.push("--no-redis");
  if (opts.gateway  === false) args.push("--no-gateway");

  try {
    await execa("node", args, { stdio: "pipe", cwd: __dirname });
    return { success: true };
  } catch (error) {
    const execError = toExecError(error);
    return { success: false, error: execError.stderr || execError.message || "Failed to create project" };
  }
}

async function addServiceToTenant(
  tenant: string,
  options: {
    name: string;
    type: string;
    backend?: string;
    frontend?: string;
    plugins?: string;
  }
): Promise<{ success: boolean; error?: string; project?: string }> {
  // Read the context to figure out which project the service belongs to.
  // /blissful-home is mounted from the host's BLISSFUL_HOME (see tenant-compose.ts).
  let project: string | undefined;
  try {
    const raw = await fs.readFile("/blissful-home/context.json", "utf-8");
    const parsed = JSON.parse(raw) as { tenant?: string; project?: string };
    if (parsed.tenant === tenant) project = parsed.project;
  } catch {
    // No context file or unreadable — we'll bail below.
  }

  if (!project) {
    return {
      success: false,
      error: `No project selected for tenant '${tenant}'. Run on the host:\n  blissful-infra use ${tenant}/<project>`,
    };
  }

  // Map the dashboard's flat type to the new model's service type.
  let serviceType: "backend" | "frontend" | "worker";
  let templateFlag: string[] = [];
  if (options.type === "frontend") {
    serviceType = "frontend";
    if (options.frontend) templateFlag = ["--template", options.frontend];
  } else if (options.type === "worker") {
    serviceType = "worker";
  } else {
    // backend, fullstack, or anything else → backend
    serviceType = "backend";
    if (options.backend) templateFlag = ["--template", options.backend];
  }

  const cliPath = path.join(__dirname, "..", "index.js");
  const args = [
    cliPath, "service", "add", tenant, project, options.name,
    "--type", serviceType,
    "--skip-prompts",
    ...templateFlag,
  ];
  if (options.plugins) args.push("--plugins", options.plugins);

  try {
    // BLISSFUL_HOME is already set on the dashboard container so the CLI sees
    // the mounted registry. cwd is /app (where the CLI lives) so it's always
    // a valid directory regardless of /projects layout.
    await execa("node", args, { stdio: "pipe", cwd: __dirname });
    return { success: true, project };
  } catch (error) {
    const execError = toExecError(error);
    return {
      success: false,
      error: execError.stderr || execError.message || "Failed to add service",
    };
  }
}


async function getContainerMetrics(projectDir: string, saveToStorage = true): Promise<ProjectMetrics> {
  const containers: ContainerMetrics[] = [];
  const config = await loadConfig(projectDir);
  const projectName = config?.name || path.basename(projectDir);

  try {
    // Get container IDs for this project
    const { stdout: psOutput } = await execa(
      "docker",
      ["compose", "ps", "-q"],
      { cwd: projectDir, reject: false }
    );

    const containerIds = psOutput.trim().split("\n").filter(Boolean);

    if (containerIds.length === 0) {
      return { containers: [], timestamp: Date.now() };
    }

    // Get stats for all containers (--no-stream returns single snapshot)
    const { stdout: statsOutput } = await execa(
      "docker",
      ["stats", "--no-stream", "--format", "json", ...containerIds],
      { reject: false }
    );

    // Parse each line of JSON output
    const lines = statsOutput.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const stat = JSON.parse(line);

        // Parse CPU percentage (e.g., "0.50%")
        const cpuPercent = parseFloat(stat.CPUPerc?.replace("%", "") || "0");

        // Parse memory usage (e.g., "50.5MiB / 1GiB")
        const memParts = stat.MemUsage?.split(" / ") || ["0", "0"];
        const memoryUsage = parseMemoryValue(memParts[0]);
        const memoryLimit = parseMemoryValue(memParts[1]);
        const memoryPercent = parseFloat(stat.MemPerc?.replace("%", "") || "0");

        // Parse network I/O (e.g., "1.5kB / 2.3kB")
        const netParts = stat.NetIO?.split(" / ") || ["0", "0"];
        const networkRx = parseMemoryValue(netParts[0]);
        const networkTx = parseMemoryValue(netParts[1]);

        containers.push({
          name: stat.Name || "unknown",
          cpuPercent,
          memoryUsage,
          memoryLimit,
          memoryPercent,
          networkRx,
          networkTx,
        });
      } catch {
        // Skip invalid JSON lines
      }
    }
  } catch {
    // Docker stats failed
  }

  // Try to fetch HTTP metrics from Spring Boot Actuator
  const httpMetrics = await fetchActuatorMetrics();

  // Save metrics to storage for historical access
  if (saveToStorage && containers.length > 0) {
    try {
      const containerData: ContainerMetricsData[] = containers.map((c) => ({
        name: c.name,
        cpuPercent: c.cpuPercent,
        memoryPercent: c.memoryPercent,
        memoryUsage: c.memoryUsage,
        memoryLimit: c.memoryLimit,
        networkRx: c.networkRx,
        networkTx: c.networkTx,
      }));

      const httpData: HttpMetricsData | undefined = httpMetrics
        ? {
            totalRequests: httpMetrics.totalRequests,
            avgResponseTime: httpMetrics.avgResponseTime,
            p50Latency: httpMetrics.p50Latency,
            p95Latency: httpMetrics.p95Latency,
            p99Latency: httpMetrics.p99Latency,
            errorRate: httpMetrics.errorRate,
            status2xx: httpMetrics.status2xx,
            status4xx: httpMetrics.status4xx,
            status5xx: httpMetrics.status5xx,
          }
        : undefined;

      await saveMetrics(projectDir, projectName, containerData, httpData);

      // Check alerts against current metrics
      const alertSnapshot: MetricsSnapshot = {
        containers: containers.map((c) => ({
          name: c.name,
          cpuPercent: c.cpuPercent,
          memoryPercent: c.memoryPercent,
        })),
        http: httpMetrics
          ? {
              errorRate: httpMetrics.errorRate,
              p95Latency: httpMetrics.p95Latency,
              p99Latency: httpMetrics.p99Latency,
            }
          : undefined,
      };
      await checkAlerts(projectDir, alertSnapshot);
    } catch {
      // Ignore storage/alert errors - don't affect metrics collection
    }
  }

  return { containers, httpMetrics, timestamp: Date.now() };
}

/**
 * Compute service health from Docker's own healthcheck status, NOT HTTP probing.
 *
 * Why: HTTP probing requires the API server to be on the same network as the
 * services. In the client model, the dashboard is on the client `infra`
 * network, but service backends/frontends are on per-service `internal`
 * networks where they're aliased as `backend`/`frontend`. The dashboard
 * can't resolve those names from `infra`. So all HTTP probes fail.
 *
 * Docker's healthcheck status (the (healthy)/(unhealthy)/(starting) tag in
 * `docker ps`) is maintained by Docker itself based on each container's
 * configured HEALTHCHECK. We read it via `docker ps --format` — works
 * regardless of network topology, in both flat and client modes.
 *
 * Containers without a HEALTHCHECK report no health string; we map those to
 * `status: 'healthy'` if the container is running (Docker-running ≈
 * functional for things like nginx/postgres without explicit healthcheck) and
 * `unhealthy` if exited.
 */
async function checkServiceHealth(projectDir: string): Promise<HealthResponse> {
  const projectName = path.basename(projectDir);
  const containerPrefix = `${projectName}-`;

  const services: ServiceHealth[] = [];
  let containers: Array<{ name: string; state: string; status: string }> = [];

  try {
    const r = await execa("docker", [
      "ps", "-a", "--no-trunc",
      "--filter", `name=${containerPrefix}`,
      "--format", "{{.Names}}|{{.State}}|{{.Status}}",
    ], { reject: false });

    containers = r.stdout.trim().split("\n").filter(Boolean).map(line => {
      const [name, state, status] = line.split("|");
      return { name, state, status };
    });
  } catch {
    return { services: [], timestamp: Date.now() };
  }

  const checkedAt = Date.now();
  for (const c of containers) {
    const role = c.name.replace(containerPrefix, "");
    const healthMatch = /\((healthy|unhealthy|starting)\)/.exec(c.status || "")?.[1];
    let status: ServiceHealth["status"] = "unknown";
    let details: string | undefined;

    if (c.state === "running" && healthMatch === "healthy") {
      status = "healthy";
      details = "Container healthy";
    } else if (healthMatch === "unhealthy") {
      status = "unhealthy";
      details = "Container failing healthcheck";
    } else if (healthMatch === "starting") {
      status = "unknown";
      details = "Healthcheck still starting";
    } else if (c.state === "running") {
      // Container running, no HEALTHCHECK defined — treat as healthy.
      // Real broken-but-running cases (e.g. crashed Spring Boot still appearing
      // as a process) need their HEALTHCHECK in compose; surfacing that as a
      // followup TODO.
      status = "healthy";
      details = "Running (no healthcheck defined)";
    } else {
      status = "unhealthy";
      details = c.state === "exited" ? "Container exited" : `State: ${c.state}`;
    }

    services.push({
      name: role,
      status,
      lastChecked: checkedAt,
      details,
    });
  }

  return { services, timestamp: checkedAt };
}

interface PluginStatus {
  key: string;
  type: string;
  displayName: string;
  description: string;
  category: string;
  color: string;
  port: number;
  uiUrl: string | null;
  uiLabel: string | null;
  status: "healthy" | "unhealthy" | "unknown";
  responseTimeMs?: number;
  isDataPlatform: boolean;
}

async function probeUrl(url: string): Promise<{ status: "healthy" | "unhealthy" | "unknown"; responseTimeMs?: number }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const start = Date.now();
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return { status: res.ok ? "healthy" : "unhealthy", responseTimeMs: Date.now() - start };
  } catch {
    return { status: "unknown" };
  }
}

async function getPluginStatuses(projectDir: string): Promise<PluginStatus[]> {
  const config = await loadConfig(projectDir);
  const statuses: PluginStatus[] = [];
  const enabledTypes = new Set<string>();

  // Plugin types promoted to client-level infra (ADRs 0008/0009/0010).
  // Filter them out of the per-service plugin display so the dashboard
  // doesn't show them twice (once at client level, once as a stale
  // per-service plugin from old configs).
  const promotedToClientLevel = new Set(["localstack", "keycloak", "clickhouse", "mlflow", "mage"]);

  // User-configured plugin instances
  for (let i = 0; i < (config?.plugins?.length ?? 0); i++) {
    const plugin = config!.plugins![i];
    if (promotedToClientLevel.has(plugin.type)) continue;
    enabledTypes.add(plugin.type);

    const def = PLUGIN_REGISTRY[plugin.type];
    if (!def) continue;

    const port = config?.pluginConfigs?.[plugin.instance]?.port ?? (8090 + i);
    const base = `http://localhost:${port}`;
    const { status, responseTimeMs } = await probeUrl(`${base}${def.healthPath}`);

    statuses.push({
      key: plugin.instance,
      type: plugin.type,
      displayName: `${def.displayName} (${plugin.instance})`,
      description: def.description,
      category: def.category,
      color: def.color,
      port,
      uiUrl: def.ui ? `${base}${def.ui.path}` : null,
      uiLabel: def.ui?.label ?? null,
      status,
      responseTimeMs,
      isDataPlatform: false,
    });
  }

  // Data-platform services co-deployed alongside user plugins
  for (const dp of DATA_PLATFORM_REGISTRY) {
    if (!dp.enabledWith.some(t => enabledTypes.has(t))) continue;

    const base = `http://localhost:${dp.defaultPort}`;
    const { status, responseTimeMs } = await probeUrl(`${base}${dp.healthPath}`);

    statuses.push({
      key: dp.containerKey,
      type: dp.containerKey,
      displayName: dp.displayName,
      description: dp.description,
      category: dp.category,
      color: dp.color,
      port: dp.defaultPort,
      uiUrl: dp.ui ? `${base}${dp.ui.path}` : null,
      uiLabel: dp.ui?.label ?? null,
      status,
      responseTimeMs,
      isDataPlatform: true,
    });
  }

  return statuses;
}

async function fetchActuatorMetrics(): Promise<HttpMetrics | undefined> {
  try {
    // Try to fetch from Spring Boot Actuator on port 8080
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    // Fetch base metrics
    const response = await fetch(`${SERVICE_URLS.backend}/actuator/metrics/http.server.requests`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      clearTimeout(timeout);
      return undefined;
    }

    const data = await response.json() as {
      measurements?: Array<{ statistic: string; value: number }>;
    };

    // Parse Micrometer metrics format
    let totalRequests = 0;
    let totalTime = 0;

    for (const measurement of data.measurements || []) {
      if (measurement.statistic === "COUNT") {
        totalRequests = measurement.value;
      } else if (measurement.statistic === "TOTAL_TIME") {
        totalTime = measurement.value;
      }
    }

    const avgResponseTime = totalRequests > 0 ? (totalTime / totalRequests) * 1000 : 0; // Convert to ms

    // Fetch Prometheus metrics for percentiles and error rates
    let p50Latency: number | undefined;
    let p95Latency: number | undefined;
    let p99Latency: number | undefined;
    let status2xx = 0;
    let status4xx = 0;
    let status5xx = 0;

    try {
      const promResponse = await fetch(`${SERVICE_URLS.backend}/actuator/prometheus`, {
        signal: controller.signal,
      });

      if (promResponse.ok) {
        const promText = await promResponse.text();
        const lines = promText.split("\n");

        for (const line of lines) {
          // Parse percentile metrics: http_server_requests_seconds{...,quantile="0.5",...} value
          if (line.startsWith("http_server_requests_seconds") && !line.startsWith("#")) {
            const quantileMatch = line.match(/quantile="([^"]+)"/);
            const valueMatch = line.match(/\}\s+([\d.]+(?:E[+-]?\d+)?)/);

            if (quantileMatch && valueMatch) {
              const quantile = parseFloat(quantileMatch[1]);
              const value = parseFloat(valueMatch[1]) * 1000; // Convert to ms

              if (quantile === 0.5) p50Latency = value;
              else if (quantile === 0.95) p95Latency = value;
              else if (quantile === 0.99) p99Latency = value;
            }
          }

          // Parse status code counts from http_requests_total or http_server_requests_seconds_count
          if ((line.startsWith("http_requests_total") || line.startsWith("http_server_requests_seconds_count")) && !line.startsWith("#")) {
            const statusMatch = line.match(/status="(\d+)"/);
            const valueMatch = line.match(/\}\s+([\d.]+)/);

            if (statusMatch && valueMatch) {
              const status = parseInt(statusMatch[1], 10);
              const count = parseFloat(valueMatch[1]);

              if (status >= 200 && status < 300) status2xx += count;
              else if (status >= 400 && status < 500) status4xx += count;
              else if (status >= 500 && status < 600) status5xx += count;
            }
          }
        }
      }
    } catch {
      // Prometheus endpoint not available
    }

    clearTimeout(timeout);

    const errorCount = status5xx;
    const totalForError = status2xx + status4xx + status5xx;
    const errorRate = totalForError > 0 ? (errorCount / totalForError) * 100 : 0;

    return {
      totalRequests,
      requestsPerSecond: 0, // Will be calculated on frontend from delta
      avgResponseTime,
      p50Latency,
      p95Latency,
      p99Latency,
      errorCount,
      errorRate,
      status2xx,
      status4xx,
      status5xx,
    };
  } catch {
    // Actuator not available or error
    return undefined;
  }
}

function parseMemoryValue(value: string): number {
  if (!value) return 0;
  const num = parseFloat(value);
  if (isNaN(num)) return 0;

  const upper = value.toUpperCase();
  if (upper.includes("GIB") || upper.includes("GB")) return num * 1024 * 1024 * 1024;
  if (upper.includes("MIB") || upper.includes("MB")) return num * 1024 * 1024;
  if (upper.includes("KIB") || upper.includes("KB")) return num * 1024;
  if (upper.includes("B")) return num;
  return num;
}

async function handleAgentQuery(
  projectDir: string,
  query: string,
  requestedModel?: string,
  requestedProvider?: AIProvider,
  tenantScope?: { tenant: string; project: string },
): Promise<string> {
  // Find available provider
  const provider = await getProvider(requestedProvider);
  if (!provider) {
    return DOCKER_MODE
      ? "Error: the dashboard's Claude agent has no credentials. Run `blissful-infra dashboard login` (OAuth, uses your Claude subscription), or export ANTHROPIC_API_KEY on the host and rerun `blissful-infra dashboard up`."
      : "Error: No AI provider available. Either install Claude Code (`claude login`), set ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN, or start Ollama with `ollama serve`.";
  }

  // Select model
  const modelInfo = await getModelInfo(requestedModel, provider);
  if (!modelInfo) {
    return "Error: No language models available.";
  }

  // If the user's query mentions failure-shaped words, narrow context to
  // error/warn-level lines from a wider window. Same token cost, much
  // higher signal — "what's broken?" gets the actual error lines, not 500
  // lines of healthy Spring Boot startup chatter.
  const failureIntent = /\b(error|errors|warn|warning|warnings|fail|failed|failure|issue|issues|broken|crash|crashed|exception|exceptions|stack ?trace|down|unhealthy|wrong)\b/i.test(query);

  const context = await collectContext(projectDir, {
    ...(tenantScope ? { tenant: tenantScope.tenant, project: tenantScope.project } : {}),
    errorsOnly: failureIntent,
  });
  const contextText = formatContextForPrompt(context);

  // Build messages
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `${contextText}\n\n---\n\nQuestion: ${query}`,
    },
  ];

  // Get response
  const response = await aiChat(modelInfo.provider, modelInfo.model, messages);
  return response;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Phase 2: Helper functions for deployment and pipeline

interface EnvironmentInfo {
  name: string;
  version: string;
  status: "Synced" | "OutOfSync" | "Progressing" | "Missing" | "Unknown";
  health: "Healthy" | "Degraded" | "Progressing" | "Missing" | "Unknown";
  replicas: string;
  lastDeployed?: string;
}

interface PipelineStatus {
  lastRun?: {
    status: "success" | "failure" | "running" | "unknown";
    duration?: number;
    timestamp?: string;
    stages: Array<{
      name: string;
      status: "success" | "failure" | "running" | "skipped" | "pending";
    }>;
  };
  jenkinsUrl?: string;
}

async function getProjectEnvironments(
  projectDir: string,
  projectName: string,
  tenant?: string | null,
): Promise<EnvironmentInfo[]> {
  const environments: EnvironmentInfo[] = [];

  // Check local environment
  try {
    const { stdout } = await execa("docker", ["compose", "ps", "--format", "json"], {
      cwd: projectDir,
      reject: false,
    });

    const containers = stdout.trim().split("\n").filter(Boolean);
    if (containers.length > 0) {
      const anyRunning = containers.some((line: string) => {
        try {
          const c = JSON.parse(line);
          return c.State?.toLowerCase() === "running";
        } catch {
          return false;
        }
      });

      environments.push({
        name: "local",
        version: "dev",
        status: anyRunning ? "Synced" : "OutOfSync",
        health: anyRunning ? "Healthy" : "Degraded",
        replicas: anyRunning ? "1/1" : "0/1",
      });
    }
  } catch {
    // Local environment not available
  }

  // Kubernetes runtime (ADR-0017 + local kind cluster): one env per project,
  // namespace = project name, workload = Argo Rollout (Deployment fallback).
  if (tenant) {
    const owning = await findServiceProject(tenant, projectName);
    if (owning && (await readProjectRuntime(tenant, owning.project)) === "kubernetes") {
      const namespace = owning.project;
      const workload = await readK8sWorkload(projectName, namespace, kubeContext(tenant));
      if (workload) {
        environments.push(workload);
      } else {
        environments.push({
          name: namespace,
          version: "-",
          status: "Missing",
          health: "Missing",
          replicas: "-",
        });
      }
    }
  }

  return environments;
}

/**
 * Read the service's workload in the project namespace: Rollout first (the
 * k8s-runtime deploy shape), plain Deployment as a fallback.
 */
async function readK8sWorkload(service: string, namespace: string, context: string): Promise<EnvironmentInfo | null> {
  for (const kind of ["rollout", "deployment"]) {
    try {
      const { stdout } = await execa("kubectl", [
        "--context", context, "get", kind, service, "-n", namespace, "-o", "json",
      ], { stdio: "pipe", timeout: 10000 });
      if (!stdout) continue;
      const obj = JSON.parse(stdout);
      const available = obj.status?.availableReplicas ?? obj.status?.readyReplicas ?? 0;
      const desired = obj.spec?.replicas ?? 0;
      const imageTag = obj.spec?.template?.spec?.containers?.[0]?.image?.split(":")[1] || "latest";
      const phase = obj.status?.phase as string | undefined; // Rollouts set this (Healthy/Progressing/Paused/Degraded)
      const healthy = phase ? phase === "Healthy" : available === desired && desired > 0;
      const health: EnvironmentInfo["health"] =
        phase === "Healthy" ? "Healthy" :
        phase === "Degraded" ? "Degraded" :
        phase ? "Progressing" :
        healthy ? "Healthy" : "Progressing";
      return {
        name: namespace,
        version: imageTag.substring(0, 7),
        status: healthy ? "Synced" : "Progressing",
        health,
        replicas: `${available}/${desired}`,
      };
    } catch {
      // Try the next kind
    }
  }
  return null;
}

async function getPipelineStatus(
  projectDir: string,
  projectName: string
): Promise<PipelineStatus> {
  // Check if Jenkinsfile exists (root or backend/ for fullstack projects)
  let hasJenkinsfile = false;
  for (const loc of ["Jenkinsfile", "backend/Jenkinsfile"]) {
    try {
      await fs.access(path.join(projectDir, loc));
      hasJenkinsfile = true;
      break;
    } catch {
      // Try next location
    }
  }

  const jenkinsApiHost = DOCKER_MODE ? "host.docker.internal" : "localhost";
  // Always use localhost for browser-facing links
  const jenkinsBrowserHost = "localhost";

  // Try to fetch last build from Jenkins API
  let lastRun: PipelineStatus["lastRun"];
  // Jobs are created in blissful-projects folder by `jenkins add-project`
  let resolvedJobPath = `job/blissful-projects/job/${projectName}`;
  let jenkinsReachable = false;
  if (hasJenkinsfile) {
    try {
      const authHeader = "Basic " + Buffer.from("admin:admin").toString("base64");

      // First resolve where the job actually lives (existence check, not lastBuild).
      // A new job with no builds returns 404 on /lastBuild, so we must check the
      // job endpoint itself to avoid misidentifying the path.
      const folderJobUrl = `http://${jenkinsApiHost}:8081/job/blissful-projects/job/${projectName}/api/json`;
      const rootJobUrl   = `http://${jenkinsApiHost}:8081/job/${projectName}/api/json`;

      const folderCheck = await fetch(folderJobUrl, {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(3000),
      });

      if (!folderCheck.ok) {
        const rootCheck = await fetch(rootJobUrl, {
          headers: { Authorization: authHeader },
          signal: AbortSignal.timeout(3000),
        });
        if (rootCheck.ok) {
          resolvedJobPath = `job/${projectName}`;
        }
        // If neither exists the path stays as blissful-projects (job not registered yet)
      }

      jenkinsReachable = true;

      // Now fetch lastBuild from the resolved path
      const jobApiUrl = `http://${jenkinsApiHost}:8081/${resolvedJobPath}/lastBuild/api/json`;
      const resp = await fetch(jobApiUrl, {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(3000),
      });

      if (resp.ok) {
        const build = (await resp.json()) as {
          result: string | null;
          duration: number;
          timestamp: number;
          displayName?: string;
        };

        const status =
          build.result === "SUCCESS" ? "success" as const :
          build.result === "FAILURE" ? "failure" as const :
          build.result === null ? "running" as const :
          "unknown" as const;

        // Fetch pipeline stages if available
        const stages: Array<{ name: string; status: "success" | "failure" | "running" | "skipped" | "pending" }> = [];
        try {
          const stagesUrl = jobApiUrl.replace("/api/json", "/wfapi/describe");
          const stagesResp = await fetch(stagesUrl, {
            headers: { Authorization: authHeader },
            signal: AbortSignal.timeout(3000),
          });
          if (stagesResp.ok) {
            const wf = (await stagesResp.json()) as {
              stages?: Array<{ name: string; status: string }>;
            };
            if (wf.stages) {
              for (const s of wf.stages) {
                stages.push({
                  name: s.name,
                  status:
                    s.status === "SUCCESS" ? "success" :
                    s.status === "FAILED" ? "failure" :
                    s.status === "IN_PROGRESS" ? "running" :
                    s.status === "NOT_EXECUTED" ? "skipped" :
                    "pending",
                });
              }
            }
          }
        } catch {
          // Pipeline stages API not available — that's fine
        }

        lastRun = {
          status,
          duration: Math.round(build.duration / 1000),
          timestamp: new Date(build.timestamp).toISOString(),
          stages,
        };
      }
    } catch {
      // Jenkins not reachable — link will be hidden
    }
  }

  const jenkinsUrl = (hasJenkinsfile && jenkinsReachable)
    ? `http://${jenkinsBrowserHost}:8081/${resolvedJobPath}`
    : undefined;

  return { lastRun, jenkinsUrl };
}
