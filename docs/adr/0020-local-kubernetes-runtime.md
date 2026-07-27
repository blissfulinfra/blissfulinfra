# 0020. Local Kubernetes runtime: kind + Terraform + ArgoCD + Argo Rollouts + Gitea

- **Status:** Accepted
- **Date:** 2026-07-27
- **Deciders:** @cavanpage

## Context

The long-deferred "local Kubernetes story" ([root CLAUDE.md TODO, since resolved]) was gated on the cloud-deploy dispatcher rewrite, which shipped and left `deploy.ts` clean. Meanwhile the tenant model (ADR-0017) had no deploy story at all — `service up` was `docker compose up --build` — and a full Argo Rollouts CLI surface (`utils/rollouts.ts`, `canary.ts`) plus production-shaped Rollout manifests sat dormant in the repo with nothing to run against. The goal: a golden path where the CLI provisions a local cluster and rolls out software with real GitOps and progressive delivery, visible in the dashboard.

## Decision

Kubernetes is a **runtime, not a deploy target**: `project.yaml` gains `runtime: compose | kubernetes` and `DeployTargetSchema` stays cloud-only (local k8s is where services *run*, cloud targets are where they *ship*).

Topology maps the ADR-0017 hierarchy onto the cluster:

| Level | Kubernetes shape |
|---|---|
| Tenant | one kind cluster, `blissful-<tenant>`, plus ArgoCD, Argo Rollouts and Gitea installed in it |
| Project | one namespace, named after the project |
| Service | one Argo Rollout + canary/stable Services + ConfigMap, one ArgoCD Application per service |

**Provisioning is Terraform** (per the original TODO's intent): `cluster up` renders `templates/cluster/terraform/` into `~/.blissful-infra/tenants/<t>/cluster/` and runs `terraform init/apply`. The `tehcyx/kind` provider creates the cluster (over shelling out: one apply orders cluster → helm releases declaratively, `terraform destroy` is teardown for free, state detects drift). Pinned: provider `~> 0.6`, `kindest/node:v1.31.4`, charts argo-cd 7.7.11 / argo-rollouts 2.39.0 / gitea 10.6.0. The kind CLI remains a prereq anyway — the deploy path needs `kind load docker-image`.

**GitOps origin is in-cluster Gitea** (sqlite, single pod, fixed dev creds, NodePort-mapped to the tenant's `gitea` port). One repo per tenant, `blissful/<tenant>-gitops`, laid out `projects/<project>/<service>/`. ArgoCD Applications point at the in-cluster DNS name so sync works with zero host networking tricks; the CLI pushes from the host via the NodePort.

**Deploys are CLI-driven** (Jenkins stays tenant-level CI but is off the critical path): `blissful-infra deploy <service>` = docker build → `kind load` → render-or-bump manifests in the gitops checkout → push → ArgoCD auto-sync (prune + selfHeal) → the Rollout runs **pause-based canary steps** (10 → 25 → 50 → 100). No in-cluster Prometheus yet, so no analysis steps — promotion is explicit via `canary promote` or the dashboard's Canary card. Rollback is GitOps-first (`git revert` of the last deploy commit; the only rollback that survives selfHeal) with `--immediate` as the `kubectl argo rollouts undo` escape hatch.

**Ports:** tenant blocks gain optional `kubeApi` (6550+i), `argocd` (8440+i), `gitea` (3300+i), lazily backfilled by `ensureClusterPorts()` so pre-k8s registry entries stay valid. Bases verified clear of every existing range by a property test.

## Consequences

- **Positive:**
  - Real GitOps + progressive delivery on a laptop with one command chain; the ArgoCD and Gitea UIs make the demo inspectable.
  - Terraform state gives idempotent re-runs, drift detection and clean teardown.
  - The dormant rollouts/canary CLI surface and the dashboard's ArgoCD-vocabulary Environments tab both light up with no conceptual changes.
- **Negative:**
  - Four host prereqs (docker, kind, terraform, kubectl + argo-rollouts plugin).
  - First `cluster up` is network-heavy (provider + chart downloads, ~3-5 min).
  - kubectl/canary commands rely on the kind-managed kubeconfig context (`kind-blissful-<tenant>`).
- **Risks / follow-ups:**
  - **No in-cluster project infra yet**: kubernetes-runtime services scaffold without a Postgres binding (a DB binding would crashloop every pod on Flyway). In-cluster Kafka/Postgres, or bridging to the compose infra, is the next slice.
  - Analysis-driven canaries need in-cluster Prometheus; the pause-based steps are the v1 stand-in.
  - Pre-existing (unrelated) port-range overlap: tenant jenkins `8081+i` can collide with project gateway `8080+offset` (e.g. tenant 1 jenkins = tenant 0/project 2 gateway = 8082). Known, not addressed here.
  - Chart/provider pins will need periodic bumps; all live in `templates/cluster/terraform/`.

## Alternatives considered

- **minikube / k3d** instead of kind: kind is the CI-standard, single-binary choice and the tehcyx Terraform provider covers it; nothing in scope needs minikube's VM drivers or k3d's registry conveniences.
- **Shell-out orchestration instead of Terraform:** fewer prereqs, but hand-rolled idempotency/teardown/partial-failure handling, and the original TODO explicitly scoped Terraform to this work.
- **Host-mounted bare repo / git-http sidecar instead of Gitea:** ArgoCD's repo-server can't read `file://` paths, and ad-hoc git-http images are less maintained than the Gitea chart; Gitea also gives a browsable UI for the demo.
- **Jenkins-driven deploys:** per-tenant Jenkins never had job registration wired and its URLs were hardcoded; fixing that belongs to a CI slice, not the deploy critical path.
- **Local k8s as a `DeployTargetSchema` member:** rejected — deploy targets describe cloud shipping; conflating them regressed `rollback` into running `argocd` against Cloudflare projects once already.

## References

- [ADR-0017: Tenant / Project / Service hierarchy](./0017-tenant-project-service-hierarchy.md)
- [specs/cloud-deploy.md](../../specs/cloud-deploy.md) — the dispatcher this work stays out of
- `packages/cli/templates/cluster/terraform/`, `packages/cli/templates/gitops/service/`
- `packages/cli/src/deploy/kubernetes.ts`, `src/commands/cluster.ts`, `src/utils/{gitea,gitops,kind,terraform}.ts`
