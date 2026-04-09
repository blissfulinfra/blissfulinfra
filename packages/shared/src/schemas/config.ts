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
// Root project config (blissful-infra.yaml)
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
