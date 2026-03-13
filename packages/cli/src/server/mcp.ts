/**
 * blissful-infra MCP Server
 *
 * Exposes infrastructure management as MCP tools so Claude can orchestrate
 * project creation, start/stop, log inspection, deployments, and CI pipelines.
 *
 * Usage (stdio — add to Claude Desktop or Claude Code MCP config):
 *   blissful-infra mcp --projects-dir /path/to/projects
 *
 * Or run against a running dashboard API:
 *   blissful-infra mcp --api http://localhost:3002
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

export interface McpServerOptions {
  /** Base URL of a running dashboard API server, e.g. http://localhost:3002 */
  apiBase: string;
  /** Human-readable label shown in the MCP client */
  name?: string;
}

async function apiGet(base: string, path: string): Promise<unknown> {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${res.statusText}`);
  return res.json();
}

async function apiPost(base: string, path: string, body: unknown = {}): Promise<unknown> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function apiDelete(base: string, path: string): Promise<unknown> {
  const res = await fetch(`${base}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status} ${res.statusText}`);
  return res.json();
}

function text(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function createMcpServer(opts: McpServerOptions): McpServer {
  const { apiBase } = opts;

  const server = new McpServer({
    name: opts.name ?? "blissful-infra",
    version: "0.1.0",
  });

  // ── Project management ─────────────────────────────────────────────────── //

  server.tool(
    "list_projects",
    "List all blissful-infra projects and their running status",
    {},
    async () => {
      const data = await apiGet(apiBase, "/api/projects") as { projects: unknown[] };
      return { content: [{ type: "text", text: text(data.projects) }] };
    }
  );

  server.tool(
    "get_project",
    "Get detailed status of a specific project including running services",
    { project: z.string().describe("Project name") },
    async ({ project }) => {
      const data = await apiGet(apiBase, `/api/projects/${project}`);
      return { content: [{ type: "text", text: text(data) }] };
    }
  );

  server.tool(
    "create_project",
    "Scaffold a new blissful-infra project with the given stack",
    {
      name: z.string().describe("Project name (kebab-case)"),
      backend: z.enum(["spring-boot", "fastapi", "express", "go-chi"])
        .default("spring-boot")
        .describe("Backend framework"),
      frontend: z.enum(["react-vite", "nextjs"])
        .default("react-vite")
        .describe("Frontend framework"),
      database: z.enum(["none", "postgres", "redis", "postgres-redis"])
        .default("postgres")
        .describe("Database setup"),
    },
    async ({ name, backend, frontend, database }) => {
      const data = await apiPost(apiBase, "/api/projects", {
        name,
        type: "fullstack",
        backend,
        frontend,
        database,
      });
      return { content: [{ type: "text", text: text(data) }] };
    }
  );

  server.tool(
    "start_project",
    "Start (docker compose up) a project",
    { project: z.string().describe("Project name") },
    async ({ project }) => {
      const data = await apiPost(apiBase, `/api/projects/${project}/up`);
      return { content: [{ type: "text", text: text(data) }] };
    }
  );

  server.tool(
    "stop_project",
    "Stop (docker compose down) a project",
    { project: z.string().describe("Project name") },
    async ({ project }) => {
      const data = await apiPost(apiBase, `/api/projects/${project}/down`);
      return { content: [{ type: "text", text: text(data) }] };
    }
  );

  server.tool(
    "delete_project",
    "Stop and permanently delete a project and all its data",
    { project: z.string().describe("Project name") },
    async ({ project }) => {
      const data = await apiDelete(apiBase, `/api/projects/${project}`);
      return { content: [{ type: "text", text: text(data) }] };
    }
  );

  server.tool(
    "list_templates",
    "List available backend, frontend, and database options",
    {},
    async () => {
      const data = await apiGet(apiBase, "/api/templates");
      return { content: [{ type: "text", text: text(data) }] };
    }
  );

  // ── Health & metrics ───────────────────────────────────────────────────── //

  server.tool(
    "get_health",
    "Get health status of all services in a project",
    { project: z.string().describe("Project name") },
    async ({ project }) => {
      const data = await apiGet(apiBase, `/api/projects/${project}/health`);
      return { content: [{ type: "text", text: text(data) }] };
    }
  );

  server.tool(
    "get_metrics",
    "Get current CPU, memory, and HTTP metrics for a project",
    { project: z.string().describe("Project name") },
    async ({ project }) => {
      const data = await apiGet(apiBase, `/api/projects/${project}/metrics`);
      return { content: [{ type: "text", text: text(data) }] };
    }
  );

  server.tool(
    "get_metrics_summary",
    "Get aggregated metrics summary (averages, p95 latency, error rate) for a project",
    {
      project: z.string().describe("Project name"),
      start: z.number().optional().describe("Start time (unix ms, default: 1 hour ago)"),
      end: z.number().optional().describe("End time (unix ms, default: now)"),
    },
    async ({ project, start, end }) => {
      const params = new URLSearchParams();
      if (start) params.set("start", String(start));
      if (end) params.set("end", String(end));
      const qs = params.toString() ? `?${params}` : "";
      const data = await apiGet(apiBase, `/api/projects/${project}/metrics/summary${qs}`);
      return { content: [{ type: "text", text: text(data) }] };
    }
  );

  server.tool(
    "get_plugins",
    "Get status of all plugins (ai-pipeline, scraper, etc.) for a project",
    { project: z.string().describe("Project name") },
    async ({ project }) => {
      const data = await apiGet(apiBase, `/api/projects/${project}/plugins`);
      return { content: [{ type: "text", text: text(data) }] };
    }
  );

  // ── Logs ───────────────────────────────────────────────────────────────── //

  server.tool(
    "get_logs",
    "Get recent logs from all containers in a project",
    {
      project: z.string().describe("Project name"),
      service: z.string().optional().describe("Filter to a specific service (e.g. backend, kafka)"),
      filter: z.string().optional().describe("Text filter to apply to log lines"),
      limit: z.number().default(100).describe("Max number of log lines to return"),
    },
    async ({ project, service, filter, limit }) => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (service) params.set("service", service);
      if (filter) params.set("filter", filter);
      const data = await apiGet(apiBase, `/api/projects/${project}/logs?${params}`) as { logs: unknown };
      return { content: [{ type: "text", text: text(data.logs) }] };
    }
  );

  server.tool(
    "search_logs",
    "Search stored logs with filters for service, log level, and text query",
    {
      project: z.string().describe("Project name"),
      query: z.string().optional().describe("Full-text search query"),
      service: z.string().optional().describe("Service name filter"),
      level: z.enum(["ERROR", "WARN", "INFO", "DEBUG"]).optional().describe("Log level filter"),
      limit: z.number().default(200).describe("Max results"),
    },
    async ({ project, query, service, level, limit }) => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (query) params.set("q", query);
      if (service) params.set("service", service);
      if (level) params.set("level", level);
      const data = await apiGet(apiBase, `/api/projects/${project}/logs/search?${params}`);
      return { content: [{ type: "text", text: text(data) }] };
    }
  );

  // ── AI agent ───────────────────────────────────────────────────────────── //

  server.tool(
    "query_agent",
    "Ask the AI debugging agent a question about a project — it has access to logs, metrics, and service health",
    {
      project: z.string().describe("Project name"),
      query: z.string().describe("Your question or debugging request"),
    },
    async ({ project, query }) => {
      const data = await apiPost(apiBase, `/api/projects/${project}/agent`, { query }) as { response: string };
      return { content: [{ type: "text", text: data.response }] };
    }
  );

  // ── CI/CD pipeline ─────────────────────────────────────────────────────── //

  server.tool(
    "get_pipeline",
    "Get Jenkins CI pipeline status for a project",
    { project: z.string().describe("Project name") },
    async ({ project }) => {
      const data = await apiGet(apiBase, `/api/projects/${project}/pipeline`);
      return { content: [{ type: "text", text: text(data) }] };
    }
  );

  server.tool(
    "run_pipeline",
    "Trigger a local CI pipeline build for a project",
    {
      project: z.string().describe("Project name"),
      skipTests: z.boolean().default(false).describe("Skip test stage"),
      skipScan: z.boolean().default(false).describe("Skip security scan stage"),
      push: z.boolean().default(false).describe("Push image to registry after build"),
    },
    async ({ project, skipTests, skipScan, push }) => {
      const data = await apiPost(apiBase, `/api/projects/${project}/pipeline`, {
        skipTests,
        skipScan,
        push,
      });
      return { content: [{ type: "text", text: text(data) }] };
    }
  );

  // ── Environments & deployment ──────────────────────────────────────────── //

  server.tool(
    "list_environments",
    "List deployment environments configured for a project",
    { project: z.string().describe("Project name") },
    async ({ project }) => {
      const data = await apiGet(apiBase, `/api/projects/${project}/environments`);
      return { content: [{ type: "text", text: text(data) }] };
    }
  );

  server.tool(
    "deploy",
    "Deploy a project to an environment via Argo CD",
    {
      project: z.string().describe("Project name"),
      env: z.enum(["staging", "production", "ephemeral"]).default("staging").describe("Target environment"),
      image: z.string().optional().describe("Specific image tag to deploy (defaults to latest)"),
    },
    async ({ project, env, image }) => {
      const data = await apiPost(apiBase, `/api/projects/${project}/deploy`, { env, image });
      return { content: [{ type: "text", text: text(data) }] };
    }
  );

  server.tool(
    "rollback",
    "Roll back a project to a previous deployment revision",
    {
      project: z.string().describe("Project name"),
      env: z.enum(["staging", "production", "ephemeral"]).default("staging").describe("Target environment"),
      revision: z.string().optional().describe("Revision to roll back to (defaults to previous)"),
    },
    async ({ project, env, revision }) => {
      const data = await apiPost(apiBase, `/api/projects/${project}/rollback`, { env, revision });
      return { content: [{ type: "text", text: text(data) }] };
    }
  );

  return server;
}

export async function startMcpServer(opts: McpServerOptions): Promise<void> {
  const server = createMcpServer(opts);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep alive — stdio transport runs until stdin closes
}
