# packages/cli, @blissful-infra/cli

The published CLI package. Handles everything: command parsing, project scaffolding, Docker Compose orchestration, the local API server, MCP server, and AI agent.

**Published to npm as:** `@blissful-infra/cli` (version in `package.json`)
**Binary name:** `blissful-infra`
**Build:** `tsc` → `dist/` + Node.js `cpSync` to copy examples (cross-platform, no `cp` dependency)

See root [CLAUDE.md](../../CLAUDE.md) for monorepo conventions and [ADR-0017](../../docs/adr/0017-tenant-project-service-hierarchy.md) for the current tenant / project / service model.

---

## Source layout

```
src/
├── index.ts              # CLI entry point: registers all commands with Commander.js
├── commands/             # One file per command group
├── server/
│   ├── api.ts            # REST API server (node:http, port 3002)
│   ├── mcp.ts            # Model Context Protocol server
│   └── entrypoint.ts     # Starts API + MCP together
├── utils/                # Shared utility modules
│   └── __tests__/        # Co-located unit + L2 tests (vitest)
└── __tests__/integration/ # L3 integration tests (real Docker, slow)

templates/                # Scaffold templates (NOT under src/: shipped as-is in npm package)
examples/                 # Example projects (copied to dist/examples at build time)
```

## Tests

Three-layer strategy (see root [CLAUDE.md](../../CLAUDE.md#testing-convention)):
- **L1**: pure functions (port math, validators) under `src/utils/__tests__/*.test.ts`
- **L2**: compose generation (validates real YAML with `docker compose config --quiet`) under same dir
- **L3**: full tenant/project/service lifecycle (real Docker) under `src/__tests__/integration/`

```bash
npm test                      # L1 + L2 (fast, no Docker)
npm run test:watch            # vitest watch mode
npm run test:integration      # L3 (slow, real Docker, builds CLI first)
```

**Required for testability:** [tenant-registry.ts](src/utils/tenant-registry.ts) (and the legacy [client-registry.ts](src/utils/client-registry.ts)) resolve `BLISSFUL_HOME` on every call (defaults to `~/.blissful-infra`). Tests set it to a temp dir via `mkdtemp` so the real registry is never touched.

---

## Commands

Registered in `src/index.ts` using Commander.js.

### Tenant / Project / Service (current model, ADR-0017)
| Command | File | What it does |
|---|---|---|
| `tenant create/list/status/up/down/remove` | `tenant.ts` | Tenant lifecycle. A tenant owns Jenkins + the observability stack |
| `project create/list/status/up/down/remove` | `project.ts` | Project lifecycle. A project owns Kafka, Postgres, API gateway, isolated network |
| `service add/remove/up/down/logs` | `service-v2.ts` | Service lifecycle. `--type backend\|frontend\|worker`, one container family per service |
| `use [tenant] [project]` | `use.ts` | Set or show the persistent context (`~/.blissful-infra/context.json`) |
| `dashboard` | `dashboard.ts` | Host-level control-plane dashboard, `dashboard up/down/status` |

Positional args resolve through context: `service up orders-api` fills tenant + project from `context.json`, `service up acme ecommerce orders-api` is fully explicit (see `utils/context.ts`).

The dashboard is **host-level** since the ADR-0017 revision of 2026-05-26 (`utils/host-dashboard-compose.ts`): one dashboard container on port 3002 acts as a control plane for all tenants, reading the global registry and reaching each tenant's services via host-published ports. It is no longer part of any tenant's compose.

### Core (Phase 1, flat model, legacy)
| Command | File | What it does |
|---|---|---|
| `start <name>` | `start.ts` | Scaffolds project dir + boots full stack (flat model) |
| `up` / `down` / `logs` | `up.ts` etc. | Lifecycle for a flat-model project |
| `dev` | `dev.ts` | Hot-reload mode with file watching (chokidar) |
| `agent` | `agent.ts` | Interactive AI chat session against the running stack |
| `example <name>` | `example.ts` | Scaffold an example app from `dist/examples/` |
| `mcp` | `mcp.ts` | Start the MCP server for Claude Desktop / Claude Code |
| `create` / `init` | `create.ts`, `init.ts` | Project creation helpers |
| `generate` | `generate.ts` | Schema-first code generation |

### Client Model (Phase 6, legacy, superseded by ADR-0017)
| Command | File | What it does |
|---|---|---|
| `client create/list/up/down/status/remove` | `client.ts` | Client environment lifecycle (isolated infra per client) |
| `client infra add/remove <client> <component>` | `client.ts` | Toggle a client-level infra flag |
| `service …` (old form) | `service.ts` | Client-model service lifecycle |

Still works, no longer the target of new work. Data under `~/.blissful-infra/clients/`.

### Lambda (serverless backend on LocalStack)
| Command | File | What it does |
|---|---|---|
| `lambda deploy <client> <svc>` | `lambda.ts` | Re-package handler + register with LocalStack |
| `lambda invoke <client> <svc>` | `lambda.ts` | Invoke the function with a JSON payload |
| `lambda logs <client> <svc>` | `lambda.ts` | Tail Lambda logs (CloudWatch emulated by LocalStack) |

Lambda services are created via `--backend lambda-python`. Compose generation branches on `isServerlessBackend(backend)`: `generateLambdaServiceCompose` produces the `localstack + deployer` sidecar shape instead of a long-running backend container. Cloud deploy adapter for real AWS Lambda is intentionally deferred, see [ADR-0007](../../docs/adr/0007-aws-lambda-local-via-localstack.md). Command args still use client-model coordinates.

### CI/CD (Phase 2)
| Command | File | What it does |
|---|---|---|
| `deploy` / `rollback` | `deploy.ts`, `rollback.ts` | Trigger deployment / roll back image tag |
| `status` | `status.ts` | Show project health + deployment status |
| `pipeline` / `jenkins` | `pipeline.ts`, `jenkins.ts` | Jenkins pipeline + server management |

### Resilience & Intelligence (Phases 4–5)
| Command | File | What it does |
|---|---|---|
| `perf` | `perf.ts` | Performance benchmarking |
| `chaos` | `chaos.ts` | Chaos engineering (kill containers, inject latency) |
| `compare` / `canary` | `compare.ts`, `canary.ts` | Build comparison / canary release management |
| `analyze` / `suggest` | `analyze.ts` | AI-powered log and metrics analysis |

---

## Adding a new command

1. Create `src/commands/<name>.ts` exporting a `Command` instance.
2. Import and register it in `src/index.ts` (and add it to `knownCommands` there, which gates the project-first syntax).
3. Follow the pattern: `ora` for spinners, `chalk` for color, `inquirer` for interactive prompts, `execa` for shell commands.

---

## Utils layer (`src/utils/`)

Each util is a focused module. Key ones:

| File | Purpose |
|---|---|
| `tenant-registry.ts` | Tenant/project/service registry + hierarchical port allocation (`registry.json`, honors `BLISSFUL_HOME`) |
| `context.ts` | Persistent working set (like kubectl context), `~/.blissful-infra/context.json`, positional-arg resolution |
| `tenant-compose.ts` | Generates the tenant-level compose (Jenkins, observability) |
| `project-compose.ts` | Generates the project-level compose (Kafka, Postgres, gateway, network) |
| `service-compose-v2.ts` | Generates a service's own compose |
| `host-dashboard-compose.ts` | Host-level control-plane dashboard compose (`docker-compose.dashboard.yaml`, port 3002) |
| `infra-deps.ts` | Service infra-dependency manifest (required + optional infra per template/plugin) |
| `infra-images.ts` | Infra image resolution (e.g. ensures the dashboard image exists) |
| `ontology.ts` | Ontology graph model backing the dashboard's system view |
| `claude.ts` | Claude integration: Anthropic SDK + `claude -p` CLI path with MCP tool access |
| `ai-provider.ts` | Abstraction over AI providers |
| `ollama.ts` | Local model support via Ollama |
| `knowledge-base.ts` | Per-project contextual knowledge stored as JSON |
| `analyzer.ts` / `collectors.ts` | Log/metric anomaly analysis, Docker + Prometheus collection |
| `deployment-storage.ts` | JSONL-based deployment record storage (append-only) |
| `metrics-storage.ts` / `log-storage.ts` | Local time-series metric and log storage |
| `alerts.ts` | Alert rule evaluation and notification |
| `chaos.ts` / `scorecard.ts` | Chaos helpers + resilience scorecard over time |
| `rollouts.ts` | Argo Rollouts canary utilities |
| `config.ts` | Read/write `blissful-infra.yaml` project config |
| `template.ts` | Template variable substitution engine |
| `errors.ts` | Typed error classes + message extraction |
| `ports.ts` | Port-in-use checks |
| `registry.ts` / `client-registry.ts` / `client-config-edit.ts` | Legacy flat-model and client-model registries |
| `plugin-system.ts` / `plugin-registry.ts` | Plugin loading, overlays, available plugin types |
| `infra-compose.ts` | Legacy client-model infra compose + Prometheus/Loki/Grafana configs |

---

## API server (`src/server/api.ts`)

A raw `node:http` server (no Express) running on **port 3002**, route matching via `url.pathname` regexes.

**Tenant resolution (control-plane mode):** with no `TENANT_NAME` env binding, handlers read `?tenant=<name>` from the query string; this is how the single host dashboard manages every tenant. Setting `TENANT_NAME` pins the server to one tenant (legacy single-tenant mode) and the query string is ignored.

Route groups:

```
GET/POST   /api/v1/tenants                    List / create tenants
DELETE     /api/v1/tenants/:t                 Remove tenant
POST       /api/v1/tenants/:t/up              Start tenant infra
GET        /api/v1/tenants/:t/projects        List projects
POST       /api/v1/tenants/:t/projects/:p/up  Start project (and nested service up)
GET/POST   /api/v1/projects...                Project detail, up/down, logs (incl. /logs/loki),
                                              metrics (+history/summary/export), health, alerts,
                                              deployments, deploy/rollback, pipeline, perf/gatling,
                                              environments, plugins, agent (AI chat)
GET        /api/v1/ontology/:t                Ontology graph (+ node config, edge wire endpoints)
GET        /api/v1/links                      Tool URLs (Grafana/Tempo, Jenkins…) for a tenant
GET        /api/v1/templates | /models        Scaffold templates, available AI models
```

### API versioning

`/api/v1/...` is the only accepted public path. The server returns 404 with a migration hint for any `/api/...` request that is not `/api/v1/`. All internal callers (dashboard, MCP server, Jenkinsfile template) use the versioned form.

To introduce v2 (breaking change), add `/api/v2/...` matchers alongside the v1 ones, keep v1 alive until consumers migrate, then delete it. The dashboard centralizes the version in a single `API_BASE` constant in [App.tsx](../dashboard/src/App.tsx).

Note: `${jenkins}/api/json` and `${grafana}/api/health` are *external* APIs (Jenkins, Grafana), unrelated to this versioning.

The dashboard fetches from `http://localhost:3002`. Jenkins pipelines reach it at `http://host.docker.internal:3002` (from inside Docker).

---

## MCP server (`src/server/mcp.ts`)

Implements the Model Context Protocol over **stdio** transport, designed to be spawned as a subprocess by Claude Desktop / Claude Code / Cursor, not exposed over a network port. Internally a thin shim: each MCP tool proxies to a `/api/v1/...` endpoint on the API server (`list_projects`, `get_logs`, `query_logs`, `get_metrics`, `get_health`, `trigger_build`, `deploy`, pipeline / environments / plugins tools).

**Tenant auto-scoping:** every proxied request gets `?tenant=<default>` appended unless the path already carries one. The default resolves from `context.json`, then falls back to the first tenant in `registry.json`, then to none (legacy flat mode). Resolution is cached for the life of the process, restart the MCP server after `blissful-infra use <other-tenant>`.

### Wiring it up

```bash
blissful-infra mcp                             # default: host dashboard on :3002, auto-starts it if down
blissful-infra mcp --client dev                # legacy: auto-discover a client's dashboard port from registry.json
blissful-infra mcp --api http://localhost:3013 # explicit URL, overrides --client
```

The dashboard's own AI chat uses the same server: in Docker the chat runs `claude -p` with `/app/.mcp.json` (`--mcp-config` + `--allowed-tools mcp__blissful-infra`), so the agent retrieves logs/metrics on demand instead of relying on prompt stuffing (see `utils/claude.ts`).

### Claude Desktop config

In `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "blissful-infra": {
      "command": "blissful-infra",
      "args": ["mcp"]
    }
  }
}
```

### Verification harness

`scripts/mcp-verify.mjs` and `scripts/mcp-verify-client.mjs` spawn the MCP server, perform the handshake, list tools, and call `list_projects` / `get_health`. Use these for smoke-testing after any change to api.ts or mcp.ts.

---

## Key dependencies

| Package | Role |
|---|---|
| `commander` | CLI argument parsing + subcommands |
| `inquirer` | Interactive prompts |
| `ora` | Spinner/loading indicators |
| `chalk` | Terminal colors |
| `execa` | Shell command execution (async, ESM-safe) |
| `chokidar` | File watching (for `dev` command) |
| `zod` | Runtime validation |
| `js-yaml` | YAML parse/serialize (compose generation, config edits) |
| `@anthropic-ai/sdk` | Claude API client |
| `@modelcontextprotocol/sdk` | MCP protocol implementation |

---

## Template system

Templates live in `templates/` (shipped in the npm package). They are **not** TypeScript, they are raw files (Dockerfiles, Jenkinsfiles, `docker-compose.yaml`, etc.) with `{{VAR}}` placeholders substituted at scaffold time.

See [src/templates/CLAUDE.md](src/templates/CLAUDE.md) for the full template system reference.

---

## Deployment tracking

`src/utils/deployment-storage.ts` stores deployments as append-only JSONL at `~/.blissful-infra/deployments/<project>.jsonl`.

Each record: `{ id, gitSha, status, startedAt, completedAt, durationSeconds, p95LatencyBefore, p95LatencyAfter, jaegerTraceUrl }`. The `jaegerTraceUrl` field name is kept for back-compat with on-disk JSONL; the value points at Grafana's Tempo trace explorer since [ADR-0016](../../docs/adr/0016-tempo-replaces-jaeger.md).

The Jenkinsfile template calls the API to register a deployment on start and patches it on success/failure.

---

## Config files

- **Tenant model:** `tenant.yaml`, `project.yaml`, `service.yaml` at each level under `~/.blissful-infra/tenants/…` (see ADR-0017 for the layout).
- **Flat / client model (legacy):** `blissful-infra.yaml` in the generated project root, source of truth used by `up` to regenerate `docker-compose.yaml`:

```yaml
name: my-app
backend: spring-boot        # spring-boot | lambda-python
frontend: react-vite        # react-vite
database: postgres          # none | postgres | redis | postgres-redis
plugins: []                 # ai-pipeline | gatling | agent-service
monitoring: true
```
