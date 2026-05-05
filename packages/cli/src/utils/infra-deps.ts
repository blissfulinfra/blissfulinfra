import { normalizePostgresInstances, type ClientInfrastructure } from "@blissful-infra/shared";

/**
 * The set of client-level infrastructure components a template or plugin can
 * declare a dependency on. Mirrors the keys in
 * `ClientInfrastructureSchema` (kafka, postgres, jenkins, clickhouse, ...)
 * plus the named observability sub-flags so a manifest can require Prometheus
 * specifically without pulling in Jaeger.
 */
export type InfraComponent =
  | "kafka"
  | "postgres"
  | "jenkins"
  | "clickhouse"
  | "localstack"
  | "keycloak"
  | "mlflow"
  | "mage"
  | "prometheus"
  | "grafana"
  // ADR-0016: tempo is the canonical tracing component; jaeger is a
  // deprecated alias kept on the type union for back-compat with manifests
  // and CLI invocations that still use the old name.
  | "tempo"
  | "jaeger"
  | "loki";

export interface PostgresBinding {
  /** Instance name. Defaults to `default`. */
  instance?: string;
  /** Databases to ensure exist on the named instance (CREATE DATABASE if missing). */
  databases?: string[];
}

export interface InfraDep {
  component: InfraComponent;
  reason: string;
  /**
   * Component-specific binding. Currently only `postgres` carries one
   * (ADR-0014: which instance + which databases). Other components ignore
   * this field.
   */
  postgres?: PostgresBinding;
}

export interface InfraManifest {
  requires?: InfraDep[];
  optional?: InfraDep[];
}

/**
 * Backend / frontend template manifests. Keys match `--backend` / `--frontend`
 * choice values exactly. When you add a new template, add its manifest here —
 * the L2 test in `infra-deps.test.ts` asserts every shipped template has an
 * entry, so a forgotten manifest fails before integration tests run.
 */
export const TEMPLATE_INFRA_MANIFESTS: Record<string, InfraManifest> = {
  "spring-boot": {
    requires: [
      {
        component: "postgres",
        reason: "JPA persistence + Flyway migrations",
        postgres: { instance: "default" },
      },
    ],
    optional: [
      { component: "localstack", reason: "S3 file uploads via /api/files endpoint" },
      { component: "keycloak",   reason: "JWT auth on protected routes" },
    ],
  },
  "lambda-python": {
    requires: [
      { component: "localstack", reason: "Lambda runtime + invoke API (LocalStack hosts the function)" },
    ],
  },
  "react-vite": {
    optional: [
      { component: "keycloak", reason: "OIDC login flow on /login" },
    ],
  },
};

/**
 * Plugin manifests. Keys match the plugin `type` field.
 */
export const PLUGIN_INFRA_MANIFESTS: Record<string, InfraManifest> = {
  "ai-pipeline": {
    // ADR-0010: ai-pipeline now consumes the client-level versions of these
    // services rather than co-deploying its own. ClickHouse + MLflow are
    // required because the FastAPI service connects to them on startup;
    // Mage is optional (it's a separate orchestrator UI, not consumed by
    // the FastAPI service code).
    requires: [
      { component: "kafka",      reason: "consumes events produced by the backend" },
      { component: "clickhouse", reason: "stores model predictions in the client warehouse" },
      { component: "mlflow",     reason: "tracks experiments + registers trained models" },
    ],
    optional: [
      { component: "mage", reason: "visual orchestration of the data pipeline" },
    ],
  },
  "agent-service": {},
  "gatling": {},
};

export interface InfraDepsDiff {
  /** Required components the client doesn't have enabled. */
  missingRequired: InfraDep[];
  /** Optional components the client doesn't have enabled. */
  missingOptional: InfraDep[];
}

/**
 * Resolve the lookup for an infra component against a client config. The
 * top-level keys (kafka, postgres, jenkins, ...) read directly. The
 * observability sub-keys (prometheus, grafana, jaeger, loki) read from the
 * nested `observability` block — they default to true when the block is
 * absent (legacy configs).
 */
function isComponentEnabled(infra: ClientInfrastructure | undefined, c: InfraComponent): boolean {
  if (!infra) return false;
  switch (c) {
    case "kafka":      return infra.kafka === true;
    // ADR-0014 — postgres can be a boolean or a list of instances. The
    // dependency `postgres` is satisfied when at least one instance exists.
    case "postgres":   return normalizePostgresInstances(infra.postgres).length > 0;
    case "jenkins":    return infra.jenkins === true;
    case "clickhouse": return infra.clickhouse === true;
    case "localstack": return infra.localstack === true;
    case "keycloak":   return infra.keycloak === true;
    case "mlflow":     return infra.mlflow === true;
    case "mage":       return infra.mage === true;
    case "prometheus":
    case "grafana":
    case "loki":
      return infra.observability?.[c] === true;
    case "tempo":
    case "jaeger":
      // ADR-0016: either flag satisfies a tempo/jaeger dep, since the
      // legacy `jaeger: true` config still spawns a Tempo container.
      return infra.observability?.tempo === true || infra.observability?.jaeger === true;
  }
}

/**
 * Diff a manifest against the current client infrastructure config.
 * Components that are required AND enabled drop out of the diff entirely.
 */
export function diffInfraDeps(
  manifest: InfraManifest,
  clientInfra: ClientInfrastructure | undefined,
): InfraDepsDiff {
  return {
    missingRequired: (manifest.requires ?? []).filter(d => !isComponentEnabled(clientInfra, d.component)),
    missingOptional: (manifest.optional ?? []).filter(d => !isComponentEnabled(clientInfra, d.component)),
  };
}

/**
 * Merge multiple manifests (e.g. backend + frontend + plugins) into one.
 * Required deps win over optional when the same component appears in both —
 * a component required by anything is required overall. Deduped by component.
 */
export function aggregateInfraDeps(manifests: InfraManifest[]): InfraManifest {
  const requires: InfraDep[] = [];
  const optional: InfraDep[] = [];
  const seenRequired = new Set<InfraComponent>();
  const seenOptional = new Set<InfraComponent>();

  for (const m of manifests) {
    for (const dep of m.requires ?? []) {
      if (seenRequired.has(dep.component)) continue;
      requires.push(dep);
      seenRequired.add(dep.component);
    }
  }
  for (const m of manifests) {
    for (const dep of m.optional ?? []) {
      if (seenRequired.has(dep.component)) continue; // already required, skip optional
      if (seenOptional.has(dep.component)) continue;
      optional.push(dep);
      seenOptional.add(dep.component);
    }
  }

  return { requires, optional };
}

/**
 * Helper for callers: build a manifest list from a service's chosen
 * backend/frontend/plugins. Looks up each by name and returns the array.
 * Unknown names contribute nothing — the CLI will surface those separately.
 */
export function resolveServiceManifests(opts: {
  backend?: string;
  frontend?: string;
  plugins?: { type: string }[];
}): InfraManifest[] {
  const manifests: InfraManifest[] = [];
  if (opts.backend && TEMPLATE_INFRA_MANIFESTS[opts.backend]) {
    manifests.push(TEMPLATE_INFRA_MANIFESTS[opts.backend]);
  }
  if (opts.frontend && TEMPLATE_INFRA_MANIFESTS[opts.frontend]) {
    manifests.push(TEMPLATE_INFRA_MANIFESTS[opts.frontend]);
  }
  for (const p of opts.plugins ?? []) {
    if (PLUGIN_INFRA_MANIFESTS[p.type]) manifests.push(PLUGIN_INFRA_MANIFESTS[p.type]);
  }
  return manifests;
}
