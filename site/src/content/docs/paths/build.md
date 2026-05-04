---
title: Build path
description: One command to a production-grade local stack. Skip the theory, prototype now, dig deeper later.
---

This path is for engineers who already know what they're doing and just want a working stack now. You have an idea. You want to validate it before you commit a weekend to it. You don't want to spend three hours wiring Postgres to a backend before you've written a line of business logic.

## The 60-second loop

```bash
npm install -g @blissful-infra/cli
blissful-infra start my-app --backend spring-boot --database postgres-redis
```

That's the whole setup. You now have:

- A backend at `http://localhost:8080` with REST, Kafka, Postgres and Redis caching wired in
- A frontend at `http://localhost:3000` already calling the backend
- Grafana, Prometheus, Loki, Jaeger running and pre-provisioned with dashboards
- A Jenkins pipeline ready to build and deploy your service
- A management dashboard at `http://localhost:3002`

Open the generated project in your editor. Modify the controllers, add your own endpoints, push events through Kafka. Iterate.

→ [Quickstart](/getting-started) · [`start` command](/commands/start)

## Pick your stack

| Backend | Best for |
|---|---|
| [`spring-boot`](/templates/spring-boot) | Long-running HTTP API, JPA + Postgres, Kafka producer + consumer, mature JVM observability |
| [`lambda-python`](/templates/lambda-python) | Event-driven serverless workloads, learning AWS Lambda locally on LocalStack |

Frontend is [React + Vite](/templates/react-vite). Other frameworks are deliberately out of scope until they're real — see the [Philosophy](/philosophy) page.

```bash
blissful-infra start my-app --backend spring-boot --frontend react-vite
```

## When you outgrow a single project

The moment you have more than one project running locally, switch to the [client model](/guides/client-model). Each client gets its own isolated stack — separate Kafka, Postgres and observability — so projects don't conflict on ports or pollute each other's data.

```bash
blissful-infra client create idea-one
blissful-infra service add idea-one api --backend spring-boot --frontend react-vite
blissful-infra client up idea-one
```

→ [Client model guide](/guides/client-model) · [`client` command](/commands/client) · [`service` command](/commands/service)

## Adding things you actually need

| Need | Add |
|---|---|
| AWS-shaped storage / queues / Lambda | LocalStack at the client level — see the [warehouse guide](/guides/warehouse) |
| ML pipeline (Kafka → classifier → ClickHouse + MLflow) | `--plugins ai-pipeline` on `service add` |
| Identity provider | Keycloak at the client level (opt-in via `infrastructure.keycloak: true`) |
| Distributed tracing across services | Jaeger is already wired — instrument and watch it work |

## Shipping it

When the prototype works and you want it on the internet:

```bash
blissful-infra deploy
```

The same `blissful-infra.yaml` that defines your local stack drives the deploy. Cloudflare Pages and Workers are the default target. Vercel and AWS adapters are in flight.

→ [`deploy` command](/commands/deploy)

## When to read the theory

If you hit something you don't understand — a Kafka consumer-group rebalance, a JPA cascade behavior, a Prometheus histogram quantile — that's when the [Learn path](/paths/learn) becomes useful. The build path gets you running; the learn path explains why each piece looks the way it does.
