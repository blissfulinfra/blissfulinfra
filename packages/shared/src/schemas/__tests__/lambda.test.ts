import { describe, it, expect } from "vitest";
import { LambdaManifestSchema } from "../config.js";

describe("LambdaManifestSchema", () => {
  it("accepts the minimal valid manifest", () => {
    const r = LambdaManifestSchema.safeParse({
      name: "hello",
      runtime: "python3.11",
      handler: "handler.lambda_handler",
    });
    expect(r.success).toBe(true);
    // Defaults filled in
    if (r.success) {
      expect(r.data.timeout_seconds).toBe(30);
      expect(r.data.memory_mb).toBe(256);
    }
  });

  it("accepts a full manifest with environment", () => {
    const r = LambdaManifestSchema.safeParse({
      name: "hello",
      runtime: "python3.11",
      handler: "handler.lambda_handler",
      timeout_seconds: 60,
      memory_mb: 512,
      environment: { GREETING: "hi", LOG_LEVEL: "debug" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects names with uppercase / spaces", () => {
    expect(LambdaManifestSchema.safeParse({
      name: "Hello World",
      runtime: "python3.11",
      handler: "handler.lambda_handler",
    }).success).toBe(false);
  });

  it("rejects unknown runtimes", () => {
    expect(LambdaManifestSchema.safeParse({
      name: "hello",
      runtime: "python2.7",   // not in our supported list
      handler: "handler.lambda_handler",
    }).success).toBe(false);
  });

  it("rejects out-of-range timeouts (max 900s = 15min)", () => {
    expect(LambdaManifestSchema.safeParse({
      name: "hello", runtime: "python3.11", handler: "h.h",
      timeout_seconds: 901,
    }).success).toBe(false);
  });

  it("rejects out-of-range memory (must be 128–10240)", () => {
    expect(LambdaManifestSchema.safeParse({
      name: "hello", runtime: "python3.11", handler: "h.h",
      memory_mb: 64,
    }).success).toBe(false);
    expect(LambdaManifestSchema.safeParse({
      name: "hello", runtime: "python3.11", handler: "h.h",
      memory_mb: 99999,
    }).success).toBe(false);
  });

  it("rejects environment values that aren't strings", () => {
    expect(LambdaManifestSchema.safeParse({
      name: "hello", runtime: "python3.11", handler: "h.h",
      environment: { count: 5 },   // numbers not allowed (Lambda env vars are strings)
    }).success).toBe(false);
  });
});
