---
title: The tenant model
description: How tenants, projects and services fit together, why the hierarchy has three levels and how deterministic port allocation makes collisions impossible.
---

Everything in blissful-infra hangs off a three-level hierarchy. It mirrors how cloud providers structure accounts and how Domain-Driven Design structures domains.

| Level | Maps to | DDD concept | Owns |
|---|---|---|---|
| **Tenant** | Organization | - | Jenkins, Prometheus, Grafana, Tempo, Loki, optionally a Kubernetes cluster |
| **Project** | Domain | Domain / subdomain | Kafka event bus, Postgres, API gateway, isolated Docker network |
| **Service** | Bounded context | Bounded context | One process, one database schema |

## Why three levels

The obvious design is two: an environment, and the services in it. That is what blissful-infra used to be, and it broke down in two ways.

**Vocabulary drift.** A "service" was a bundle: backend plus frontend plus plugins, all in one compose project. So the API called them projects, the dashboard called them services and the docs alternated. Nobody could say what the unit was.

**No structural place for a domain.** With two levels there is nowhere to express "this Kafka topic belongs to the checkout domain". No per-service database isolation by default. No project-scoped network. The framework offered nothing better than a distributed monolith, so that is what people built.

Three levels fixes both. The project is where a domain lives: it owns the event bus and the database, and it draws a network boundary. The service is genuinely atomic: one process, one bounded context.

## What each level owns

### Tenant

A tenant is an organization boundary. It owns the things you want one of per organization, not one per app:

- **Jenkins**, for CI across all its projects
- **Observability**: Prometheus, Grafana, Tempo, Loki
- Optionally a **Kubernetes cluster** (see [the golden path](/guides/golden-path))

Tenants are fully isolated from each other. Separate containers, separate volumes, separate port blocks.

```bash
blissful-infra tenant create acme
blissful-infra tenant up
```

The dashboard is the one thing that is *not* per-tenant. A single dashboard on `localhost:3002` manages every tenant, with a switcher in the header.

### Project

A project is a domain inside a tenant. It owns the data infrastructure its services share:

- **Kafka**, the domain's event bus
- **Postgres**, one instance holding a schema per service
- **API gateway**
- An **isolated Docker network**

```bash
blissful-infra project create shop
```

A project also picks a **runtime**, either `compose` or `kubernetes`, which decides how its services actually run. This cannot be changed later without recreating the project.

### Service

A service is one process. One container family, one bounded context, one database schema.

```bash
blissful-infra service add orders --type backend
```

Types are `backend` (HTTP port, metrics port, DB schema), `frontend` (HTTP port, no DB) and `worker` (headless, DB schema).

## DDD by construction

The hierarchy is not just organizational. Two things are enforced structurally rather than by convention:

**Every backend gets its own Postgres schema.** Not a shared one with a naming convention people are supposed to follow, but an actual separate schema. A service reaching into another service's tables has to work at it, and you will notice when it does.

**Every project gets its own Docker network.** Services in different projects cannot reach each other directly. They have to go through the gateway or the event bus, which is exactly the constraint that keeps a domain boundary real.

This is the point of the model. Most tooling lets you draw architecture diagrams with boundaries on them and then build something that ignores them entirely. Here the boundary is the default, and crossing it takes deliberate effort.

## Context

Typing `--tenant acme --project shop` on every command gets old fast. Set it once:

```bash
blissful-infra use acme/shop
blissful-infra deploy orders      # resolves acme/shop automatically
```

Resolution order is: explicit flag, then stored context, then for some commands a registry scan (if exactly one project has a service by that name, it wins). An explicit flag always beats the context, so you can reach into another tenant for one command without disturbing where you are.

## Ports

Ports are **derived**, not assigned. Each level gets a block computed from its index, so the allocation is deterministic and collisions are impossible by construction rather than by luck.

The first tenant lands on:

| Service | Port |
|---|---|
| Grafana | 3000 |
| Loki | 3100 |
| Tempo | 3200 |
| Gitea *(kubernetes)* | 3300 |
| Kubernetes API *(kubernetes)* | 6550 |
| Jenkins | 8081 |
| ArgoCD *(kubernetes)* | 8440 |
| Prometheus | 9090 |

The second tenant gets 3001, 3101, 3201 and so on. Project-level services work the same way, offset by both tenant and project index:

| Service | First project |
|---|---|
| Postgres | 5432 |
| Redis | 6379 |
| API gateway | 8080 |
| Kafka | 9092 |

Services themselves come from a high range that cannot collide with infrastructure: HTTP from 30000, metrics from 34000.

A tenant holds up to 10 projects, and a project up to 20 services. Run `blissful-infra status` to see what anything actually got.

## Where it lives on disk

```
~/.blissful-infra/
├── registry.json                  # port allocations
├── context.json                   # what `use` set
└── tenants/
    └── acme/
        ├── docker-compose.tenant.yaml     # Jenkins + observability
        ├── cluster/                       # Terraform workspace (kubernetes runtime)
        ├── gitops/                        # gitops repo checkout (kubernetes runtime)
        └── projects/
            └── shop/
                ├── docker-compose.project.yaml    # Kafka, Postgres, gateway
                └── services/
                    └── orders/
                        ├── docker-compose.yaml    # joins the project network
                        └── src/                   # your code
```

Note that your source lives under `~/.blissful-infra/`, not in the directory you ran the command from.

## Next

- [The compose runtime](/guides/compose-runtime): the default
- [The golden path](/guides/golden-path): Kubernetes, ArgoCD and canary deploys
