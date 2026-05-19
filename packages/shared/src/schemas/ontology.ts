import { z } from "zod";

export const OntologyNodeTypeSchema = z.enum([
  "service",
  "kafka",
  "postgres",
  "redis",
  "jenkins",
  "dashboard",
  "grafana",
  "prometheus",
  "tempo",
  "loki",
  "keycloak",
  "localstack",
  "clickhouse",
  "mlflow",
  "mage",
]);

export const OntologyEdgeTypeSchema = z.enum(["http", "kafka", "database", "custom"]);

export const OntologyPositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const OntologyNodeSchema = z.object({
  id: z.string(),
  type: OntologyNodeTypeSchema,
  label: z.string(),
  position: OntologyPositionSchema,
  status: z.enum(["running", "stopped", "unknown"]).optional(),
  port: z.number().optional(),
});

export const OntologyEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: OntologyEdgeTypeSchema,
  label: z.string().optional(),
  properties: z.record(z.string(), z.string()).optional(),
  wired: z.boolean().default(false),
});

export const ClientOntologySchema = z.object({
  clientName: z.string(),
  nodes: z.array(OntologyNodeSchema),
  edges: z.array(OntologyEdgeSchema),
});

export type OntologyNodeType = z.infer<typeof OntologyNodeTypeSchema>;
export type OntologyEdgeType = z.infer<typeof OntologyEdgeTypeSchema>;
export type OntologyPosition = z.infer<typeof OntologyPositionSchema>;
export type OntologyNode = z.infer<typeof OntologyNodeSchema>;
export type OntologyEdge = z.infer<typeof OntologyEdgeSchema>;
export type ClientOntology = z.infer<typeof ClientOntologySchema>;
