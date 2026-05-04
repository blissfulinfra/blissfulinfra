import { describe, it, expect } from "vitest";
import { applyInfraFlagEdit } from "../client-config-edit.js";

const SAMPLE_YAML = `type: client
name: acme

infrastructure:
  kafka: true
  postgres: true
  jenkins: true
  clickhouse: false
  localstack: false
  keycloak: false
  mlflow: false
  mage: false
  observability:
    prometheus: true
    grafana: true
    jaeger: true
    loki: true
    clickhouse: false

plugins: []

deploy:
  target: local-only

services: []
`;

describe("applyInfraFlagEdit", () => {
  it("flips an existing top-level flag from false to true", () => {
    const out = applyInfraFlagEdit(SAMPLE_YAML, "localstack", true);
    expect(out).toContain("  localstack: true");
    expect(out).not.toContain("  localstack: false");
  });

  it("flips an existing top-level flag from true to false", () => {
    const out = applyInfraFlagEdit(SAMPLE_YAML, "kafka", false);
    expect(out).toContain("  kafka: false");
    expect(out).not.toMatch(/^ {2}kafka: true$/m);
  });

  it("leaves the file unchanged when the value already matches", () => {
    const out = applyInfraFlagEdit(SAMPLE_YAML, "postgres", true);
    expect(out).toBe(SAMPLE_YAML);
  });

  it("flips an observability sub-key without affecting top-level flags", () => {
    const out = applyInfraFlagEdit(SAMPLE_YAML, "jaeger", false);
    expect(out).toContain("    jaeger: false");
    expect(out).toContain("  kafka: true"); // top-level kafka untouched
  });

  it("inserts a missing top-level flag under `infrastructure:` block", () => {
    const yamlWithoutMage = SAMPLE_YAML.replace(/^  mage: false\n/m, "");
    const out = applyInfraFlagEdit(yamlWithoutMage, "mage", true);
    expect(out).toMatch(/^infrastructure:\n {2}mage: true/m);
  });

  it("does not double-insert when re-running with the same value", () => {
    const yamlWithoutMage = SAMPLE_YAML.replace(/^  mage: false\n/m, "");
    const once = applyInfraFlagEdit(yamlWithoutMage, "mage", true);
    const twice = applyInfraFlagEdit(once, "mage", true);
    expect(twice).toBe(once);
  });
});
