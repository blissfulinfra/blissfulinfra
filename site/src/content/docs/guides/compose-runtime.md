---
title: The compose runtime
description: The default runtime. every service is a container on the project's isolated Docker network, with Kafka, Postgres, observability and CI wired in.
---

The default runtime. Every service is a container on its project's isolated Docker network, with the full infrastructure set wired in. Nothing to install beyond Docker.

```bash
blissful-infra project create shop      # --runtime compose is the default
```

## What runs where

Three compose files, one per level:

| File | Level | Runs |
|---|---|---|
| `docker-compose.tenant.yaml` | Tenant | Jenkins, Prometheus, Grafana, Tempo, Loki |
| `docker-compose.project.yaml` | Project | Kafka, Postgres, Redis, API gateway |
| `docker-compose.yaml` | Service | Your service, joining the project network |

They come up independently, so you can restart one service without touching the project's Kafka, and restart a project without touching the tenant's Grafana.

```bash
blissful-infra tenant up        # CI + observability
blissful-infra project up       # Kafka, Postgres, gateway
blissful-infra service up orders
```

## What a service gets

Scaffold a backend and it comes wired to the project's infrastructure:

- **Its own Postgres schema** on the project's instance, with migrations
- **`KAFKA_BOOTSTRAP_SERVERS`** pointing at the project's bus
- **Prometheus scrape labels**, so metrics land in the tenant's Prometheus automatically
- **Loki log shipping**, labelled by tenant, project and service
- **OpenTelemetry** traces to the tenant's Tempo

None of this is opt-in. A service you scaffold is observable from the moment it starts.

## Isolation

Each project gets its own Docker network. Services in different projects cannot reach each other directly. They go through the gateway or the event bus. Each tenant's containers, volumes and port block are separate from every other tenant's.

This is what makes running several unrelated things on one laptop workable: two tenants can both have a service called `api` on a project called `main`, and nothing collides.

## Lifecycle

```bash
blissful-infra service up orders
blissful-infra service logs orders
blissful-infra service down orders

blissful-infra project down      # stop Kafka, Postgres, gateway
blissful-infra tenant down       # stop CI and observability
```

Stopping and restarting costs nothing. Everything is containerised, so you can tear a project down mid-experiment and bring it back where it was.

## Trimming the stack

The full set is a lot to run if you only care about the app. Both `tenant create` and `project create` take flags to leave things out:

```bash
blissful-infra tenant create acme --no-jenkins --no-tempo --no-loki
blissful-infra project create shop --no-kafka --no-redis
```

## Compose or Kubernetes?

Pick **compose** when you want to iterate on application code, you are working on the data layer or event flow, or you do not want to install Kubernetes tooling. It starts in seconds.

Pick **[kubernetes](/guides/golden-path)** when the thing you are actually exploring is deployment: GitOps, progressive delivery, canary analysis, rollback semantics.

The runtime is fixed at project creation and cannot be changed later. But a tenant can hold projects of both kinds, so you can run one of each side by side and compare.

## Where the files are

```
~/.blissful-infra/tenants/acme/
├── docker-compose.tenant.yaml
└── projects/shop/
    ├── docker-compose.project.yaml
    └── services/orders/
        ├── docker-compose.yaml
        └── src/
```

These are plain compose files. Read them, edit them, learn from them.

## See also

- [The tenant model](/guides/tenant-model)
- [The golden path](/guides/golden-path): the other runtime
- [`service`](/commands/service) · [`project`](/commands/project)
