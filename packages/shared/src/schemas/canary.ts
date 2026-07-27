import { z } from "zod";

/**
 * Canary rollout status surfaced by the dashboard's Environments tab.
 * Mirrors the RolloutStatus shape parsed from `kubectl argo rollouts status`
 * (packages/cli/src/utils/rollouts.ts).
 */
export const CanaryStatusSchema = z.object({
  service: z.string(),
  project: z.string(),
  /** Rollout phase: Healthy | Progressing | Paused | Degraded | Unknown */
  status: z.string(),
  step: z.number().int().nonnegative(),
  totalSteps: z.number().int().nonnegative(),
  /** Percent of traffic on the canary (0-100). */
  currentWeight: z.number().int().min(0).max(100),
  message: z.string().optional(),
});

export const CanaryActionSchema = z.enum(["promote", "promote-full", "abort", "pause", "resume"]);

export type CanaryStatus = z.infer<typeof CanaryStatusSchema>;
export type CanaryAction = z.infer<typeof CanaryActionSchema>;
