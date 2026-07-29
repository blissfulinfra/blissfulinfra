---
title: blissful-infra deploy
description: Deploy a service locally to kind and ArgoCD with a canary rollout, or promote it to Cloudflare Workers and Pages with --target cloudflare.
---

`deploy` has two targets. By default it ships a service to the project's local Kubernetes runtime through a real GitOps loop. With `--target cloudflare` it promotes the same service to Cloudflare.

```bash
blissful-infra deploy orders                       # local kind + ArgoCD + canary
blissful-infra deploy orders --target cloudflare   # promote to Cloudflare
```

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
| `--target <target>` | `kubernetes` (default, follows the project runtime) or `cloudflare` |
| `--tag <tag>` | Image tag (defaults to the service's git short SHA) |
| `--dry-run` | Show what would be deployed without making any changes |

## The two targets

**`kubernetes`** is the default and requires a project created with `--runtime kubernetes` plus a tenant with a cluster ([`cluster up`](/commands/cluster)). This is the local rehearsal: real GitOps, real canary, on your laptop.

**`cloudflare`** is a promotion target rather than a runtime. It works regardless of the project's local runtime, so `runtime: compose | kubernetes` keeps meaning "where this runs locally" and stays orthogonal to where it ships. See [Promoting to Cloudflare](#promoting-to-cloudflare) below.

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

## Promoting to Cloudflare

```bash
blissful-infra deploy orders --target cloudflare
```

Local kind is the rehearsal. Cloudflare is production. The same service source ships to both.

### Only the `hono` template can reach Workers

Cloudflare Workers run Web-standard fetch handlers on a V8 isolate. There is no JVM and no CPython, so `spring-boot` and `lambda-python` backends **cannot** be promoted. This is a structural limit, not a missing feature.

| Service type | Template | Cloudflare product |
|---|---|---|
| `backend` / `worker` | `hono` | Workers |
| `frontend` | `react-vite` | Pages |
| `backend` | `spring-boot`, `lambda-python` | not eligible |

Trying to promote an ineligible service fails immediately with a pointer to `--template hono`, rather than an opaque wrangler error at upload time.

```bash
blissful-infra service add orders --type backend --template hono
```

### How one source runs in both places

The `hono` template splits its entry points so a single service has two homes:

| File | Role |
|---|---|
| `src/app.ts` | The application. Imports nothing from `node:*`, which is what makes it portable |
| `src/server.ts` | Node entry via `@hono/node-server` on port 8080. This is what the container image runs |
| `src/worker.ts` | Default-exports the app, which is already a Workers fetch handler |

So the service runs under the compose and kubernetes runtimes exactly like any other, and the same code promotes to Workers with no rewrite.

### Prerequisites

```bash
npm install -g wrangler@latest
wrangler login
```

Both are checked up front rather than mid-deploy.

### Configuration

Everything defaults from the service coordinates, so an absent config still deploys. Worker and Pages names both default to `<project>-<service>`. To override, add a `deploy.cloudflare` block to the service's `service.yaml`:

```yaml
deploy:
  cloudflare:
    workerName: shop-orders
    pagesProject: shop-web
    accountId: abc123
    d1Database: shop-orders-db
    kvNamespace: shop-orders-cache
```

D1 and KV are provisioned only when declared. "Already exists" counts as success, so redeploys are idempotent. If the service has a `d1:migrate` script, migrations run with `--remote` after provisioning.

`accountId` is passed as `CLOUDFLARE_ACCOUNT_ID` because wrangler has no per-command flag for it.

### What a promoted service loses

This is the sharpest edge in the design and worth understanding before you rely on it.

A service on Cloudflare has **no Kafka** and **cannot reach the project's shared Postgres**. D1 is the substitute for persistence, which means the data layer genuinely differs between your local rehearsal and production. Nothing migrates schemas between the two.

Pages and Workers deploys are also **not progressive**. There is no canary equivalent to the local rollout; rollback is `wrangler rollback`.

## See also

- [The golden path](/guides/golden-path): the full local flow end to end
- [`cluster`](/commands/cluster): provision the local cluster first
- [`canary`](/commands/canary): drive the local rollout
- [`rollback`](/commands/rollback): undo a local deploy
