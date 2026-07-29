---
title: Hono template
description: A TypeScript backend that runs in a container locally and promotes to Cloudflare Workers unchanged. The only template that can reach Workers.
---

The `hono` template generates a TypeScript backend built on [Hono](https://hono.dev). It is the only backend template that can be promoted to Cloudflare Workers, and it runs in a container locally exactly like any other service.

```bash
blissful-infra service add orders --type backend --template hono
```

## Why this template exists

Cloudflare Workers execute Web-standard fetch handlers on a V8 isolate. There is no JVM and no CPython, so `spring-boot` and `lambda-python` can never run there. If you want a service that rehearses locally and ships to production, this is the template.

## One source, two homes

The source is split so the same application runs under Node in a container and on Workers:

| File | Role |
|---|---|
| `src/app.ts` | The application. Imports nothing from `node:*`, which is what makes it portable |
| `src/server.ts` | Node entry via `@hono/node-server`, listening on 8080 to match the Rollout's `containerPort`. This is what the container image runs |
| `src/worker.ts` | Default-exports the app, which is already a Workers fetch handler |

The `node:*` constraint on `app.ts` is the whole trick. Keep your application logic there and it stays deployable to both. Anything that genuinely needs Node APIs belongs in `server.ts`.

## Layout

```
<service>/
├── package.json
├── tsconfig.json
├── wrangler.jsonc          # Workers config
├── Dockerfile              # container image for compose / kubernetes
└── src/
    ├── app.ts              # the application (no node:* imports)
    ├── app.test.ts         # vitest
    ├── server.ts           # Node entry, port 8080
    └── worker.ts           # Workers entry
```

## Routes it ships with

| Route | Purpose |
|---|---|
| `GET /health` | Probed by the Argo Rollout and the Docker healthcheck |
| `GET /` | Service identity JSON |
| `GET /api/hello?name=` | A trivial example handler |

Note the health path is `/health`, not `/actuator/health`. The Rollout manifest renders the probe path per template, so this is wired correctly without any action from you.

## Scripts

```bash
npm run dev          # tsx watch on src/server.ts (Node)
npm run dev:worker   # wrangler dev (Workers runtime locally)
npm run build        # tsc
npm test             # vitest
npm run typecheck    # tsc --noEmit
```

`dev:worker` is worth knowing about: it runs your service on the actual Workers runtime locally, which catches `node:*` leakage before a deploy does.

## Running locally

Same as any other service, on either runtime:

```bash
blissful-infra service up orders
blissful-infra service logs orders
```

On a `--runtime kubernetes` project, `service up` delegates to [`deploy`](/commands/deploy) and the service goes through a canary rollout like anything else.

## Promoting to Cloudflare

```bash
npm install -g wrangler@latest
wrangler login
blissful-infra deploy orders --target cloudflare
```

The worker name defaults to `<project>-<service>`. Configuration is optional; to override it or to declare D1 and KV bindings, add a `deploy.cloudflare` block to `service.yaml`.

[Full promotion details](/commands/deploy#promoting-to-cloudflare)

## What changes in production

A promoted service is not in your project's Docker network, so:

- **No Kafka.** The project's event bus is unreachable from Workers.
- **No shared Postgres.** Use D1 instead, declared as `d1Database` in `service.yaml`.
- **No progressive delivery.** Pages and Workers deploys are not canaried; rollback is `wrangler rollback`.

The data layer therefore differs between the local rehearsal and production, and nothing migrates schemas between them. Worth designing around rather than discovering later.

## See also

- [`deploy`](/commands/deploy): both deploy targets
- [`service`](/commands/service): adding and running services
- [Templates overview](/templates/overview)
