import { describe, it, expect } from "vitest";
import type { ClientInfrastructure } from "@blissful-infra/shared";
import {
  diffInfraDeps,
  aggregateInfraDeps,
  resolveServiceManifests,
  TEMPLATE_INFRA_MANIFESTS,
  PLUGIN_INFRA_MANIFESTS,
  type InfraManifest,
} from "../infra-deps.js";

const FULL_INFRA: ClientInfrastructure = {
  kafka: true,
  postgres: true,
  jenkins: true,
  clickhouse: true,
  localstack: true,
  keycloak: true,
  mlflow: true,
  mage: true,
  observability: { prometheus: true, grafana: true, jaeger: true, loki: true, clickhouse: true },
};

const MINIMAL_INFRA: ClientInfrastructure = {
  kafka: false,
  postgres: false,
  jenkins: false,
  clickhouse: false,
  localstack: false,
  keycloak: false,
  mlflow: false,
  mage: false,
  observability: { prometheus: false, grafana: false, jaeger: false, loki: false, clickhouse: false },
};

describe("diffInfraDeps", () => {
  it("returns empty diff when client has every required + optional component", () => {
    const manifest: InfraManifest = {
      requires: [{ component: "postgres", reason: "JPA" }],
      optional: [{ component: "localstack", reason: "S3 uploads" }],
    };
    const diff = diffInfraDeps(manifest, FULL_INFRA);
    expect(diff.missingRequired).toEqual([]);
    expect(diff.missingOptional).toEqual([]);
  });

  it("flags required deps that the client doesn't have", () => {
    const manifest: InfraManifest = {
      requires: [
        { component: "postgres", reason: "JPA" },
        { component: "kafka", reason: "events" },
      ],
    };
    const diff = diffInfraDeps(manifest, MINIMAL_INFRA);
    expect(diff.missingRequired.map(d => d.component).sort()).toEqual(["kafka", "postgres"]);
  });

  it("flags optional deps that the client doesn't have", () => {
    const manifest: InfraManifest = {
      optional: [
        { component: "localstack", reason: "S3" },
        { component: "keycloak", reason: "OIDC" },
      ],
    };
    const diff = diffInfraDeps(manifest, MINIMAL_INFRA);
    expect(diff.missingOptional.map(d => d.component).sort()).toEqual(["keycloak", "localstack"]);
  });

  it("treats undefined client infra as everything missing", () => {
    const manifest: InfraManifest = {
      requires: [{ component: "postgres", reason: "JPA" }],
      optional: [{ component: "localstack", reason: "S3" }],
    };
    const diff = diffInfraDeps(manifest, undefined);
    expect(diff.missingRequired).toHaveLength(1);
    expect(diff.missingOptional).toHaveLength(1);
  });

  it("reads observability sub-keys from the nested block", () => {
    const partial: ClientInfrastructure = {
      ...MINIMAL_INFRA,
      observability: { prometheus: true, grafana: false, jaeger: false, loki: false, clickhouse: false },
    };
    const diff = diffInfraDeps(
      { requires: [{ component: "prometheus", reason: "metrics" }, { component: "grafana", reason: "viz" }] },
      partial,
    );
    expect(diff.missingRequired.map(d => d.component)).toEqual(["grafana"]);
  });
});

describe("aggregateInfraDeps", () => {
  it("merges multiple manifests and dedupes by component", () => {
    const m1: InfraManifest = { requires: [{ component: "postgres", reason: "A" }] };
    const m2: InfraManifest = { requires: [{ component: "postgres", reason: "B" }, { component: "kafka", reason: "C" }] };
    const merged = aggregateInfraDeps([m1, m2]);
    expect(merged.requires?.map(d => d.component)).toEqual(["postgres", "kafka"]);
    // First-seen reason wins
    expect(merged.requires?.find(d => d.component === "postgres")?.reason).toBe("A");
  });

  it("promotes optional → required when same component appears in both lists", () => {
    const m1: InfraManifest = { optional: [{ component: "localstack", reason: "S3" }] };
    const m2: InfraManifest = { requires: [{ component: "localstack", reason: "Lambda runtime" }] };
    const merged = aggregateInfraDeps([m1, m2]);
    expect(merged.requires?.map(d => d.component)).toEqual(["localstack"]);
    expect(merged.optional ?? []).toEqual([]);
  });

  it("handles empty input", () => {
    expect(aggregateInfraDeps([])).toEqual({ requires: [], optional: [] });
  });
});

describe("resolveServiceManifests", () => {
  it("looks up backend, frontend and plugins by name", () => {
    const manifests = resolveServiceManifests({
      backend: "spring-boot",
      frontend: "react-vite",
      plugins: [{ type: "ai-pipeline" }],
    });
    expect(manifests).toContain(TEMPLATE_INFRA_MANIFESTS["spring-boot"]);
    expect(manifests).toContain(TEMPLATE_INFRA_MANIFESTS["react-vite"]);
    expect(manifests).toContain(PLUGIN_INFRA_MANIFESTS["ai-pipeline"]);
  });

  it("ignores unknown names without throwing", () => {
    const manifests = resolveServiceManifests({
      backend: "ghost-backend",
      plugins: [{ type: "ghost-plugin" }],
    });
    expect(manifests).toEqual([]);
  });
});

describe("manifest registry coverage", () => {
  // Guardrail: every shipped backend/frontend template must have a manifest
  // entry, even an empty one. This keeps people honest when they add a new
  // template and forget to declare its infra needs.
  const SHIPPED_TEMPLATES = ["spring-boot", "lambda-python", "react-vite"];

  for (const name of SHIPPED_TEMPLATES) {
    it(`has a manifest entry for shipped template '${name}'`, () => {
      expect(TEMPLATE_INFRA_MANIFESTS[name]).toBeDefined();
    });
  }

  const SHIPPED_PLUGINS = ["ai-pipeline", "agent-service", "gatling"];

  for (const name of SHIPPED_PLUGINS) {
    it(`has a manifest entry for shipped plugin '${name}'`, () => {
      expect(PLUGIN_INFRA_MANIFESTS[name]).toBeDefined();
    });
  }
});
