import { z } from "zod";
import { NameSchema } from "./roles.js";
import { TenantPortBlockSchema } from "./tenant.js";
import { ProjectPortBlockSchema } from "./project.js";
import { ServicePortsSchema } from "./service-v2.js";

/**
 * On-disk registry at ~/.blissful-infra/registry.json. Replaces the old flat
 * `clients[]` shape with a three-level nested structure that matches the
 * tenant/project/service hierarchy. See ADR-0017.
 *
 * The registry is the single source of truth for port allocation. Every read
 * goes through it. Tests override the location via the BLISSFUL_HOME env var.
 */

export const RegistryServiceEntrySchema = z.object({
  name:  NameSchema,
  type:  z.enum(["backend", "frontend", "worker"]),
  ports: ServicePortsSchema,
});

export const RegistryProjectEntrySchema = z.object({
  name:       NameSchema,
  portBlock:  ProjectPortBlockSchema,
  services:   z.array(RegistryServiceEntrySchema).default([]),
});

export const RegistryTenantEntrySchema = z.object({
  name:      NameSchema,
  portBlock: TenantPortBlockSchema,
  projects:  z.array(RegistryProjectEntrySchema).default([]),
});

export const TenantRegistrySchema = z.object({
  /** Bumped when the structure changes — let the loader auto-migrate. */
  version: z.literal(1).default(1),
  tenants: z.array(RegistryTenantEntrySchema).default([]),
});

export type RegistryServiceEntry = z.infer<typeof RegistryServiceEntrySchema>;
export type RegistryProjectEntry = z.infer<typeof RegistryProjectEntrySchema>;
export type RegistryTenantEntry  = z.infer<typeof RegistryTenantEntrySchema>;
export type TenantRegistry       = z.infer<typeof TenantRegistrySchema>;
