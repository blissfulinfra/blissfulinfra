<div align="center">

# Blissful Infra

**An enterprise sandbox on your laptop.**

Real Kafka, real Postgres, real observability, real GitOps. Wired together by one command. Built for engineers who want to iterate on architecture patterns without a cloud bill.

[![CI](https://github.com/cavanpage/blissful-infra/actions/workflows/ci.yml/badge.svg)](https://github.com/cavanpage/blissful-infra/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@blissful-infra/cli)](https://www.npmjs.com/package/@blissful-infra/cli)

---

[What is blissful-infra?](#what-is-blissful-infra) · [The model](#the-model-tenants-projects-services) · [Golden path](#golden-path-kubernetes--argocd--canary-deploys) · [Compose runtime](#the-compose-runtime) · [Dashboard](#the-dashboard) · [Commands](#commands) · [What changed in 2.0](#what-changed-in-20)

---

</div>

## What is blissful-infra?

blissful-infra is a CLI that spins up a real enterprise-shaped stack on your laptop. One command chain gets you a Spring Boot backend, a local Kubernetes cluster provisioned by Terraform, ArgoCD syncing your services from a real git repo, Argo Rollouts running canary deploys, and a web dashboard where you watch the traffic shift and press Promote. No cloud account required.

The idea is that you should be able to try an architecture pattern, throw it away and try the next one in the time it usually takes to read the docs for one of them.

**What makes it different from tools like Tilt or Garden:** those tools orchestrate services you already wrote. blissful-infra also *creates* them, scaffolding production-shaped projects with observability, GitOps and AI tooling wired in from the start.

## The model: tenants, projects, services

Everything hangs off a three-level hierarchy ([ADR-0017](docs/adr/0017-tenant-project-service-hierarchy.md)) that mirrors how cloud providers structure things and how DDD structures domains:

| Level | Maps to | Owns |
|---|---|---|
| **Tenant** | Organization | Dashboard, Jenkins, observability stack (Prometheus, Grafana, Tempo, Loki), and optionally a local Kubernetes cluster |
| **Project** | Domain | Kafka event bus, Postgres, API gateway, isolated Docker network — and a **runtime**: `compose` or `kubernetes` |
| **Service** | Bounded context | One process. Own DB schema. Talks to the world through the project's event bus or gateway |

`blissful-infra use <tenant>[/<project>]` sets a persistent context so you rarely retype the path. Data lives under `~/.blissful-infra/tenants/`, ports are allocated deterministically per level so collisions are impossible by construction.

## Just show me (one command)

```bash
brew install kind kubectl hashicorp/tap/terraform argoproj/tap/kubectl-argo-rollouts   # one-time, plus Docker Desktop running
git clone https://github.com/cavanpage/blissful-infra.git && cd blissful-infra && ./demo.sh
```

`./demo.sh` builds the repo and runs `blissful-infra demo`: it provisions a kind cluster with ArgoCD, Argo Rollouts and Gitea via Terraform, scaffolds a hono service, deploys it through the full GitOps loop and opens up the dashboard on [localhost:3002](http://localhost:3002). Rerun it after editing the service to watch a canary deploy at 10% waiting for your Promote. Everything is idempotent; tear down with `./demo.sh clean` (or `blissful-infra clean --all` to remove every tenant and the dashboard). Curious what it actually built? See [docs/demo-architecture.md](docs/demo-architecture.md).

## Golden path: Kubernetes + ArgoCD + canary deploys

The same flow, step by step ([ADR-0020](docs/adr/0020-local-kubernetes-runtime.md)): a tenant-level kind cluster provisioned by Terraform, with ArgoCD, Argo Rollouts and Gitea inside it. Deploys are GitOps for real — the CLI pushes manifests to the in-cluster Gitea repo, ArgoCD syncs them, and the Rollout canaries the new version.

### Prerequisites (one-time)

```bash
brew install kind kubectl hashicorp/tap/terraform argoproj/tap/kubectl-argo-rollouts
# plus Docker Desktop, running
npm install -g @blissful-infra/cli
```

### The path

```bash
# 1. Tenant + cluster (~3-5 min first run: terraform providers + helm charts)
blissful-infra tenant create acme
blissful-infra cluster up                 # prints ArgoCD + Gitea URLs and credentials

# 2. A kubernetes-runtime project and a service
blissful-infra project create shop --runtime kubernetes
blissful-infra service add orders --type backend

# 3. Deploy: build → kind load → gitops push → ArgoCD sync → canary
blissful-infra deploy orders

# 4. Watch it
blissful-infra canary status orders       # 10% canary / 90% stable, step 1/7
blissful-infra dashboard up               # http://localhost:3002 → Environments tab

# 5. Promote (or let the timed steps walk 10 → 25 → 50 → 100 on their own)
blissful-infra canary promote orders --full

# 6. Ship a change and do it again
#    edit ~/.blissful-infra/tenants/acme/projects/shop/services/orders/src/...
blissful-infra deploy orders

# 7. Roll back (git revert in the gitops repo; ArgoCD converges back)
blissful-infra rollback orders

# 8. Tear down
blissful-infra cluster down               # terraform destroy
```

Every deploy is a commit in the tenant's Gitea repo (`http://localhost:<gitea-port>`, `blissful` / `blissful-dev-pw`) — open it to see the audit trail ArgoCD syncs from. The ArgoCD UI shows the same apps the dashboard's Environments tab reads.

Current limits, by design of the v1 slice: kubernetes-runtime services scaffold without a database binding (no in-cluster Postgres yet) and canary analysis is pause-based rather than metric-driven (no in-cluster Prometheus yet). Both are tracked in [ADR-0020](docs/adr/0020-local-kubernetes-runtime.md).

## The compose runtime

The default runtime (`--runtime compose`, or just omit it) runs everything as Docker Compose with the full infra set wired in:

```bash
blissful-infra init                       # guided wizard: tenant → project → service
# or explicitly:
blissful-infra tenant create acme && blissful-infra tenant up
blissful-infra project create shop
blissful-infra service add orders --type backend
blissful-infra service add web --type frontend
```

Backends get a dedicated Postgres schema on the project's instance (DDD by construction), `KAFKA_BOOTSTRAP_SERVERS` for the project bus, Prometheus scrape labels and Loki log shipping. `service up/down/logs` drive the lifecycle.

## The dashboard

`blissful-infra dashboard up` starts a single control-plane dashboard on `localhost:3002` that manages every tenant:

- **Overview / sidebar** — projects and services with live container status, tenant switcher
- **Environments** — ArgoCD sync state plus a live Canary card: weight bar, step counter, Promote / Promote Full / Abort
- **Logs** — Loki-backed, scoped by tenant/project/service labels
- **Metrics** — Prometheus charts (p95 latency, CPU, memory)
- **Deployments** — history with image tags, strategy, latency deltas and regression flags
- **Graph** — the system ontology: tenant infra, per-project lanes, services, and the cluster components (ArgoCD, Gitea, Argo Rollouts) when a project runs on Kubernetes
- **AI Chat** — an agent with MCP tools that can pull logs, metrics and deploy history on demand (`ANTHROPIC_API_KEY`, bring your own)

## MCP server

`blissful-infra mcp` lets Claude drive the golden path — provision a cluster, deploy a service, watch the canary, promote or abort — as Model Context Protocol tools for Claude Desktop / Claude Code:

```json
{
  "mcpServers": {
    "blissful-infra": { "command": "blissful-infra", "args": ["mcp"] }
  }
}
```

21 tools across discovery (`get_context` returns the whole tenant/project/service tree), scaffolding, lifecycle, Kubernetes (`cluster_up`, `deploy_service`, `canary_control`) and observability. Long operations like `cluster_up` return a job id to poll, so nothing hangs the client. No dashboard, port or API server needed ([ADR-0021](docs/adr/0021-mcp-in-process-control-plane.md)).

## Ship to production: Cloudflare

Local kind is the rehearsal; Cloudflare is production. The same service promotes without changing its local runtime:

```bash
blissful-infra service add orders --type backend --template hono
blissful-infra deploy orders                        # local: kind + ArgoCD + canary
blissful-infra deploy orders --target cloudflare    # production: Workers
```

Frontends go to Pages, `hono` backends go to Workers. The `hono` template keeps its app code free of `node:*` imports, so one source tree runs in the container *and* on Workers. `spring-boot` and `lambda-python` are JVM and CPython, which Workers cannot run — promoting one fails immediately with that explanation rather than a wrangler error. Needs `wrangler` and `wrangler login`; see [ADR-0022](docs/adr/0022-cloudflare-as-promotion-target.md) for the D1-instead-of-Postgres caveat.

## Commands

| Group | Commands |
|---|---|
| Hierarchy | `init`, `use`, `tenant create/list/status/up/down/remove`, `project create/list/status/up/down/remove`, `service add/remove/up/down/logs` |
| Kubernetes | `cluster up/down/status`, `deploy`, `canary status/promote/abort/pause/resume/test`, `rollback` |
| Cloud | `deploy <service> --target cloudflare` |
| CI | `pipeline`, `jenkins`, `status` |
| Intelligence | `agent`, `analyze`, `suggest`, `generate`, `mcp`, `dashboard` |
| Resilience | `perf`, `chaos`, `compare` *(deferred — still keyed to the pre-2.0 flat model)* |

## What changed in 2.0

2.0 is a clean break to the tenant model plus the Kubernetes golden path. Removed:

- **The flat model** (`start`, `create`, `up`, `down`, `logs`, `dev`, `example`) — replaced by the tenant hierarchy and `init`.
- **The client model** (`client …`, old `service …`) — superseded by tenants/projects ([ADR-0017](docs/adr/0017-tenant-project-service-hierarchy.md)).
- **The `lambda` command** — the `lambda-python` template remains on disk and returns when it's ported to the tenant model.
- Per-service plugin scaffolding (`ai-pipeline`, `gatling`, `agent-service`, …).

`perf`, `chaos` and `compare` still ship but haven't been re-keyed to tenant coordinates yet; they error politely.

## Docs

- [Architecture Decision Records](docs/adr/) — the why behind everything
- [blissful-infra.com](https://blissful-infra.com) — guides and reference
- [specs/](specs/) — design docs (some marked historical)

### A note on managed services

Where a paid tier exists upstream, blissful-infra doesn't bundle or recommend it. The aim is production-grade local infrastructure with zero ongoing cost — anything requiring a paid license gets an open-source equivalent or stays out of scope. Longer take: [Philosophy](https://blissful-infra.com/philosophy).

### AI integration

blissful-infra optionally integrates with [Anthropic's Claude API](https://www.anthropic.com/api) for the AI agent and analysis features. Users provide their own `ANTHROPIC_API_KEY`. No key is bundled.

---

<div align="center">

**Iterate in seconds. Deploy with confidence. No cloud required.**

</div>
