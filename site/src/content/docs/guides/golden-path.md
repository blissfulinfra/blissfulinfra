---
title: The golden path (Kubernetes)
description: A local kind cluster provisioned by Terraform, ArgoCD syncing from a real git repo, and Argo Rollouts running canary deploys — end to end on your laptop.
---

The flagship flow: a tenant-level [kind](https://kind.sigs.k8s.io/) cluster provisioned by Terraform, with ArgoCD, Argo Rollouts and Gitea inside it. Deploys are GitOps for real — the CLI pushes manifests to the in-cluster Gitea repo, ArgoCD syncs them, and the Rollout canaries the new version.

## Prerequisites

```bash
brew install kind kubectl hashicorp/tap/terraform argoproj/tap/kubectl-argo-rollouts
npm install -g @blissful-infra/cli
```

Plus Docker Desktop, running. None of this is needed for [the compose runtime](/guides/compose-runtime) — only for this path.

## The path

### 1. Tenant and cluster

```bash
blissful-infra tenant create acme
blissful-infra cluster up
```

Budget **3–5 minutes** for the first `cluster up`: Terraform downloads providers and Helm pulls the ArgoCD, Argo Rollouts and Gitea charts. It prints the ArgoCD and Gitea URLs and credentials when it finishes.

### 2. A kubernetes-runtime project and a service

```bash
blissful-infra project create shop --runtime kubernetes
blissful-infra service add orders --type backend
```

`--runtime kubernetes` is the consequential flag. It makes the project a namespace on the cluster and its services Argo Rollouts, rather than plain containers. It cannot be changed later without recreating the project.

### 3. Deploy

```bash
blissful-infra deploy orders
```

Five things happen:

1. **Build** the service image
2. **kind load** it onto the cluster node — kind-loaded images never pull
3. **Render** the Rollout, canary/stable Services and ConfigMap
4. **Commit and push** to the tenant's Gitea repo
5. **ArgoCD syncs** the commit, and Argo Rollouts starts the canary

### 4. Watch it

```bash
blissful-infra canary status orders     # 10% canary / 90% stable, step 1/7
blissful-infra dashboard up             # Environments tab
```

The dashboard's Environments tab shows the rollout live: a weight bar, a step counter and Promote / Promote Full / Abort buttons.

### 5. Promote

The rollout walks four weights on its own, pausing between them. Promote early when you have seen enough:

```bash
blissful-infra canary promote orders           # next step
blissful-infra canary promote orders --full    # straight to 100%
```

| Step | Weight | Pause |
|---|---|---|
| 1 | 10% | 2m |
| 2 | 25% | 2m |
| 3 | 50% | 5m |
| 4 | 100% | — |

### 6. Ship a change

```bash
# edit ~/.blissful-infra/tenants/acme/projects/shop/services/orders/src/...
blissful-infra deploy orders
```

Another commit, another sync, another canary.

### 7. Roll back

```bash
blissful-infra rollback orders
```

This reverts the deploy commit in the gitops repo and lets ArgoCD converge back. That matters: ArgoCD's selfHeal continuously reconciles the cluster against git, so an imperative rollback would be undone on the next reconcile. Reverting the commit is the only rollback that sticks.

### 8. Tear down

```bash
blissful-infra cluster down     # terraform destroy
```

## Why this shape

**Gitea is in the cluster, and that is the point.** The deploy loop could have been "run kubectl apply". Instead the CLI commits rendered manifests to a real git server and lets ArgoCD pull them. That makes the loop genuinely the same shape as a production GitOps setup: every deploy is a commit, the repo is the source of truth, and rollback is a revert. Open Gitea at the URL `cluster up` printed and you can read the whole deploy history as commits.

**Argo Rollouts, not Deployments.** A Kubernetes Deployment gives you a rolling update, which is not a canary — there is no point at which a known fraction of traffic is on the new version and you get to decide. Rollouts give you weights, pauses and an explicit promote.

## Current limits

Two, both deliberate scoping decisions for the first slice:

**No in-cluster Postgres.** Kubernetes-runtime services scaffold without a database binding. The tenant's Postgres runs on the compose side and the cluster cannot reach it.

**Canary analysis is pause-based, not metric-driven.** Argo Rollouts can query Prometheus and promote or abort automatically, but that needs an in-cluster Prometheus, which is not there yet. So the rollout uses timed pauses and leaves the call to you.

Both are tracked as follow-ups in ADR-0020.

## Troubleshooting

**`cluster up` hangs or times out.** Usually Docker running low on resources — kind needs a few GB. Check `docker stats` and Docker Desktop's memory allocation.

**The rollout never leaves step 1.** Check the pods are actually passing their readiness probe: `blissful-infra cluster status`. The Spring Boot template probes `/actuator/health`.

**ArgoCD shows OutOfSync after a rollback.** Expected briefly while it converges. If it persists, the revert commit may not have pushed — check the Gitea repo directly.

## See also

- [`cluster`](/commands/cluster) · [`deploy`](/commands/deploy) · [`canary`](/commands/canary) · [`rollback`](/commands/rollback)
- [The tenant model](/guides/tenant-model)
