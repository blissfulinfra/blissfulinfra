import { z } from "zod";

// ---------------------------------------------------------------------------
// Deploy targets
// ---------------------------------------------------------------------------

export const DeployTargetSchema = z.enum([
  "local-only",
  "cloudflare",
  "vercel",
  "aws",
  "gcp",
]);

// Per-platform adapter config — only the relevant block is required for the
// chosen deploy target.

export const CloudflareDeployConfigSchema = z.object({
  accountId: z.string().optional(),
  workerName: z.string().optional(),
  pagesProject: z.string().optional(),
});

export const VercelDeployConfigSchema = z.object({
  orgId: z.string().optional(),
  projectId: z.string().optional(),
});

export const AwsDeployConfigSchema = z.object({
  region: z.string().optional(),
  cluster: z.string().optional(),
  registry: z.object({
    type: z.enum(["ecr", "gcr", "acr", "local"]),
    url: z.string(),
  }).optional(),
});

export const DeployConfigSchema = z.object({
  target: DeployTargetSchema.default("local-only"),
  cloudflare: CloudflareDeployConfigSchema.optional(),
  vercel: VercelDeployConfigSchema.optional(),
  aws: AwsDeployConfigSchema.optional(),
});

// ---------------------------------------------------------------------------
// Modules — named capabilities with local Docker implementations.
// Each module type maps to a platform-native equivalent at deploy time.
//
//   database  → Postgres container | CF D1 | Vercel Postgres | AWS RDS
//   cache     → Redis container    | CF KV | Upstash Redis   | AWS ElastiCache
//   queue     → Kafka container    | CF Queues | Upstash QStash | AWS SQS
// ---------------------------------------------------------------------------

export const DatabaseModuleSchema = z.object({
  engine: z.enum(["postgres", "redis", "postgres-redis", "none"]).default("postgres"),
});

export const ModulesSchema = z.object({
  database: DatabaseModuleSchema.optional(),
});

// ---------------------------------------------------------------------------
// Pipeline (CI)
// ---------------------------------------------------------------------------

export const PipelineConfigSchema = z.object({
  parallelTests: z.boolean().optional(),
  securityScan: z.boolean().optional(),
  buildCache: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

export const PluginInstanceSchema = z.object({
  type: z.string(),
  instance: z.string(),
});

export const PluginConfigSchema = z.object({
  mode: z.string().optional(),
  port: z.number().optional(),
  events_topic: z.string().optional(),
  predictions_topic: z.string().optional(),
});

// ---------------------------------------------------------------------------
// API codegen config
// ---------------------------------------------------------------------------

export const ApiGenerateClientSchema = z.object({
  language: z.enum(["typescript", "python", "kotlin"]).default("typescript"),
  output: z.string(),
});

export const ApiGenerateServerSchema = z.object({
  framework: z.enum(["spring-boot", "fastapi", "express"]).default("spring-boot"),
  output: z.string(),
  package: z.string().optional(),
});

export const ApiGenerateTypesSchema = z.object({
  output: z.string(),
  runtime: z.enum(["zod", "none"]).default("none"),
});

export const ApiGenerateSchema = z.object({
  client: ApiGenerateClientSchema.optional(),
  server: ApiGenerateServerSchema.optional(),
  types: ApiGenerateTypesSchema.optional(),
});

export const ApiConfigSchema = z.object({
  spec: z.string(),
  generate: ApiGenerateSchema.optional(),
});

// ---------------------------------------------------------------------------
// Root project config (blissful-infra.yaml) — legacy flat model
// ---------------------------------------------------------------------------

export const ProjectConfigSchema = z.object({
  name: z.string(),
  backend: z.string().optional(),
  frontend: z.string().optional(),
  // Legacy flat field — prefer modules.database going forward
  database: z.string().optional(),
  deploy: DeployConfigSchema.optional(),
  modules: ModulesSchema.optional(),
  pipeline: PipelineConfigSchema.optional(),
  monitoring: z.enum(["default", "prometheus"]).optional(),
  plugins: z.array(PluginInstanceSchema).optional(),
  pluginConfigs: z.record(z.string(), PluginConfigSchema).optional(),
  api: ApiConfigSchema.optional(),
});

// ---------------------------------------------------------------------------
// Client environment model — per-client isolation with shared infrastructure
// ---------------------------------------------------------------------------

export const ObservabilityConfigSchema = z.object({
  prometheus: z.boolean().default(true),
  grafana: z.boolean().default(true),
  jaeger: z.boolean().default(true),
  loki: z.boolean().default(true),
  // Note: `clickhouse` here is legacy (was nested under observability before
  // ADR-0008 promoted it to a top-level infra component). Kept for backwards
  // compatibility on existing client configs; new code reads
  // ClientInfrastructure.clickhouse instead.
  clickhouse: z.boolean().default(false),
});

export const ClientInfrastructureSchema = z.object({
  kafka: z.boolean().default(true),
  postgres: z.boolean().default(true),
  jenkins: z.boolean().default(true),
  observability: ObservabilityConfigSchema.optional(),
  // Promoted to client-level platform services (ADR-0008, 0009, 0010).
  // All default to `false` — opt-in to keep the lightweight default footprint
  // small. `client create` interactive prompt + flags drive these.
  clickhouse: z.boolean().default(false),  // ADR-0008
  localstack: z.boolean().default(false),  // ADR-0008
  keycloak:   z.boolean().default(false),  // ADR-0009
  mlflow:     z.boolean().default(false),  // ADR-0010
  mage:       z.boolean().default(false),  // ADR-0010
});

export const ClientServiceRefSchema = z.object({
  name: z.string(),
  path: z.string(),
});

export const ClientConfigSchema = z.object({
  type: z.literal("client"),
  name: z.string(),
  infrastructure: ClientInfrastructureSchema.optional(),
  plugins: z.array(PluginInstanceSchema).optional(),
  deploy: DeployConfigSchema.optional(),
  services: z.array(ClientServiceRefSchema).optional(),
});

export const ServiceConfigSchema = z.object({
  type: z.literal("service"),
  name: z.string(),
  client: z.string(),
  backend: z.string().optional(),
  frontend: z.string().optional(),
  plugins: z.array(PluginInstanceSchema).optional(),
});

// ---------------------------------------------------------------------------
// Port block allocation — deterministic port assignment per client
// ---------------------------------------------------------------------------

export const PortBlockSchema = z.object({
  clientName: z.string(),
  blockIndex: z.number(),
  jenkins: z.number(),
  grafana: z.number(),
  prometheus: z.number(),
  jaeger: z.number(),
  kafka: z.number(),
  postgres: z.number(),
  dashboard: z.number(),
  // Optional — only populated when the client has the corresponding
  // infrastructure component enabled. Older registry entries without these
  // fields remain valid (the schema's optional() makes them non-breaking).
  clickhouse: z.number().optional(),  // ADR-0008
  localstack: z.number().optional(),  // ADR-0008
  keycloak:   z.number().optional(),  // ADR-0009
  mlflow:     z.number().optional(),  // ADR-0010
  mage:       z.number().optional(),  // ADR-0010
});

export const ClientRegistrySchema = z.object({
  clients: z.record(z.string(), PortBlockSchema),
  nextBlockIndex: z.number().default(0),
});

// ---------------------------------------------------------------------------
// Lambda manifest — drives both local (LocalStack) deploy and future cloud deploy
// ---------------------------------------------------------------------------

export const LambdaRuntimeSchema = z.enum([
  "python3.11",
  "python3.12",
  "nodejs20.x",
  "nodejs22.x",
  "java21",
  "go1.x",
]);

export const LambdaManifestSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/, "lowercase alphanumeric with hyphens"),
  runtime: LambdaRuntimeSchema,
  handler: z.string(),
  timeout_seconds: z.number().int().positive().max(900).default(30),
  memory_mb: z.number().int().min(128).max(10240).default(256),
  environment: z.record(z.string(), z.string()).optional(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type DeployTarget = z.infer<typeof DeployTargetSchema>;
export type DeployConfig = z.infer<typeof DeployConfigSchema>;
export type CloudflareDeployConfig = z.infer<typeof CloudflareDeployConfigSchema>;
export type VercelDeployConfig = z.infer<typeof VercelDeployConfigSchema>;
export type AwsDeployConfig = z.infer<typeof AwsDeployConfigSchema>;
export type DatabaseModule = z.infer<typeof DatabaseModuleSchema>;
export type Modules = z.infer<typeof ModulesSchema>;
export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;
export type PluginInstance = z.infer<typeof PluginInstanceSchema>;
export type PluginConfig = z.infer<typeof PluginConfigSchema>;
export type ApiGenerateClient = z.infer<typeof ApiGenerateClientSchema>;
export type ApiGenerateServer = z.infer<typeof ApiGenerateServerSchema>;
export type ApiGenerateTypes = z.infer<typeof ApiGenerateTypesSchema>;
export type ApiGenerate = z.infer<typeof ApiGenerateSchema>;
export type ApiConfig = z.infer<typeof ApiConfigSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type ObservabilityConfig = z.infer<typeof ObservabilityConfigSchema>;
export type ClientInfrastructure = z.infer<typeof ClientInfrastructureSchema>;
export type ClientServiceRef = z.infer<typeof ClientServiceRefSchema>;
export type ClientConfig = z.infer<typeof ClientConfigSchema>;
export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;
export type PortBlock = z.infer<typeof PortBlockSchema>;
export type ClientRegistry = z.infer<typeof ClientRegistrySchema>;
export type LambdaRuntime = z.infer<typeof LambdaRuntimeSchema>;
export type LambdaManifest = z.infer<typeof LambdaManifestSchema>;
