import { z } from "zod";
import { NameSchema, RolesSchema } from "./roles.js";

/**
 * Project = a bounded domain inside a tenant. Per ADR-0017 a project owns:
 *
 *   - The event bus: a Kafka instance whose topics are namespaced
 *     <project>.<event>. Services in other projects can't subscribe.
 *   - The shared Postgres instance. Each service inside the project gets its
 *     own *schema* on this instance (DDD: per-bounded-context data).
 *   - The API gateway: the single ingress point. Services aren't directly
 *     reachable from outside the project's network.
 *   - The Docker network. Services within the project can call each other
 *     by name; cross-project traffic must traverse the gateway.
 *
 * Project configuration lives at:
 *   ~/.blissful-infra/tenants/<tenant>/projects/<project>/project.yaml
 */

export const ProjectInfrastructureSchema = z.object({
  /** Kafka broker shared by services in this project. */
  kafka:    z.boolean().default(true),
  /** Postgres instance — each service gets its own schema, not its own DB. */
  postgres: z.boolean().default(true),
  /** Redis instance — shared cache + pub/sub. One per project. */
  redis:    z.boolean().default(true),
  /** API gateway routing external traffic to internal services. */
  gateway:  z.boolean().default(true),
});

export const ProjectServiceRefSchema = z.object({
  /** Service name (matches directory at projects/<project>/services/<name>). */
  name: NameSchema,
  /** Path relative to the project directory ("services/<name>"). */
  path: z.string(),
  /** Cached service type for quick discovery without reading service.yaml. */
  type: z.enum(["backend", "frontend", "worker"]),
});

export const ProjectConfigSchema = z.object({
  type: z.literal("project"),
  name: NameSchema,
  /** Parent tenant. Redundant with file path but explicit for portability. */
  tenant: NameSchema,
  infrastructure: ProjectInfrastructureSchema.default({
    kafka: true, postgres: true, redis: true, gateway: true,
  }),
  /** Domain owners, developers, etc. Inherits tenant roles if unset. */
  roles: RolesSchema.optional(),
  services: z.array(ProjectServiceRefSchema).default([]),
});

/**
 * Ports sub-allocated to this project from the parent tenant's block.
 * `projectIndex` is the project's position within the tenant (0, 1, 2...);
 * it deterministically offsets the project's ports from the tenant base so
 * collisions are impossible by construction.
 */
export const ProjectPortBlockSchema = z.object({
  tenant:       NameSchema,
  project:      NameSchema,
  projectIndex: z.number().int().nonnegative(),
  /** Project-level service ports. */
  kafka:        z.number().int().positive(),
  postgres:     z.number().int().positive(),
  redis:        z.number().int().positive(),
  gateway:      z.number().int().positive(),
});

export type ProjectConfig         = z.infer<typeof ProjectConfigSchema>;
export type ProjectInfrastructure = z.infer<typeof ProjectInfrastructureSchema>;
export type ProjectServiceRef     = z.infer<typeof ProjectServiceRefSchema>;
export type ProjectPortBlock      = z.infer<typeof ProjectPortBlockSchema>;
