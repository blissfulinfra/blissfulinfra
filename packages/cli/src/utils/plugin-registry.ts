/**
 * Plugin registry — static metadata for every built-in plugin type and
 * the data-platform services that co-deploy alongside them.
 *
 * This is the single source of truth consumed by:
 *   - api.ts  →  GET /api/projects/:name/plugins  (health + metadata per project)
 *   - App.tsx →  Plugins tab  (renders cards from the API response)
 */

export interface PluginDef {
  displayName: string;
  description: string;
  category: PluginCategory;
  defaultPort: number;
  /** Path to call for a health check (relative to the service base URL). */
  healthPath: string;
  /** Hex colour used for the category badge and card accent. */
  color: string;
  /** If the plugin exposes a browser-accessible web UI, set this. */
  ui?: {
    /** URL path to navigate to, e.g. "/docs" or "/". */
    path: string;
    /** Human label shown on the "Open" button. */
    label?: string;
  };
}

export type PluginCategory =
  | "AI/ML"
  | "Data"
  | "Orchestration"
  | "Observability"
  | "Infrastructure";

// ─── User-configurable built-in plugins ───────────────────────────────────────

/** Registry keyed by plugin type string (matches PluginInstance.type). */
export const PLUGIN_REGISTRY: Record<string, PluginDef> = {
  "ai-pipeline": {
    displayName: "AI Pipeline",
    description: "Real-time event classification with Kafka + scikit-learn",
    category: "AI/ML",
    defaultPort: 8090,
    healthPath: "/health",
    color: "#6366f1",
    ui: { path: "/docs", label: "API Docs" },
  },
  "agent-service": {
    displayName: "Agent Service",
    description: "LangGraph virtual employees for codebase analysis and feature engineering",
    category: "AI/ML",
    defaultPort: 8095,
    healthPath: "/health",
    color: "#8b5cf6",
    ui: { path: "/docs", label: "API Docs" },
  },
  "keycloak": {
    displayName: "Keycloak",
    description: "Open source IAM — OAuth2/OIDC, RBAC, user management, and admin console",
    category: "Infrastructure",
    defaultPort: 8001,
    healthPath: "/health/ready",
    color: "#4a90d9",
    ui: { path: "/admin", label: "Admin Console" },
  },
  "gatling": {
    displayName: "Gatling",
    description: "JVM load testing with Kotlin DSL — run from the dashboard, view p50/p95/p99 results in real time",
    category: "Observability",
    defaultPort: 0,
    healthPath: "/",
    color: "#f97316",
  },
};

// ─── Data-platform services co-deployed alongside plugins ─────────────────────

export interface DataPlatformDef extends PluginDef {
  /** Docker-compose service key and dashboard card key. */
  containerKey: string;
  /** Plugin types whose presence enables this service. */
  enabledWith: string[];
}

/**
 * Services that are automatically started when certain plugins are enabled.
 * They appear in the dashboard Plugins tab alongside the user-configured plugins.
 */
export const DATA_PLATFORM_REGISTRY: DataPlatformDef[] = [
  {
    containerKey: "clickhouse",
    displayName: "ClickHouse",
    description: "Columnar OLAP store for predictions and events at scale",
    category: "Data",
    defaultPort: 8123,
    healthPath: "/ping",
    color: "#f59e0b",
    ui: { path: "/play", label: "SQL Editor" },
    enabledWith: ["ai-pipeline"],
  },
  {
    containerKey: "mlflow",
    displayName: "MLflow",
    description: "Experiment tracking, model registry, and artifact store",
    category: "AI/ML",
    defaultPort: 5001,
    healthPath: "/api/2.0/mlflow/experiments/list",
    color: "#3b82f6",
    ui: { path: "/", label: "Experiments" },
    enabledWith: ["ai-pipeline"],
  },
  {
    containerKey: "mage",
    displayName: "Mage",
    description: "Visual data pipeline orchestrator with Python/SQL transforms",
    category: "Orchestration",
    defaultPort: 6789,
    healthPath: "/",
    color: "#10b981",
    ui: { path: "/", label: "Pipelines" },
    enabledWith: ["ai-pipeline"],
  },
];
