import { z } from "zod";
import { NameSchema, RolesSchema } from "./roles.js";

/** Postgres-style identifier: lowercase alphanumeric + underscores. Used for
 *  the per-service auto-allocated schema, where snake_case is the SQL norm. */
const PostgresIdentifierSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9_]+$/, "Lowercase alphanumeric and underscores only");

/**
 * Service = one process / one container family. Per ADR-0017 a service is an
 * atomic deployable. A "backend + frontend app" is two services, not one.
 *
 * Each service is exactly one of: `backend`, `frontend`, or `worker`. The
 * `--type` flag picks which, and the corresponding nested config block
 * determines the template / runtime. Other-typed blocks must be absent.
 *
 * Each service auto-receives:
 *   - A dedicated Postgres schema on the project's shared instance
 *     (DDD: per-bounded-context data).
 *   - Kafka producer/consumer credentials for the project's broker.
 *   - A spot behind the project's API gateway if exposed.
 *
 * Service configuration lives at:
 *   ~/.blissful-infra/tenants/<tenant>/projects/<project>/services/<service>/service.yaml
 *
 * Schema file is named `service-v2.ts` to avoid collision with the legacy
 * ServiceConfig in config.ts. Phase 8 deletes the legacy and renames to
 * `service.ts`.
 */

export const ServiceTypeSchema = z.enum(["backend", "frontend", "worker"]);

export const BackendTemplateSchema = z.enum(["spring-boot", "lambda-python"]);
export const FrontendTemplateSchema = z.enum(["react-vite"]);
export const WorkerRuntimeSchema = z.enum(["python", "node", "go"]);

export const BackendBlockSchema = z.object({
  template: BackendTemplateSchema,
});

export const FrontendBlockSchema = z.object({
  template: FrontendTemplateSchema,
});

export const WorkerBlockSchema = z.object({
  runtime: WorkerRuntimeSchema,
});

/**
 * Optional binding to the project's shared Postgres. Absent for stateless
 * services (most frontends, some workers). The schema name is auto-generated
 * from the service name at scaffold time; the user can override.
 */
export const ServiceDatabaseSchema = z.object({
  /** Postgres schema name (snake_case). Defaults to the service name with
   *  hyphens converted to underscores at scaffold time. */
  schema: PostgresIdentifierSchema,
  /** Whether to run migrations on startup (Flyway, Alembic, etc.). */
  migrations: z.boolean().default(true),
});

export const ServiceConfigV2Schema = z.object({
  type: z.literal("service"),
  name: NameSchema,
  /** Parent tenant. */
  tenant: NameSchema,
  /** Parent project. */
  project: NameSchema,
  /** Which kind of service this is. Exactly one nested block must match. */
  serviceType: ServiceTypeSchema,
  backend:  BackendBlockSchema.optional(),
  frontend: FrontendBlockSchema.optional(),
  worker:   WorkerBlockSchema.optional(),
  /** Auto-provisioned per-service Postgres schema. */
  database: ServiceDatabaseSchema.optional(),
  /** Service-scoped plugins (gatling, agent-service, etc.). */
  plugins: z.array(z.string()).default([]),
  /** Per-service role overrides. Inherits project + tenant roles if unset. */
  roles: RolesSchema.optional(),
}).superRefine((s, ctx) => {
  // Exactly the matching nested block must be present, none of the others.
  const expected = s.serviceType;
  const blocks: Record<string, unknown> = {
    backend: s.backend,
    frontend: s.frontend,
    worker: s.worker,
  };
  for (const [key, value] of Object.entries(blocks)) {
    if (key === expected && value == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `serviceType is '${expected}' but '${key}' block is missing`,
      });
    }
    if (key !== expected && value != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `'${key}' block is set but serviceType is '${expected}'`,
      });
    }
  }
});

/**
 * Per-service ports. A service typically exposes one HTTP port (backend or
 * frontend) and an optional metrics port. Workers usually expose nothing.
 */
export const ServicePortsSchema = z.object({
  tenant:  NameSchema,
  project: NameSchema,
  service: NameSchema,
  http:    z.number().int().positive().optional(),
  metrics: z.number().int().positive().optional(),
});

export type ServiceType       = z.infer<typeof ServiceTypeSchema>;
export type BackendTemplate   = z.infer<typeof BackendTemplateSchema>;
export type FrontendTemplate  = z.infer<typeof FrontendTemplateSchema>;
export type WorkerRuntime     = z.infer<typeof WorkerRuntimeSchema>;
export type BackendBlock      = z.infer<typeof BackendBlockSchema>;
export type FrontendBlock     = z.infer<typeof FrontendBlockSchema>;
export type WorkerBlock       = z.infer<typeof WorkerBlockSchema>;
export type ServiceDatabase   = z.infer<typeof ServiceDatabaseSchema>;
export type ServiceConfigV2   = z.infer<typeof ServiceConfigV2Schema>;
export type ServicePorts      = z.infer<typeof ServicePortsSchema>;
