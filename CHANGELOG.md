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

### Changed
- `deploy`, `rollback`, `canary` and `pipeline` take tenant coordinates
  (positional service + `--tenant`/`--project`, `use` context fills the
  rest). Namespace convention: the project name; rollout name: the
  service name.
- `service up` on a kubernetes-runtime project delegates to `deploy`.
- Rollout manifests probe `/actuator/health` (the previous manifests
  probed `/ready`/`/live`, which the Spring Boot template never served).
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
