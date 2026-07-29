---
title: blissful-infra project
description: Manage projects — a domain inside a tenant. A project owns Kafka, Postgres, the API gateway and an isolated Docker network, and picks a compose or kubernetes runtime.
---

A **project** is a domain inside a tenant. It owns the data infrastructure its services share: a Kafka event bus, Postgres, an API gateway, and an isolated Docker network.

```bash
blissful-infra project create shop
```

## Subcommands

| Command | What it does |
|---|---|
| `project create [tenant] <name>` | Create a project inside a tenant |
| `project list [tenant]` | List projects in a tenant |
| `project status [tenant] [name]` | Show project detail — services, ports |
| `project up [tenant] [name]` | Start the project's infrastructure |
| `project down [tenant] [name]` | Stop the project's infrastructure |
| `project remove [tenant] [name]` | Remove a project and all its services |

The tenant argument is optional everywhere — it resolves from your [`use`](/commands/use) context when omitted. So both of these work:

```bash
blissful-infra project create shop           # tenant from context
blissful-infra project create acme shop      # tenant explicit
```

## project create

| Flag | What it does |
|---|---|
| `--runtime <runtime>` | `compose` (default) or `kubernetes` |
| `-y`, `--skip-prompts` | Skip prompts, use defaults |
| `--no-kafka` | Do not run Kafka |
| `--no-postgres` | Do not run Postgres |
| `--no-redis` | Do not run Redis |
| `--no-gateway` | Do not run the API gateway |

## Choosing a runtime

This is the most consequential flag on the command, and it cannot be changed later without recreating the project.

```bash
blissful-infra project create shop                        # compose (default)
blissful-infra project create shop --runtime kubernetes   # kind + ArgoCD + Argo Rollouts
```

**`compose`** runs each service as a container on the project's Docker network. Backends get a Postgres schema, Kafka bootstrap servers, Prometheus scrape labels and Loki log shipping. Nothing to install beyond Docker.

**`kubernetes`** makes the project a namespace on the tenant's kind cluster. Services become Argo Rollouts that ArgoCD syncs from the tenant's Gitea repo, and [`deploy`](/commands/deploy) drives a canary rollout. Requires [`cluster up`](/commands/cluster) on the tenant first.

Two current limits on the kubernetes runtime, both by design of the first slice: services scaffold without a database binding (there is no in-cluster Postgres yet), and canary analysis is pause-based rather than metric-driven (no in-cluster Prometheus yet).

## Ports

Each project gets a deterministic block derived from its tenant and project index. The first project of the first tenant lands on:

| Service | Port |
|---|---|
| Postgres | 5432 |
| Redis | 6379 |
| API gateway | 8080 |
| Kafka | 9092 |

Plus exporter sidecars on 9121 (Redis), 9187 (Postgres) and 9308 (Kafka). The next project gets 5433, 6380, 8081 and so on. A tenant can hold up to 10 projects, and a project up to 20 services.

## See also

- [`tenant`](/commands/tenant) — the level above
- [`service`](/commands/service) — the level below
- [`cluster`](/commands/cluster) — required before `--runtime kubernetes`
