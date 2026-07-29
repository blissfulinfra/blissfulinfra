---
title: blissful-infra tenant
description: Manage tenants. the top level of the hierarchy. A tenant owns the dashboard, Jenkins, the observability stack and optionally a Kubernetes cluster.
---

A **tenant** is the top level of the hierarchy. It maps to an organization and owns the shared platform services: Jenkins, Prometheus, Grafana, Tempo, Loki and optionally a local Kubernetes cluster.

```bash
blissful-infra tenant create acme
blissful-infra tenant up
```

## Subcommands

| Command | What it does |
|---|---|
| `tenant create <name>` | Create a new tenant |
| `tenant list` | List all tenants |
| `tenant status [name]` | Show tenant detail: projects, services, ports |
| `tenant up [name]` | Start the tenant's infrastructure |
| `tenant down [name]` | Stop the tenant's infrastructure |
| `tenant remove [name]` | Remove a tenant and **all** its projects and services |

Where `[name]` is optional, the tenant resolves from your [`use`](/commands/use) context.

## tenant create

```bash
blissful-infra tenant create <name>
```

The name must be lowercase alphanumeric with hyphens.

| Flag | What it does |
|---|---|
| `-y`, `--skip-prompts` | Skip prompts, use defaults |
| `--no-jenkins` | Do not run Jenkins |
| `--no-prometheus` | Do not run Prometheus |
| `--no-grafana` | Do not run Grafana |
| `--no-tempo` | Do not run Tempo |
| `--no-loki` | Do not run Loki |

A slimmer tenant for when you only care about the app:

```bash
blissful-infra tenant create acme --no-jenkins --no-tempo --no-loki
```

## tenant up / down

```bash
blissful-infra tenant up acme
blissful-infra tenant down acme
```

Starts or stops the tenant's own compose stack (`docker-compose.tenant.yaml`): Jenkins and observability. This does **not** start the projects inside it; use [`project up`](/commands/project) for those.

## tenant remove

```bash
blissful-infra tenant remove acme
```

Destructive. Stops the tenant's containers and deletes its directory under `~/.blissful-infra/tenants/`, including every project and service inside it.

## Ports

Each tenant gets a deterministic port block derived from its index, so tenants never collide. The first tenant lands on:

| Service | Port |
|---|---|
| Grafana | 3000 |
| Loki | 3100 |
| Tempo | 3200 |
| Gitea *(kubernetes runtime)* | 3300 |
| Kubernetes API *(kubernetes runtime)* | 6550 |
| Jenkins | 8081 |
| ArgoCD *(kubernetes runtime)* | 8440 |
| Prometheus | 9090 |

The second tenant gets 3001, 3101, 3201 and so on. `blissful-infra tenant status` prints the real allocation.

The dashboard is not in this table because it is host-level, not per-tenant. One dashboard on `localhost:3002` manages every tenant.

## See also

- [`project`](/commands/project): the next level down
- [`cluster`](/commands/cluster): give a tenant a Kubernetes cluster
- [`use`](/commands/use): set a default tenant
