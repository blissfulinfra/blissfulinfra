import { z } from "zod";
import { NameSchema, RolesSchema } from "./roles.js";

/**
 * Tenant = the organisation (or solo dev, or studio) that owns one isolated
 * blissful-infra environment. Per ADR-0017 the tenant owns:
 *
 *   - The dashboard, Jenkins, and observability stack (Prometheus, Grafana,
 *     Tempo, Loki). These are cross-project resources.
 *   - The port block. Every project + service inside this tenant gets ports
 *     sub-allocated from the tenant's range.
 *   - Top-level roles. Project- and service-level roles inherit from here
 *     unless overridden.
 *
 * Tenant configuration lives at:
 *   ~/.blissful-infra/tenants/<tenant>/tenant.yaml
 */

export const TenantObservabilitySchema = z.object({
  prometheus: z.boolean().default(true),
  grafana:    z.boolean().default(true),
  tempo:      z.boolean().default(true),
  loki:       z.boolean().default(true),
});

export const TenantInfrastructureSchema = z.object({
  /** Whether to run a tenant-level Jenkins for CI/CD across all projects. */
  jenkins:       z.boolean().default(true),
  /** Observability stack — runs at the tenant level so projects share dashboards. */
  observability: TenantObservabilitySchema.default({
    prometheus: true, grafana: true, tempo: true, loki: true,
  }),
});

export const TenantProjectRefSchema = z.object({
  /** Project name (matches the directory at tenants/<tenant>/projects/<name>). */
  name: NameSchema,
  /** Path relative to the tenant directory (typically "projects/<name>"). */
  path: z.string(),
});

export const TenantConfigSchema = z.object({
  type: z.literal("tenant"),
  name: NameSchema,
  infrastructure: TenantInfrastructureSchema.default({
    jenkins: true,
    observability: { prometheus: true, grafana: true, tempo: true, loki: true },
  }),
  roles: RolesSchema.optional(),
  projects: z.array(TenantProjectRefSchema).default([]),
});

/**
 * Port block owned by this tenant. Tenants are sub-allocated from a base
 * range (3010+blockIndex*10 for tenant-level ports; project-level ports are
 * sub-allocated below). See ADR-0017 for the full scheme.
 */
export const TenantPortBlockSchema = z.object({
  tenant:     NameSchema,
  blockIndex: z.number().int().nonnegative(),
  /** Tenant-level service ports. */
  dashboard:  z.number().int().positive(),
  jenkins:    z.number().int().positive(),
  grafana:    z.number().int().positive(),
  prometheus: z.number().int().positive(),
  tempo:      z.number().int().positive(),
  loki:       z.number().int().positive(),
});

export type TenantConfig         = z.infer<typeof TenantConfigSchema>;
export type TenantInfrastructure = z.infer<typeof TenantInfrastructureSchema>;
export type TenantObservability  = z.infer<typeof TenantObservabilitySchema>;
export type TenantProjectRef     = z.infer<typeof TenantProjectRefSchema>;
export type TenantPortBlock      = z.infer<typeof TenantPortBlockSchema>;
