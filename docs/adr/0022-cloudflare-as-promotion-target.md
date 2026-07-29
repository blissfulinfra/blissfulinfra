# 0022. Cloudflare is a promotion target, and Hono is the template that can reach it

- **Status:** Accepted
- **Date:** 2026-07-28
- **Deciders:** @cavanpage

## Context

`blissful-infra` had cloud deploy modules for Cloudflare, Vercel and AWS in `src/deploy/`, dispatched by `deployProject()` in `src/deploy/index.ts`. None of it was reachable: nothing imported `deployProject`, and `commands/deploy.ts` routed only on `runtime === "kubernetes"`. They were keyed to `LegacyProjectConfig` (`blissful-infra.yaml`), the flat model deleted in the 2.0 purge, and were shaped around a monolith (`projectDir/frontend`, `projectDir/backend`) rather than the per-service model of ADR-0017.

They had also gone stale against wrangler v4: `kv:namespace create` (now `kv namespace create`), `d1 create --experimental-backend` (flag removed), and `d1 migrations apply` without the now-required `--remote`/`--local`. They would have failed even if reachable.

The harder constraint is what can actually run on Cloudflare. Workers execute Web-standard fetch handlers on a V8 isolate — there is no JVM and no CPython. Both existing backend templates (`spring-boot`, `lambda-python`) are therefore permanently ineligible. Shipping "deploy to Cloudflare" against them would produce an opaque wrangler failure at upload time for the majority of scaffolded services.

## Decision

**Cloudflare is a promotion target, not a runtime.** Local kind is the rehearsal; Cloudflare is production. `deploy <service> --target cloudflare` promotes a service regardless of the project's local runtime, so `runtime: compose | kubernetes` keeps meaning "where this runs locally" and stays orthogonal to where it ships. This preserves the product's core story — the local sandbox is the thing you rehearse against — rather than forking scaffolding into a third runtime whose artifact is not a container.

Routing by service type:

| Service type | Cloudflare product | Command |
|---|---|---|
| `frontend` (react-vite) | Pages | `wrangler pages deploy dist --project-name <project>-<service>` |
| `backend` / `worker` (hono) | Workers | `wrangler deploy --name <project>-<service>` |

**A new `hono` backend template makes the path real.** Its source is split so one service has two homes:

- `src/app.ts` — the application, importing nothing from `node:*`. That constraint is what makes it portable.
- `src/server.ts` — Node entry via `@hono/node-server`, listening on 8080. This is what the container image runs, so the service works under the compose and kubernetes runtimes exactly like any other.
- `src/worker.ts` — default-exports the app, which is already a Workers fetch handler.

An attempt to promote a `spring-boot` or `lambda-python` service fails fast with an explanation and a pointer to `--template hono`, instead of a wrangler error.

Configuration lives in `service.yaml` under `deploy.cloudflare` (`workerName`, `pagesProject`, `accountId`, `d1Database`, `kvNamespace`). Every field defaults from the service coordinates, so an absent block still deploys. D1 and KV are provisioned only when declared; "already exists" is treated as success so redeploys are idempotent. `accountId` is passed as `CLOUDFLARE_ACCOUNT_ID` — wrangler has no per-command flag for it.

Adding the template exposed a latent bug: the Rollout manifest hardcoded `path: /actuator/health` on all three probes, a Spring Boot assumption that would have left any other service permanently unready in Kubernetes. The probe path is now rendered per-template from `service.yaml` (`HEALTH_PATH`), defaulting to the actuator path so existing deployments are unaffected.

The dead Vercel and AWS modules and the `deployProject` dispatcher are deleted rather than left to rot (git history keeps them). AWS is a follow-up: an ECS/Fargate target suits the container-shaped `spring-boot` services that Cloudflare structurally cannot host, which makes it complementary rather than redundant.

## Consequences

- **Positive:**
  - A genuinely working production path: `service add x --type backend --template hono` → `service up` locally → `deploy x --target cloudflare`.
  - Same source, same tests, two runtimes — the promotion story is real rather than a re-scaffold.
  - The k8s probe fix makes every non-Spring template deployable to the local cluster, which was broken before and would have stayed broken.
  - `deploy --target` is a natural seam for the AWS follow-up.
- **Negative:**
  - Two backend templates cannot reach Cloudflare, which needs saying in the docs rather than discovering at deploy time.
  - A promoted service loses its project bindings: no Kafka, and the project's shared Postgres is unreachable from Workers. D1 is the substitute, and the data layer differs between the local rehearsal and production — the sharpest edge in this design.
  - Requires `wrangler` on the host plus `wrangler login`; both are checked up front rather than mid-deploy.
- **Neutral:**
  - Pages and Workers deploys are not progressive. Cloudflare gradual deployments exist but are out of scope; rollback is `wrangler rollback`.
