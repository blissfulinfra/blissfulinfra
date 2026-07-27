import { describe, it, expect } from "vitest";
import { CanaryStatusSchema, CanaryActionSchema } from "../canary.js";

describe("CanaryStatusSchema", () => {
  it("accepts a mid-rollout status", () => {
    const r = CanaryStatusSchema.safeParse({
      service: "orders-api",
      project: "shop",
      status: "Paused",
      step: 2,
      totalSteps: 7,
      currentWeight: 25,
      message: "CanaryPauseStep",
    });
    expect(r.success).toBe(true);
  });

  it("rejects weights outside 0-100", () => {
    const r = CanaryStatusSchema.safeParse({
      service: "orders-api", project: "shop", status: "Progressing",
      step: 1, totalSteps: 7, currentWeight: 120,
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative steps", () => {
    const r = CanaryStatusSchema.safeParse({
      service: "orders-api", project: "shop", status: "Progressing",
      step: -1, totalSteps: 7, currentWeight: 10,
    });
    expect(r.success).toBe(false);
  });
});

describe("CanaryActionSchema", () => {
  it("accepts every dashboard action", () => {
    for (const action of ["promote", "promote-full", "abort", "pause", "resume"]) {
      expect(CanaryActionSchema.safeParse(action).success).toBe(true);
    }
  });

  it("rejects unknown actions", () => {
    expect(CanaryActionSchema.safeParse("yolo").success).toBe(false);
  });
});
