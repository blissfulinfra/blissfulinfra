# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - Unreleased

The clean break to the tenant model (ADR-0017) plus the local Kubernetes
golden path (ADR-0020).

### Added
- **Local Kubernetes runtime**: `blissful-infra cluster up|down|status`
  provisions a per-tenant kind cluster via Terraform (tehcyx/kind provider)
  with ArgoCD, Argo Rollouts and Gitea installed by Helm releases.
- **GitOps deploys**: `blissful-infra deploy <service>` on a
  `--runtime kubernetes` project builds the image, kind-loads it, pushes
  rendered manifests (Rollout + canary/stable Services + ConfigMap) to the
  tenant's in-cluster Gitea repo and lets ArgoCD sync. Pause-based canary
  steps (10→25→50→100) drive progressive delivery.
- `project create --runtime compose|kubernetes` — the runtime axis on
  project.yaml.
- GitOps-first `rollback` (git revert of the last deploy commit; survives
  ArgoCD selfHeal) with `--immediate` as the imperative escape hatch.
- Dashboard: Canary Rollout card in the Environments tab (weight bar,
  step counter, Promote / Promote Full / Abort), ArgoCD + Gitea header
  links, cluster nodes in the ontology graph, strategy/tag chips on
  deployment history.
- API: `GET/POST /api/v1/projects/:service/canary[...]`, argocd/gitea
  links, tenant-aware project-dir resolution on every project route.
- Tenant port blocks gain `kubeApi`/`argocd`/`gitea` (lazily backfilled
  on existing registries).
- CI now runs the test suite (previously build + typecheck only).
- **Dashboard browser tests**: a Playwright suite (`packages/dashboard/e2e/`)
  drives the production bundle in headless chromium with every `/api/v1/**`
  response stubbed at the network boundary, so it needs no Docker, no API
  server and no tenant on disk. Covers the shell, tenant switching, project
  detail, service health, the pipeline/deployments/environments tabs and the
  canary card. Runs as its own `e2e` CI job on every push and PR; locally via
  `npm run test:e2e`.
- **MCP server rebuilt as an in-process control plane** ([ADR-0021](docs/adr/0021-mcp-in-process-control-plane.md)):
  21 tenant-model tools covering discovery, scaffolding, lifecycle, the
  Kubernetes golden path (`cluster_up`, `deploy_service`, `canary_status`,
  `canary_control`) and observability. Long operations return a job id
  polled with `get_job` instead of blocking past the client timeout.
- **Cloudflare promotion target** ([ADR-0022](docs/adr/0022-cloudflare-as-promotion-target.md)):
  `deploy <service> --target cloudflare` ships frontends to Pages and
  `hono` backends to Workers, provisioning declared D1/KV bindings.
- **`hono` backend template** — TypeScript app whose `src/app.ts` avoids
  `node:*`, so one source tree runs under Node in the container (compose
  and kubernetes runtimes) and on Cloudflare Workers.
- `service.yaml` gains an optional `deploy.cloudflare` block
  (`workerName`, `pagesProject`, `accountId`, `d1Database`, `kvNamespace`).

### Changed
- **Documentation and website brought up to 2.0.** The public site still
  documented the pre-2.0 flat/client CLI end to end: the landing page and
  quickstart led with `blissful-infra start`, the sidebar listed four removed
  commands (`start`, `client`, `lambda`, `dev`) and none of the eleven real
  ones, and no page mentioned the tenant model. Rewritten around
  tenant/project/service and the Kubernetes golden path, with a page per real
  command verified against `--help`, three new guides (tenant model, golden
  path, compose runtime), and dated pre-2.0 banners on the blog posts. Removed
  the old Cloudflare "deploy in two commands" section, which described shipping
  a whole project to Pages/Workers/D1/KV/Queues from `blissful-infra.yaml`, and
  the `$5/month hosted tier` schema.org offer. Neither existed. Cloudflare is
  now documented as it actually shipped in ADR-0022: a per-service promotion
  target via `deploy --target cloudflare`, restricted to the `hono` and
  `react-vite` templates, with a `/templates/hono` page and the lost Kafka and
  Postgres bindings stated plainly. Also corrected the stated Node requirement
  (18 to 20), synced the ADR index with the ADR files' own statuses, and marked
  the still-unimplemented specs (`cloud-hosting`, `clickhouse`, `analytics`,
  `media-pipeline`) as designs rather than shipped behaviour.
- Stripped em dashes, decorative arrow glyphs and oxford commas from every
  page of the docs site, per the project's writing conventions.
- `deploy`, `rollback`, `canary` and `pipeline` take tenant coordinates
  (positional service + `--tenant`/`--project`, `use` context fills the
  rest). Namespace convention: the project name; rollout name: the
  service name.
- `service up` on a kubernetes-runtime project delegates to `deploy`.
- Rollout manifests probe a per-template health path rendered from
  `service.yaml` (`spring-boot` → `/actuator/health`, `hono` → `/health`,
  frontend → `/`). It was hardcoded to the actuator path, which would have
  left every non-Spring service permanently failing readiness.
- Jenkins pipeline URLs resolve from the tenant's port block instead of
  a hardcoded `localhost:8081`.

### Removed (breaking)
- **The flat model**: `start`, `create`, `up`, `down`, `logs`, `dev`,
  `example` and the project-first CLI syntax. `init` + the tenant
  hierarchy replace it.
- **The client model**: `client …` and the v1 `service …` commands,
  client registries/compose generators/schemas and their tests.
- **The `lambda` command.** The `lambda-python` template stays on disk
  and returns once ported to the tenant model.
- Per-service plugin scaffolding (`ai-pipeline`, `agent-service`,
  `gatling`, `keycloak`, `localstack` templates) and the `mcp --client`
  flag.
- The `mcp --api` flag and the old flat-model tool surface
  (`list_projects`, `create_project`, `start_project`, `get_health`,
  `query_agent`, …). `start_project` had been dead since the flat-model
  purge — it shelled a command that no longer existed.
- The unreachable flat-model cloud deploy modules (`deploy/index.ts`,
  `deploy/vercel.ts`, `deploy/aws.ts`). Nothing imported `deployProject`;
  they were keyed to the purged `blissful-infra.yaml` and stale against
  wrangler v4. AWS returns as a `--target` per ADR-0022.
- Legacy k8s manifests under `templates/spring-boot/k8s/` (replaced by
  `templates/gitops/service/`) and the Jenkinsfile kubectl/argocd
  stages — CI is off the deploy critical path.

### Deferred
- `perf`, `chaos`, `compare` still ship but remain keyed to the removed
  flat model; they fail politely until re-keyed.
- In-cluster Postgres/Kafka for kubernetes-runtime services (services
  currently scaffold without a DB binding on that runtime) and
  metric-driven canary analysis (needs in-cluster Prometheus).

## [1.x]

Pre-2.0 history (flat model, client model, phases 1-6) is captured in
the git log and docs/adr/0001-0016.
