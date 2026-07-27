import { z } from "zod";

export const DeploymentStatusSchema = z.enum(["running", "success", "failed"]);

export const DeploymentRecordSchema = z.object({
  id: z.string(),
  timestamp: z.number(),
  projectName: z.string(),
  gitSha: z.string(),
  status: DeploymentStatusSchema,
  latencyBefore: z.number().optional(),
  latencyAfter: z.number().optional(),
  latencyDelta: z.number().optional(),
  regression: z.boolean(),
  jaegerTraceUrl: z.string().optional(),
  // Kubernetes-runtime deploys (additive — old JSONL rows stay valid).
  environment: z.string().optional(),
  imageTag: z.string().optional(),
  strategy: z.enum(["rolling", "canary"]).optional(),
});

/** Body POSTed by the Jenkinsfile when a deployment starts */
export const CreateDeploymentRequestSchema = z.object({
  gitSha: z.string(),
  status: DeploymentStatusSchema.optional().default("running"),
});

/** Body PATCHed by the Jenkinsfile on completion */
export const UpdateDeploymentRequestSchema = z.object({
  status: DeploymentStatusSchema.optional(),
  latencyAfter: z.number().optional(),
  latencyDelta: z.number().optional(),
  regression: z.boolean().optional(),
  jaegerTraceUrl: z.string().optional(),
});

export type DeploymentStatus = z.infer<typeof DeploymentStatusSchema>;
export type DeploymentRecord = z.infer<typeof DeploymentRecordSchema>;
export type CreateDeploymentRequest = z.infer<typeof CreateDeploymentRequestSchema>;
export type UpdateDeploymentRequest = z.infer<typeof UpdateDeploymentRequestSchema>;
