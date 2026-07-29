# packages/dashboard. React Web Dashboard

The local web UI served at `http://localhost:3002` when the CLI API server is running. A private (unpublished) Vite/React app bundled into the CLI's static assets.

See root [CLAUDE.md](../../CLAUDE.md) for monorepo conventions.

---

## Architecture

- **Framework:** React 19 + Vite 7 + TypeScript
- **Styling:** Tailwind CSS 4
- **Charts:** Recharts
- **Icons:** Lucide React
- **Markdown:** react-markdown + remark-gfm (for AI chat responses)
- **Build output:** `dist/`, served as static files by the CLI's Express server (`packages/cli/src/server/api.ts`)

**The entire app is in a single component file:** `src/App.tsx` (~121KB). There is no routing library; the UI is tab-based with local state. When the app grows enough to warrant splitting, extract tab panels into `src/components/`.

---

## Build

```bash
# From packages/dashboard/:
npm run build     # tsc -b && vite build → dist/

# Dev (connects to CLI API server at localhost:3002):
npm run dev       # Vite dev server with HMR

# From repo root:
npm run build:dashboard
```

The CLI's API server must be running (`blissful-infra dashboard` or `blissful-infra up`) for the dashboard to have data.

---

## Testing

Playwright drives the built dashboard in headless chromium. There are no unit
tests here. The app is one big component wired to `fetch`, so browser tests
against the real bundle cost less than mocking React internals.

```bash
# From packages/dashboard/:
npm run test:e2e      # builds dist/, starts vite preview, runs the specs (~3s)
npm run test:e2e:ui   # same, in Playwright's watch/inspector UI

# From repo root:
npm run test:e2e
```

`npx playwright test` on its own skips the build and reuses whatever is in
`dist/`: fine for iterating on a spec, wrong after touching `src/`.
First run on a new machine needs `npx playwright install chromium`.

**Layout:**

```
e2e/
├── fixtures/api.ts   # every /api/v1/** response, plus the mockApi() helper
├── shell.spec.ts     # header, sidebar, tenant switching, API-down path
├── project.spec.ts   # project detail, service health, tab switching
└── canary.spec.ts    # the ADR-0020 canary card
```

**How the API is stubbed.** `mockApi(page)` registers one catch-all route for
`/api/v1/**` and dispatches on pathname through a table in `fixtures/api.ts`.
Unmatched paths return `{}` so nothing hangs. Two ways to change a response:

```ts
// 1. Override a fixture for the whole test
await mockApi(page, { canary: { canary: null } })

// 2. Register a narrower route afterwards. Playwright runs the
//    most-recently-registered matching handler first
await mockApi(page)
await page.route('**/api/v1/projects/*/canary/promote*', route =>
  route.fulfill({ status: 500, json: { error: 'rollout is not paused' } }))
```

**Selectors.** Anchor on the `data-testid` landmarks (`sidebar`,
`project-card` + `data-project`, `project-detail`, `tab-nav`,
`service-health`, `canary-card`) and on ARIA roles. Never select on Tailwind
classes. When adding a panel that tests need to reach, add one testid to its
container rather than tagging every child.

**CI.** The `e2e` job in `.github/workflows/ci.yml` runs the suite on every
push to `main`/`dev` and every PR to `main`, and uploads `playwright-report/`
on failure.

---

## API integration

All data comes from the CLI API server at `http://localhost:3002`. The dashboard uses standard `fetch()`, no HTTP client library.

**API version:** all calls go through the `API_BASE` constant near the top of
`App.tsx` (currently `/api/v1`). Never inline `/api/...` literally, use
`` `${API_BASE}/...` `` (template literal). The server only accepts
`/api/v1/...`; unversioned `/api/...` requests return 404 with a migration
hint. To bump to v2, change `API_BASE` to `/api/v2` and add v2 handlers
server-side.

Key endpoints consumed:

| Endpoint | Used for |
|---|---|
| `GET /api/v1/projects` | Project list on load |
| `GET /api/v1/projects/:name` | Project details + service status |
| `GET /api/v1/projects/:name/logs` | Log viewer (polled) |
| `GET /api/v1/projects/:name/metrics` | Metrics charts (polled) |
| `GET /api/v1/projects/:name/deployments` | Deployments tab, history with latency delta |
| `POST /api/v1/projects/:name/up` | "Restart" button action |
| `GET /api/v1/projects/:name/traces` | Trace explorer links (Grafana / Tempo, ADR-0016) in Deployments tab |
| `GET /api/v1/links` | Tool URLs (Tempo via Grafana, Jenkins, etc.) for the current client |

---

## Tab structure

The dashboard has these top-level tabs (managed in `App.tsx` local state):

| Tab | Purpose |
|---|---|
| **Overview** | Project list, service health status, quick actions |
| **Logs** | Real-time log streaming per service |
| **Metrics** | CPU, memory, request latency charts (Recharts) |
| **Deployments** | Deployment history, git SHA, status badge, P95 latency before/after delta, trace explorer link (Grafana / Tempo) |
| **AI Chat** | Conversational interface to the AI agent (streams responses from the API) |

---

## Deployment tracking UI

In the Deployments tab, each row shows:
- Git SHA (7 chars)
- Status badge: `running` (blue), `success` (green), `failed` (red)
- P95 latency delta: `+12ms` / `-8ms` vs previous deployment (color-coded)
- Trace explorer link (opens Grafana's Explore tab pointed at the Tempo datasource; ADR-0016 replaced Jaeger with Tempo)
- Duration in seconds
- Timestamp

Data comes from `GET /api/projects/:name/deployments` which reads JSONL from `~/.blissful-infra/deployments/<project>.jsonl`.

---

## Adding a new tab or feature

1. Add a new tab name to the tab list state in `App.tsx`.
2. Add a tab button in the nav row.
3. Add the corresponding panel in the conditional render block.
4. If the tab needs new API data, add the endpoint to `packages/cli/src/server/api.ts` first.
5. Add the endpoint's response to `e2e/fixtures/api.ts` and a spec that switches to the tab and asserts it rendered.

Keep new panels in `App.tsx` for now unless the component exceeds ~200 lines, at which point extract to `src/components/<TabName>.tsx`.
