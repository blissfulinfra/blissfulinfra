---
title: blissful-infra deploy
description: Deploy a service to the project's Kubernetes runtime. build, kind load, GitOps push, ArgoCD sync, canary rollout.
---

`deploy` ships a service to the project's Kubernetes runtime. It is a real GitOps loop: the CLI renders manifests, commits them to the tenant's in-cluster Gitea repo, and ArgoCD syncs them into the cluster where Argo Rollouts runs a canary.

```bash
blissful-infra deploy orders
```

This command requires a project created with `--runtime kubernetes` and a tenant with a cluster ([`cluster up`](/commands/cluster)). It does not deploy to any cloud provider.

## Usage

```bash
blissful-infra deploy [service] [options]
```

`[service]` resolves through your [`use`](/commands/use) context when omitted.

## Options

| Flag | What it does |
|---|---|
| `--tenant <tenant>` | Tenant (defaults to context) |
| `--project <project>` | Project (defaults to context, falls back to a registry scan) |
| `--tag <tag>` | Image tag (defaults to the service's git short SHA) |
| `--dry-run` | Show what would be deployed without making any changes |

## What actually happens

1. **Build** the service image from its Dockerfile
2. **kind load** the image onto the cluster node: kind-loaded images never pull, so `imagePullPolicy` is `IfNotPresent`
3. **Render** the Rollout, canary/stable Services and ConfigMap from the gitops templates
4. **Commit and push** them to the tenant's Gitea repo. This is the audit trail
5. **ArgoCD syncs** the commit into the project's namespace
6. **Argo Rollouts** starts the canary

Start with `--dry-run` if you want to see the rendered manifests before anything is committed.

## The canary

The rollout walks four weights, pausing at each step so you can promote early or abort:

| Step | Weight | Then |
|---|---|---|
| 1 | 10% | pause 2m |
| 2 | 25% | pause 2m |
| 3 | 50% | pause 5m |
| 4 | 100% | done |

Pauses are time-based rather than metric-driven, because there is no in-cluster Prometheus yet. Each pause is promotable early from the CLI or the dashboard:

```bash
blissful-infra canary status orders
blissful-infra canary promote orders          # next step
blissful-infra canary promote orders --full   # straight to 100%
blissful-infra canary abort orders            # back to stable
```

[More on `canary`](/commands/canary)

## Image tags

The tag defaults to the service's git short SHA, so each deploy is traceable to a commit. Override it when you need to:

```bash
blissful-infra deploy orders --tag experiment-1
```

## Rolling back

```bash
blissful-infra rollback orders
```

This reverts the deploy commit in the gitops repo and lets ArgoCD converge back, which survives ArgoCD's selfHeal, unlike an imperative rollback. [More on `rollback`](/commands/rollback)

## Watching it

The dashboard's Environments tab shows ArgoCD sync state and a live canary card with a weight bar, step counter and Promote / Promote Full / Abort buttons:

```bash
blissful-infra dashboard up
```

You can also open ArgoCD and Gitea directly. `cluster up` prints both URLs and their credentials.

## See also

- [The golden path](/guides/golden-path): the full flow end to end
- [`cluster`](/commands/cluster): provision the cluster first
- [`canary`](/commands/canary): drive the rollout
- [`rollback`](/commands/rollback): undo a deploy
