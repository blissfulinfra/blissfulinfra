import type { Page, Route } from '@playwright/test'

/**
 * The dashboard's whole world is the CLI API server on port 3002. In CI there
 * is no server, no Docker and no tenant on disk, so every `/api/v1/**` request
 * is answered from these fixtures. Tests that care about a specific response
 * register their own `page.route` after `mockApi` — Playwright runs the
 * most-recently-registered matching handler first, so a test-local route wins.
 */

export interface ApiFixtures {
  links: unknown
  tenants: unknown
  templates: unknown
  models: unknown
  clientInfra: unknown
  projects: unknown
  health: unknown
  canary: unknown
  environments: unknown
  pipeline: unknown
  deployments: unknown
  logs: unknown
  plugins: unknown
  metrics: unknown
  alerts: unknown
}

export const TENANT = 'acme'
export const OTHER_TENANT = 'globex'
export const PROJECT = 'checkout'

export const defaultFixtures: ApiFixtures = {
  links: {
    clientName: TENANT,
    tenantName: TENANT,
    projectName: PROJECT,
    tempoUrl: null,
    jaegerUrl: null,
    grafanaUrl: 'http://localhost:3100',
    prometheusUrl: 'http://localhost:9090',
    jenkinsUrl: 'http://localhost:8080',
    argocdUrl: 'http://localhost:8081',
    giteaUrl: 'http://localhost:3000',
  },
  tenants: {
    tenants: [
      { name: TENANT, status: 'running', isCurrent: true },
      { name: OTHER_TENANT, status: 'stopped', isCurrent: false },
    ],
  },
  templates: {
    types: ['fullstack', 'backend', 'frontend'],
    backends: ['spring-boot', 'fastapi'],
    frontends: ['react-vite'],
    databases: ['none', 'postgres'],
  },
  models: {
    available: true,
    provider: 'claude',
    models: [{ name: 'claude-opus-5', provider: 'claude', displayName: 'Opus 5' }],
    recommended: { provider: 'claude', model: 'claude-opus-5' },
  },
  clientInfra: {
    infra: [
      { id: 'jenkins', type: 'ci', label: 'Jenkins', port: 8080, status: 'running' },
      { id: 'grafana', type: 'observability', label: 'Grafana', port: 3100, status: 'running' },
    ],
  },
  projects: {
    projects: [
      {
        name: PROJECT,
        path: `/tmp/tenants/${TENANT}/projects/${PROJECT}`,
        status: 'running',
        type: 'fullstack',
        backend: 'spring-boot',
        database: 'postgres',
        services: [
          { name: 'api', status: 'running', port: 8090 },
          { name: 'web', status: 'running', port: 5173 },
        ],
      },
      {
        name: 'billing',
        path: `/tmp/tenants/${TENANT}/projects/billing`,
        status: 'stopped',
        type: 'backend',
        backend: 'fastapi',
        services: [{ name: 'api', status: 'stopped', port: 8091 }],
      },
    ],
  },
  health: {
    services: [
      { name: 'api', status: 'healthy', responseTimeMs: 12, lastChecked: 0 },
      { name: 'web', status: 'unhealthy', lastChecked: 0, details: 'connection refused' },
    ],
    timestamp: 0,
  },
  canary: {
    canary: {
      status: 'Paused',
      step: 2,
      totalSteps: 4,
      currentWeight: 40,
      message: 'Waiting for manual promotion',
    },
  },
  environments: {
    environments: [
      {
        name: 'staging',
        version: 'a1b2c3d',
        status: 'Synced',
        health: 'Healthy',
        replicas: '2/2',
        lastDeployed: '2026-07-27T10:00:00.000Z',
      },
      {
        name: 'production',
        version: '9f8e7d6',
        status: 'OutOfSync',
        health: 'Progressing',
        replicas: '1/3',
      },
    ],
  },
  pipeline: {
    lastRun: {
      status: 'success',
      duration: 94,
      timestamp: '2026-07-27T10:00:00.000Z',
      stages: [
        { name: 'Build', status: 'success' },
        { name: 'Test', status: 'success' },
        { name: 'Deploy', status: 'success' },
      ],
    },
    jenkinsUrl: 'http://localhost:8080',
  },
  deployments: {
    deployments: [
      {
        id: 'dep-1',
        gitSha: 'a1b2c3d4e5f6',
        status: 'success',
        strategy: 'canary',
        environment: 'staging',
        latencyDelta: -4.2,
        latencyBefore: 31.5,
        latencyAfter: 27.3,
        regression: false,
        timestamp: '2026-07-27T10:00:00.000Z',
      },
    ],
  },
  logs: {
    logs: [
      { timestamp: '2026-07-27T10:00:00.000Z', service: 'api', message: 'Started ApiApplication in 3.1s' },
      { timestamp: '2026-07-27T10:00:01.000Z', service: 'web', message: 'ready in 210 ms' },
    ],
  },
  plugins: { plugins: [] },
  metrics: { containers: [], http: null, timestamp: 0 },
  alerts: { triggered: [], thresholds: [] },
}

const ROUTE_TABLE: Array<[RegExp, keyof ApiFixtures]> = [
  [/\/api\/v1\/links$/, 'links'],
  [/\/api\/v1\/tenants$/, 'tenants'],
  [/\/api\/v1\/templates$/, 'templates'],
  [/\/api\/v1\/models$/, 'models'],
  [/\/api\/v1\/client\/infra$/, 'clientInfra'],
  [/\/api\/v1\/projects$/, 'projects'],
  [/\/api\/v1\/projects\/[^/]+\/health$/, 'health'],
  [/\/api\/v1\/projects\/[^/]+\/canary$/, 'canary'],
  [/\/api\/v1\/projects\/[^/]+\/environments$/, 'environments'],
  [/\/api\/v1\/projects\/[^/]+\/pipeline$/, 'pipeline'],
  [/\/api\/v1\/projects\/[^/]+\/deployments$/, 'deployments'],
  [/\/api\/v1\/projects\/[^/]+\/logs$/, 'logs'],
  [/\/api\/v1\/projects\/[^/]+\/plugins$/, 'plugins'],
  [/\/api\/v1\/projects\/[^/]+\/metrics$/, 'metrics'],
  [/\/api\/v1\/projects\/[^/]+\/alerts$/, 'alerts'],
]

function bodyFor(pathname: string, fixtures: ApiFixtures): unknown {
  const match = ROUTE_TABLE.find(([pattern]) => pattern.test(pathname))
  return match ? fixtures[match[1]] : {}
}

export async function mockApi(page: Page, overrides: Partial<ApiFixtures> = {}): Promise<void> {
  const fixtures = { ...defaultFixtures, ...overrides }

  await page.route('**/config.json', (route: Route) =>
    route.fulfill({ json: { apiBase: '/api/v1', serviceHost: 'http://localhost' } }),
  )

  await page.route('**/api/v1/**', (route: Route) => {
    const pathname = new URL(route.request().url()).pathname
    return route.fulfill({ json: bodyFor(pathname, fixtures) })
  })
}
