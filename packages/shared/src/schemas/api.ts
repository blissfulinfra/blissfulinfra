import { z } from "zod";
import { ContainerMetricsSchema, HttpMetricsSchema, StoredMetricsSchema } from "./metrics.js";
import { TriggeredAlertSchema, AlertThresholdSchema, AlertsConfigSchema } from "./alerts.js";
import { DeploymentRecordSchema } from "./deployments.js";
import { PluginStatusSchema } from "./plugins.js";

// ─── Service & Project ────────────────────────────────────────────────────────

export const ServiceStatusSchema = z.enum(["running", "stopped", "starting", "unhealthy"]);

export const ServiceSchema = z.object({
  name: z.string(),
  status: ServiceStatusSchema,
  port: z.number().optional(),
  /** backend | frontend | worker (tenant model). */
  serviceType: z.string().optional(),
  /** Scaffold template (hono, spring-boot, react-vite, ...). */
  template: z.string().optional(),
  /** Per-service Postgres schema on the project instance (compose runtime). */
  dbSchema: z.string().optional(),
  /** Where to open the service: absolute URL (compose) or preview path (k8s). */
  url: z.string().optional(),
});

export const ProjectInfraPortsSchema = z.object({
  kafka: z.number().optional(),
  postgres: z.number().optional(),
  redis: z.number().optional(),
  gateway: z.number().optional(),
});

export const ProjectStatusSchema = z.object({
  name: z.string(),
  path: z.string(),
  status: z.enum(["running", "stopped", "unknown"]),
  type: z.string(),
  backend: z.string().optional(),
  frontend: z.string().optional(),
  database: z.string().optional(),
  runtime: z.enum(["compose", "kubernetes"]).optional(),
  /** Host ports of the project's compose infra (compose runtime only). */
  infra: ProjectInfraPortsSchema.optional(),
  services: z.array(ServiceSchema),
});

export const ProjectsListResponseSchema = z.object({
  projects: z.array(ProjectStatusSchema),
});

export const CreateProjectRequestSchema = z.object({
  name: z.string(),
  type: z.string().optional(),
  backend: z.string().optional(),
  frontend: z.string().optional(),
  database: z.string().optional(),
});

export const ActionResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  message: z.string().optional(),
});

// ─── Metrics ─────────────────────────────────────────────────────────────────

export const MetricsResponseSchema = z.object({
  containers: z.array(ContainerMetricsSchema),
  httpMetrics: HttpMetricsSchema.optional(),
  timestamp: z.number(),
});

export const MetricsHistoryResponseSchema = z.object({
  metrics: z.array(StoredMetricsSchema),
  count: z.number(),
});

// ─── Health ───────────────────────────────────────────────────────────────────

export const ServiceHealthSchema = z.object({
  name: z.string(),
  status: z.enum(["healthy", "unhealthy", "unknown"]),
  responseTimeMs: z.number().optional(),
  lastChecked: z.number(),
  details: z.string().optional(),
});

export const HealthResponseSchema = z.object({
  services: z.array(ServiceHealthSchema),
  timestamp: z.number(),
});

// ─── Alerts ───────────────────────────────────────────────────────────────────

export const AlertsResponseSchema = z.object({
  config: AlertsConfigSchema,
  activeAlerts: z.array(TriggeredAlertSchema),
  recentHistory: z.array(TriggeredAlertSchema),
});

export const UpdateAlertThresholdRequestSchema = AlertThresholdSchema.partial().omit({ id: true });

// ─── Logs ─────────────────────────────────────────────────────────────────────

export const LogEntrySchema = z.object({
  timestamp: z.string(),
  service: z.string(),
  message: z.string(),
});

export const LogsResponseSchema = z.object({
  logs: z.array(LogEntrySchema),
});

// ─── Deployments ─────────────────────────────────────────────────────────────

export const DeploymentListResponseSchema = z.object({
  deployments: z.array(DeploymentRecordSchema),
});

// ─── Plugins ─────────────────────────────────────────────────────────────────

export const PluginsResponseSchema = z.object({
  plugins: z.array(PluginStatusSchema),
});

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export const PipelineStageSchema = z.object({
  name: z.string(),
  status: z.enum(["success", "failed", "running", "pending", "skipped"]),
  durationMs: z.number().optional(),
});

export const PipelineDataSchema = z.object({
  buildNumber: z.number(),
  status: z.enum(["success", "failed", "running", "pending"]),
  branch: z.string().optional(),
  commit: z.string().optional(),
  duration: z.number().optional(),
  stages: z.array(PipelineStageSchema).optional(),
  url: z.string().optional(),
});

// ─── Environment ─────────────────────────────────────────────────────────────

export const EnvironmentInfoSchema = z.object({
  name: z.string(),
  status: z.enum(["running", "stopped", "unknown"]),
  url: z.string().optional(),
  namespace: z.string().optional(),
  createdAt: z.number().optional(),
});

// ─── AI / Models ─────────────────────────────────────────────────────────────

export const AIModelSchema = z.object({
  name: z.string(),
  provider: z.string(),
  displayName: z.string().optional(),
});

export const ModelsResponseSchema = z.object({
  models: z.array(AIModelSchema),
  current: z.string().optional(),
});

// ─── Templates ────────────────────────────────────────────────────────────────

export const TemplatesResponseSchema = z.object({
  types: z.array(z.string()),
  backends: z.array(z.string()),
  frontends: z.array(z.string()),
  databases: z.array(z.string()),
});

// ─── Inferred types ──────────────────────────────────────────────────────────

export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;
export type Service = z.infer<typeof ServiceSchema>;
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;
export type ProjectInfraPorts = z.infer<typeof ProjectInfraPortsSchema>;
export type ProjectsListResponse = z.infer<typeof ProjectsListResponseSchema>;
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;
export type ActionResponse = z.infer<typeof ActionResponseSchema>;
export type MetricsResponse = z.infer<typeof MetricsResponseSchema>;
export type MetricsHistoryResponse = z.infer<typeof MetricsHistoryResponseSchema>;
export type ServiceHealth = z.infer<typeof ServiceHealthSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type AlertsResponse = z.infer<typeof AlertsResponseSchema>;
export type LogEntry = z.infer<typeof LogEntrySchema>;
export type LogsResponse = z.infer<typeof LogsResponseSchema>;
export type DeploymentListResponse = z.infer<typeof DeploymentListResponseSchema>;
export type PluginsResponse = z.infer<typeof PluginsResponseSchema>;
export type PipelineStage = z.infer<typeof PipelineStageSchema>;
export type PipelineData = z.infer<typeof PipelineDataSchema>;
export type EnvironmentInfo = z.infer<typeof EnvironmentInfoSchema>;
export type AIModel = z.infer<typeof AIModelSchema>;
export type ModelsResponse = z.infer<typeof ModelsResponseSchema>;
export type TemplatesResponse = z.infer<typeof TemplatesResponseSchema>;
