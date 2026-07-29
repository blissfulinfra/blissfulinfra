---
title: blissful-infra canary
description: Drive Argo Rollouts canary deployments on the tenant's kind cluster. status, promote, abort, pause, resume.
---

`canary` drives the Argo Rollout that [`deploy`](/commands/deploy) starts. A rollout shifts traffic in steps and pauses between them; these commands let you promote early, hold, or abort back to stable.

```bash
blissful-infra canary status orders
```

## Subcommands

| Command | What it does |
|---|---|
| `canary status [service]` | Show rollout status: weight, step, health |
| `canary promote [service]` | Promote to the next step, or fully with `--full` |
| `canary abort [service]` | Abort the rollout and go back to stable |
| `canary pause [service]` | Pause at the current step |
| `canary resume [service]` | Resume a paused rollout |
| `canary test [service]` | Test canary rollback behaviour |

## Common options

Every subcommand takes:

| Flag | What it does |
|---|---|
| `--tenant <tenant>` | Tenant (defaults to context) |
| `--project <project>` | Project (defaults to context, falls back to a registry scan) |

`canary promote` additionally takes `--full` to skip the remaining steps and go straight to 100%.

## The steps

A rollout walks four weights with a pause after each of the first three:

| Step | Weight | Pause |
|---|---|---|
| 1 | 10% | 2m |
| 2 | 25% | 2m |
| 3 | 50% | 5m |
| 4 | 100% | - |

Left alone, it walks the whole way on its own. The pauses exist so you have a window to look at the service under partial traffic and decide.

## Promoting

```bash
blissful-infra canary promote orders          # next step only
blissful-infra canary promote orders --full   # skip the rest, go to 100%
```

## Aborting

```bash
blissful-infra canary abort orders
```

Sends traffic back to the stable version immediately. The canary ReplicaSet is scaled down. This does not revert the gitops commit. The manifests in Gitea still describe the new version, so ArgoCD may re-sync it. To undo the deploy properly, use [`rollback`](/commands/rollback).

## Why pauses instead of metrics

Argo Rollouts supports analysis steps that query Prometheus and promote or abort automatically. That needs an in-cluster Prometheus, which the current slice does not ship: the tenant's Prometheus runs on the compose side. So the rollout template uses timed pauses and leaves the judgement call to you.

Wiring in-cluster Prometheus so analysis steps can come back is tracked as a follow-up in ADR-0020.

## From the dashboard

The Environments tab renders the same rollout as a card with a live weight bar, a step counter and Promote / Promote Full / Abort buttons:

```bash
blissful-infra dashboard up
```

The card only appears for kubernetes-runtime projects. Compose projects have no Rollout.

## See also

- [`deploy`](/commands/deploy): starts the rollout
- [`rollback`](/commands/rollback): revert the deploy commit
- [The golden path](/guides/golden-path)
