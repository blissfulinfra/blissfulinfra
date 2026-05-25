import type {
  ClientOntology,
  OntologyNode,
  OntologyEdge,
  OntologyNodeType,
  OntologyEdgeType,
  OntologyContract,
  ContractFormat,
} from '@blissful-infra/shared'

export type { ClientOntology, OntologyNode, OntologyEdge, OntologyNodeType, OntologyEdgeType, OntologyContract, ContractFormat }

export const CONTRACT_FORMAT_BY_EDGE_TYPE: Record<OntologyEdgeType, ContractFormat | null> = {
  http: 'openapi',
  kafka: 'avro',
  database: 'sql',
  custom: null,
}

export const DEFAULT_CONTRACT_TEMPLATES: Record<ContractFormat, string> = {
  openapi: `openapi: 3.0.3
info:
  title: Service Contract
  version: 0.1.0
paths:
  /example:
    get:
      summary: Example endpoint
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  message:
                    type: string
`,
  avro: `{
  "type": "record",
  "name": "Event",
  "namespace": "blissful",
  "fields": [
    { "name": "id", "type": "string" },
    { "name": "timestamp", "type": "long" },
    { "name": "payload", "type": "string" }
  ]
}
`,
  sql: `-- Contract: source service writes / target service reads
CREATE TABLE example (
  id           UUID PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload      JSONB NOT NULL
);
`,
}

export interface NodeConfigResponse {
  path: string
  content: string
}

export const NODE_PALETTE: Record<OntologyNodeType, { color: string; bg: string }> = {
  service:    { color: '#60a5fa', bg: 'rgba(96,165,250,0.15)' },
  kafka:      { color: '#f97316', bg: 'rgba(249,115,22,0.15)' },
  postgres:   { color: '#38bdf8', bg: 'rgba(56,189,248,0.15)' },
  redis:      { color: '#f87171', bg: 'rgba(248,113,113,0.15)' },
  jenkins:    { color: '#fbbf24', bg: 'rgba(251,191,36,0.15)' },
  dashboard:  { color: '#a78bfa', bg: 'rgba(167,139,250,0.15)' },
  grafana:    { color: '#fb923c', bg: 'rgba(251,146,60,0.15)' },
  prometheus: { color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
  tempo:      { color: '#c084fc', bg: 'rgba(192,132,252,0.15)' },
  loki:       { color: '#34d399', bg: 'rgba(52,211,153,0.15)' },
  keycloak:   { color: '#4a90d9', bg: 'rgba(74,144,217,0.15)' },
  localstack: { color: '#e11d48', bg: 'rgba(225,29,72,0.15)' },
  clickhouse: { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  mlflow:     { color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
  mage:       { color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
}

export const EDGE_TYPE_COLORS: Record<OntologyEdgeType, string> = {
  http:     '#60a5fa',
  kafka:    '#f97316',
  database: '#38bdf8',
  custom:   '#a3a3a3',
}
