import { z } from "zod";

/**
 * Access-control roles at every level of the hierarchy (tenant, project,
 * service). Day-1 enforcement is permissive — the local dev sees everything.
 * The schema exists so the eventual access-control story (SSO, RBAC) doesn't
 * require another model change. See ADR-0017.
 */
export const RolesSchema = z.object({
  owners:     z.array(z.string()).optional(),
  developers: z.array(z.string()).optional(),
  marketers:  z.array(z.string()).optional(),
  viewers:    z.array(z.string()).optional(),
});

export type Roles = z.infer<typeof RolesSchema>;

/**
 * Re-used name-validation across all three levels. Identifiers must be
 * lowercase alphanumeric with hyphens — same constraint Docker imposes on
 * container names and Compose imposes on project names.
 */
export const NameSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9-]+$/, "Lowercase alphanumeric and hyphens only");
