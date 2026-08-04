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

**Required for testability:** [tenant-registry.ts](src/utils/tenant-registry.ts) resolves `BLISSFUL_HOME` on every call (defaults to `~/.blissful-infra`). Tests set it to a temp dir via `mkdtemp` so the real registry is never touched.

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

### Kubernetes golden path (ADR-0020)
| Command | File | What it does |
|---|---|---|
| `cluster up/down/status` | `cluster.ts` | Terraform-provision the tenant's kind cluster (ArgoCD + Argo Rollouts + Gitea) |
| `deploy <service>` | `deploy.ts` → `deploy/kubernetes.ts` | Build → kind load → gitops push → ArgoCD sync → Rollout canary |
| `deploy <service> --target cloudflare` | `deploy.ts` → `deploy/cloudflare.ts` | Promote to Cloudflare Workers (hono backends) or Pages (frontends), [ADR-0022](../../docs/adr/0022-cloudflare-as-promotion-target.md) |
| `canary status/promote/abort/pause/resume/test` | `canary.ts` | Drive the Argo Rollout (namespace = project, rollout = service) |
| `rollback <service>` | `rollback.ts` | GitOps revert (default) or `--immediate` kubectl-argo-rollouts undo |

These take tenant coordinates: positional service + `--tenant`/`--project` flags; the `use` context and a registry scan fill the rest (`resolveServiceCoords` in `deploy.ts`).

### CI + intelligence
| Command | File | What it does |
|---|---|---|
| `pipeline` / `jenkins` | `pipeline.ts`, `jenkins.ts` | Local pipeline stages / tenant Jenkins management |
| `status` | `status.ts` | Context-aware tenant/project/service status |
| `agent` | `agent.ts` | Interactive AI chat session |
| `analyze` / `suggest` | `analyze.ts` | AI-powered log and metrics analysis |
| `generate` | `generate.ts` | Schema-first code generation |
| `mcp` | `mcp.ts` | Start the MCP server for Claude Desktop / Claude Code |

### Deferred (still flat-model-keyed)
`perf`, `chaos`, `compare` compile against the deprecated `utils/config.ts` and error politely at runtime; re-keying them to tenant coordinates is an open follow-up. The `lambda` command was removed with the client model (the `lambda-python` template stays on disk for a future tenant-model port).

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
| `tenant-registry.ts` | Tenant/project/service registry + hierarchical port allocation (`registry.json`, honors `BLISSFUL_HOME`); `readProjectConfig/Runtime`, `findServiceProject`, `ensureClusterPorts` |
| `context.ts` | Persistent working set (like kubectl context), `~/.blissful-infra/context.json`, positional-arg resolution |
| `tenant-compose.ts` | Generates the tenant-level compose (Jenkins, observability) |
| `project-compose.ts` | Generates the project-level compose (Kafka, Postgres, gateway, network) |
| `service-compose-v2.ts` | Generates a service's own compose |
| `host-dashboard-compose.ts` | Host-level control-plane dashboard compose (`docker-compose.dashboard.yaml`, port 3002) |
| `terraform.ts` / `kind.ts` | Cluster workspace render + terraform init/apply/destroy; kind prereqs, image load, kubeconfig |
| `gitea.ts` / `gitops.ts` | In-cluster Gitea REST (org/repo ensure) + gitops checkout, manifest render, tag bump, revert |
| `rollouts.ts` | Argo Rollouts wrapper (`kubectl argo rollouts` status/promote/abort/pause/resume/undo) |
| `infra-images.ts` | Infra image resolution (e.g. ensures the dashboard image exists) |
| `ontology.ts` | Tenant-keyed node config + edge wiring for the dashboard graph (graph itself derives in api.ts) |
| `claude.ts` | Claude integration: Anthropic SDK + `claude -p` CLI path with MCP tool access |
| `ai-provider.ts` / `ollama.ts` | AI provider abstraction, local models via Ollama |
| `knowledge-base.ts` | Per-project contextual knowledge stored as JSON |
| `analyzer.ts` / `collectors.ts` | Log/metric anomaly analysis, Docker + Prometheus collection |
| `deployment-storage.ts` | JSONL-based deployment record storage (append-only) |
| `metrics-storage.ts` / `log-storage.ts` | Local time-series metric and log storage |
| `alerts.ts` | Alert rule evaluation and notification |
| `chaos.ts` / `scorecard.ts` | Chaos helpers + resilience scorecard over time |
| `config.ts` | **Deprecated** legacy flat-model config reader — only the deferred perf/chaos/compare/analyze/agent/generate path may use it |
| `template.ts` | Template variable substitution engine |
| `errors.ts` / `ports.ts` | Typed error classes; port-in-use checks |
| `plugin-registry.ts` | Static plugin metadata consumed by the dashboard's plugin views |

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

## MCP server (`src/server/mcp/`)

Implements the Model Context Protocol over **stdio**, spawned as a subprocess by Claude Desktop / Claude Code / Cursor. Not a network service, and since [ADR-0021](../../docs/adr/0021-mcp-in-process-control-plane.md) **not** an HTTP shim over the API server either — it calls this package's own library layer.

```
src/server/mcp/
├── index.ts    # createMcpServer: registers the 21 tools
├── coords.ts   # tenant/project/service resolution + actionable CoordinateError
├── inspect.ts  # read helpers (tree, pods, containers, links)
└── jobs.ts     # subprocess runner + in-memory job registry
```

**Three execution modes**, picked by what the operation needs:
- **In-process** — registry reads, coordinate resolution, rollout status, links, logs.
- **CLI subprocess, awaited** (`runCli`) — fast mutations. Subprocess, not a direct call, because the command actions print via chalk/ora and **this process's stdout is the JSON-RPC stream**. Never `console.log` in MCP code.
- **CLI subprocess as a job** (`startJob`) — `cluster_up`, `deploy_service`, lifecycle. Returns a `jobId`; the agent polls `get_job`.

**Coordinate resolution** (`coords.ts`) fills `tenant`/`project`/`service` from the `use` context, **re-read on every call** so `blissful-infra use` takes effect without a restart. Failures throw `CoordinateError` naming what does exist — an agent has no terminal, so the error string is its only chance to self-correct. Passing a *project* name where a service is expected is explicitly rejected (it used to silently return an empty payload).

### Tool surface

| Group | Tools |
|---|---|
| Discovery | `get_context` (start here — full tenant/project/service tree + runtimes + cluster state), `set_context`, `describe_service`, `get_links` |
| Scaffolding | `create_tenant`, `create_project`, `add_service` |
| Lifecycle | `tenant_lifecycle`, `project_lifecycle`, `service_lifecycle` (each `up`/`down`/`remove`) |
| Kubernetes (ADR-0020) | `cluster_up`, `cluster_down`, `cluster_status`, `deploy_service`, `rollback_service`, `canary_status`, `canary_control` |
| Observability / CI | `get_logs`, `run_pipeline` |
| Jobs | `get_job`, `list_jobs` |

### Wiring it up

```bash
blissful-infra mcp    # no flags: no port, no dashboard, no --api
```

The dashboard's own AI chat uses the same server: in Docker the chat runs `claude -p` with `/app/.mcp.json` (`--mcp-config` + `--allowed-tools mcp__blissful-infra`), so the agent retrieves logs/metrics on demand instead of relying on prompt stuffing (see `utils/claude.ts`).

### Dashboard agent credentials

The AI Chat tab runs `claude -p` **inside** the dashboard container, which
has its own `~/.claude` (bind-mounted from `~/.blissful-infra/dashboard-claude/`).
macOS stores Claude Code OAuth tokens in the Keychain, so the host login is
invisible to the container — it needs its own auth, one of:

```bash
blissful-infra dashboard login      # OAuth flow inside the container, persists across restarts
# or, before `dashboard up`:
export ANTHROPIC_API_KEY=sk-...     # forwarded into the container by the compose generator
```

Changing the env var requires `blissful-infra dashboard up` again (compose
bakes environment at container create).

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

`scripts/mcp-verify.mjs` spawns the MCP server, handshakes, asserts the tool surface, then exercises the read tools against whatever is in `BLISSFUL_HOME` — including the error paths that used to return empty success payloads. `--deep` adds a dry-run deploy. Run it after any change to `src/server/mcp/`.

```bash
node scripts/mcp-verify.mjs          # read-only
node scripts/mcp-verify.mjs --deep   # + dry-run deploy
```

Unit coverage lives in `src/server/mcp/__tests__/` (coordinate resolution, job registry).

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

- **Tenant model:** `tenant.yaml`, `project.yaml` (carries `runtime: compose | kubernetes`), `service.yaml` at each level under `~/.blissful-infra/tenants/…` (see ADR-0017 / ADR-0020 for the layout).
- **Kubernetes runtime state:** the Terraform workspace lives at `tenants/<t>/cluster/`, the gitops checkout at `tenants/<t>/gitops/`.
- `blissful-infra.yaml` (legacy flat model) is only read by the deprecated `utils/config.ts` path for the deferred perf/chaos/compare commands.
