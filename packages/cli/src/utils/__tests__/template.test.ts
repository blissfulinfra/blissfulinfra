import { describe, it, expect } from "vitest";
import { replaceVariables } from "../template.js";

describe("replaceVariables — IF_KEYCLOAK / IF_LOCALSTACK guards", () => {
  // ADRs 0008/0009: keycloak + localstack were promoted from per-service
  // plugins to client-level infrastructure. The template guards must fire
  // when EITHER source is enabled. Without this, templates ship without any
  // integration code even though the runtime container is up.
  const KC_BLOCK = "{{#IF_KEYCLOAK}}wired{{/IF_KEYCLOAK}}";
  const LS_BLOCK = "{{#IF_LOCALSTACK}}wired{{/IF_LOCALSTACK}}";

  const baseVars = {
    projectName: "api",
    database: "postgres",
    deployTarget: "local-only",
  };

  it("IF_KEYCLOAK fires when per-service plugin is set", () => {
    const out = replaceVariables(KC_BLOCK, { ...baseVars, plugins: ["keycloak"] });
    expect(out).toBe("wired");
  });

  it("IF_KEYCLOAK fires when client-level keycloak is enabled (post ADR-0009)", () => {
    const out = replaceVariables(KC_BLOCK, { ...baseVars, clientInfra: { keycloak: true } });
    expect(out).toBe("wired");
  });

  it("IF_KEYCLOAK is empty when neither source is set", () => {
    const out = replaceVariables(KC_BLOCK, baseVars);
    expect(out).toBe("");
  });

  it("IF_LOCALSTACK fires from either source (per-service plugin OR client-level)", () => {
    const fromPlugin = replaceVariables(LS_BLOCK, { ...baseVars, plugins: ["localstack"] });
    const fromClient = replaceVariables(LS_BLOCK, { ...baseVars, clientInfra: { localstack: true } });
    expect(fromPlugin).toBe("wired");
    expect(fromClient).toBe("wired");
  });
});

describe("replaceVariables — CLIENT_NAME / KEYCLOAK_REALM substitutions", () => {
  it("substitutes CLIENT_NAME and KEYCLOAK_REALM from clientName", () => {
    const tpl = "client={{CLIENT_NAME}} realm={{KEYCLOAK_REALM}}";
    const out = replaceVariables(tpl, {
      projectName: "api",
      database: "postgres",
      deployTarget: "local-only",
      clientName: "acme",
    });
    expect(out).toBe("client=acme realm=acme");
  });

  it("falls back to projectName when clientName is absent", () => {
    const out = replaceVariables("realm={{KEYCLOAK_REALM}}", {
      projectName: "api",
      database: "postgres",
      deployTarget: "local-only",
    });
    expect(out).toBe("realm=api");
  });
});
