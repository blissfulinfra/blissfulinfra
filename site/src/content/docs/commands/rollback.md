---
title: blissful-infra rollback
description: Roll a Kubernetes-runtime service back by reverting the deploy commit in the gitops repo, so ArgoCD converges back on its own.
---

`rollback` undoes a deploy by reverting its commit in the tenant's gitops repo. ArgoCD sees the revert and converges the cluster back.

```bash
blissful-infra rollback orders
```

## Usage

```bash
blissful-infra rollback [service] [options]
```

`[service]` resolves through your [`use`](/commands/use) context when omitted.

## Options

| Flag | What it does |
|---|---|
| `--tenant <tenant>` | Tenant (defaults to context) |
| `--project <project>` | Project (defaults to context, falls back to a registry scan) |
| `--immediate` | Imperative `kubectl-argo-rollouts undo` instead of a git revert |
| `-r`, `--revision <id>` | Rollout revision for `--immediate` (omit to see the history) |
| `--dry-run` | Show what would be rolled back without applying |

## Why GitOps-first

The default path is a git revert, not an imperative undo, and the difference matters.

ArgoCD's selfHeal continuously reconciles the cluster against what is in git. An imperative rollback changes the cluster but not the repo, so selfHeal sees drift and puts the new version straight back. Reverting the commit makes git and the cluster agree on the old version, which is the only rollback that sticks.

It also keeps the audit trail honest: the repo shows a deploy followed by a revert, rather than a deploy and an unexplained cluster state.

## The escape hatch

`--immediate` runs `kubectl-argo-rollouts undo` directly. It is faster, and useful when you need traffic moved *now* and will fix the repo afterwards — but it does not survive selfHeal.

```bash
blissful-infra rollback orders --immediate              # list revisions
blissful-infra rollback orders --immediate -r 3         # undo to revision 3
```

Treat it as a stopgap. Follow it with a real revert, or the next reconcile undoes your undo.

## Dry run

```bash
blissful-infra rollback orders --dry-run
```

Shows which commit would be reverted without touching the repo.

## See also

- [`deploy`](/commands/deploy) — what you are undoing
- [`canary`](/commands/canary) — abort an in-flight rollout instead
- [The golden path](/guides/golden-path)
