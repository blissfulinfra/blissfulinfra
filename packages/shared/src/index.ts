export * from "./schemas/api.js";
export * from "./schemas/alerts.js";
export * from "./schemas/config.js";
export * from "./schemas/deployments.js";
export * from "./schemas/logs.js";
export * from "./schemas/metrics.js";
export * from "./schemas/plugins.js";
export * from "./schemas/ontology.js";

// Tenant / Project / Service hierarchy (ADR-0017). Replaces the legacy
// client/service flat-model schemas in config.ts — those are scheduled for
// deletion in Phase 8 of the refactor.
export * from "./schemas/roles.js";
export * from "./schemas/tenant.js";
export * from "./schemas/project.js";
export * from "./schemas/service-v2.js";
export * from "./schemas/tenant-registry.js";
