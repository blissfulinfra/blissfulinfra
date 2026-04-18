# packages/cli — @blissful-infra/cli

The published CLI package. Handles everything: command parsing, project scaffolding, Docker Compose orchestration, the local API server, MCP server, and AI agent.

**Published to npm as:** `@blissful-infra/cli` (version in `package.json`)
**Binary name:** `blissful-infra`
**Build:** `tsc` → `dist/` + `cp -r examples dist/examples`

See root [CLAUDE.md](../../CLAUDE.md) for monorepo conventions.

---

## Source layout

```
src/
├── index.ts              # CLI entry point — registers all commands with Commander.js
├── commands/             # One file per command (20 commands)
├── server/
│   ├── api.ts            # Express REST API server (port 3002)
│   ├── mcp.ts            # Model Context Protocol server
│   └── entrypoint.ts     # Starts API + MCP together
└── utils/                # Shared utility modules (19 files)

templates/                # Scaffold templates (NOT under src/ — shipped as-is in npm package)
examples/                 # Example projects (copied to dist/examples at build time)
```

---

## Commands

Registered in `src/index.ts` using Commander.js. Grouped by feature phase:

### Core (Phase 1)
| Command | File | What it does |
|---|---|---|
| `start <name>` | `start.ts` | Scaffolds project dir + boots full stack (flat model) |
| `up` | `up.ts` | Start a stopped project (`docker compose up`) |
| `down` | `down.ts` | Stop a running project (`docker compose down`) |
| `logs` | `logs.ts` | Stream logs from all services |
| `dev` | `dev.ts` | Hot-reload mode with file watching (chokidar) |
| `agent` | `agent.ts` | Interactive AI chat session against the running stack |
| `dashboard` | `dashboard.ts` | Open the dashboard UI in browser |
| `example <name>` | `example.ts` | Scaffold an example app from `dist/examples/` |
| `mcp` | `mcp.ts` | Start the MCP server for Claude Desktop / Claude Code |
| `create` | `create.ts` | Lower-level project creation helper |

### Client Model (Phase 6)
| Command | File | What it does |
|---|---|---|
| `client create <name>` | `client.ts` | Create a client environment with isolated infra |
| `client list` | `client.ts` | List all client environments |
| `client up <name>` | `client.ts` | Start client infra + all services |
| `client down <name>` | `client.ts` | Stop a client environment |
| `client status <name>` | `client.ts` | Show infra health + service status |
| `client remove <name>` | `client.ts` | Remove a client environment entirely |
| `service add <client> <svc>` | `service.ts` | Add a service to an existing client |
| `service up <client> <svc>` | `service.ts` | Start a single service |
| `service down <client> <svc>` | `service.ts` | Stop a single service |
| `service logs <client> <svc>` | `service.ts` | Stream logs for a service |

### CI/CD (Phase 2)
| Command | File | What it does |
|---|---|---|
| `deploy` | `deploy.ts` | Trigger deployment |
| `rollback` | `rollback.ts` | Roll back to previous image tag |
| `status` | `status.ts` | Show project health + deployment status |
| `pipeline` | `pipeline.ts` | Manage Jenkins pipeline |
| `jenkins` | `jenkins.ts` | Jenkins server management |

### Resilience & Intelligence (Phases 4–5)
| Command | File | What it does |
|---|---|---|
| `perf` | `perf.ts` | Performance benchmarking |
| `chaos` | `chaos.ts` | Chaos engineering (kill containers, inject latency) |
| `compare` | `compare.ts` | Compare two builds/deployments |
| `canary` | `canary.ts` | Canary release management |
| `analyze` | `analyze.ts` | AI-powered log and metrics analysis |

---

## Adding a new command

1. Create `src/commands/<name>.ts` exporting a function that accepts a `Command` instance or directly creates a command.
2. Import and register it in `src/index.ts`.
3. Follow the pattern: use `ora` for spinners, `chalk` for color, `inquirer` for interactive prompts, `execa` for shell commands.

---

## Utils layer (`src/utils/`)

Each util is a focused module. Key ones:

| File | Purpose |
|---|---|
| `claude.ts` | Anthropic SDK wrapper — creates AI completions, tool calls |
| `ai-provider.ts` | Abstraction over AI providers (currently just Claude) |
| `knowledge-base.ts` | Per-project contextual knowledge stored as JSON |
| `analyzer.ts` | Analyzes logs/metrics to surface anomalies |
| `collectors.ts` | Collects Docker stats, logs, Prometheus metrics |
| `deployment-storage.ts` | JSONL-based deployment record storage (append-only) |
| `metrics-storage.ts` | Stores and queries time-series metrics locally |
| `log-storage.ts` | Stores and queries log entries locally |
| `alerts.ts` | Alert rule evaluation and notification |
| `chaos.ts` | Chaos engineering helpers (container manipulation) |
| `config.ts` | Read/write `blissful-infra.yaml` project config |
| `template.ts` | Template variable substitution engine |
| `registry.ts` | Project registry (tracks all known projects) |
| `plugin-system.ts` | Plugin loading and overlay system |
| `plugin-registry.ts` | Registry of available plugin types |
| `client-registry.ts` | Client environment registry + port block allocation |
| `infra-compose.ts` | Generates `docker-compose.infra.yaml` + Prometheus/Loki/Grafana configs |

---

## API server (`src/server/api.ts`)

Express server running on **port 3002**. Key endpoints:

```
GET  /api/projects                              List all known projects
GET  /api/projects/:name                        Project details + status
POST /api/projects/:name/up                     Restart containers (deploy)
GET  /api/projects/:name/logs                   Fetch recent logs
GET  /api/projects/:name/metrics                Prometheus metrics (p95 latency etc.)
GET  /api/projects/:name/deployments            List deployments (JSONL storage)
POST /api/projects/:name/deployments            Register new deployment
PATCH /api/projects/:name/deployments/:id       Update deployment status
GET  /api/projects/:name/traces                 Jaeger trace links
```

The dashboard (`packages/dashboard`) fetches from this server at `http://localhost:3002`.
Jenkins pipelines reach it at `http://host.docker.internal:3002` (from inside Docker).

---

## MCP server (`src/server/mcp.ts`)

Implements the Model Context Protocol, exposing CLI capabilities as tools that Claude Desktop / Claude Code can call. Start with `blissful-infra mcp`. Tools include: `list_projects`, `get_logs`, `get_metrics`, `get_health`, `trigger_build`, `deploy`, `query_logs`.

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
| `@anthropic-ai/sdk` | Claude API client |
| `@modelcontextprotocol/sdk` | MCP protocol implementation |

---

## Template system

Templates live in `templates/` (shipped in the npm package). They are **not** TypeScript — they are raw files (Dockerfiles, Jenkinsfiles, `docker-compose.yaml`, etc.) with `{{VAR}}` placeholders substituted at scaffold time.

See [src/templates/CLAUDE.md](src/templates/CLAUDE.md) for the full template system reference.

---

## Deployment tracking

`src/utils/deployment-storage.ts` stores deployments as append-only JSONL at `~/.blissful-infra/deployments/<project>.jsonl`.

Each record: `{ id, gitSha, status, startedAt, completedAt, durationSeconds, p95LatencyBefore, p95LatencyAfter, jaegerTraceUrl }`.

The Jenkins Jenkinsfile template calls the API to register a deployment on start and patches it on success/failure.

---

## Project config schema

`blissful-infra.yaml` (in each generated project root) captures the full configuration:

```yaml
name: my-app
backend: spring-boot        # spring-boot | fastapi | express | go-chi
frontend: react-vite        # react-vite | nextjs
database: postgres          # none | postgres | redis | postgres-redis
plugins: []                 # ai-pipeline | scraper | etc.
monitoring: true
```

This file is the source of truth used by `up` to regenerate `docker-compose.yaml`.
