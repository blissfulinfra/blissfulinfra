---
title: Getting Started
description: Install blissful-infra and bring up a tenant, project and service on your laptop. Spring Boot, React, Kafka, Postgres, Prometheus, Grafana, Jenkins and a web dashboard, wired together by one command.
---

blissful-infra gives you a production-grade sandbox on your laptop: backend, frontend, database, message bus, tracing, metrics, CI/CD and a web dashboard, wired together and managed as a unit. Experiment freely. Tear it down. Start fresh. It is all local and completely under your control.

## Prerequisites

- **Node.js 20 or newer**: the CLI is a Node.js package (`engines: >=20.0.0`)
- **Docker Desktop**, running: every service is a container
- **4 GB free RAM** recommended; the full stack with monitoring uses ~2-3 GB

That is everything you need for the default compose runtime. The [Kubernetes runtime](#going-further-the-kubernetes-runtime) needs three more tools, covered below.

## Install

```bash
npm install -g @blissful-infra/cli
blissful-infra --version
```

## Quick start

The fastest path is the guided wizard:

```bash
blissful-infra init
```

It walks you through creating a tenant, a project and your first service, then brings the whole thing up. To skip the questions entirely:

```bash
blissful-infra init -y
```

That creates tenant `dev`, project `main` and a `spring-boot` backend service called `api`, and starts everything. Add `--no-start` if you only want the scaffolding.

## The model

blissful-infra organises everything into three levels. It is worth understanding before you go further, because every command takes coordinates in this hierarchy.

| Level | Maps to | Owns |
|---|---|---|
| **Tenant** | Organization | Dashboard, Jenkins, observability stack (Prometheus, Grafana, Tempo, Loki), optionally a Kubernetes cluster |
| **Project** | Domain | Kafka event bus, Postgres, API gateway, isolated Docker network and a runtime |
| **Service** | Bounded context | One process, with its own database schema |

[The full model](/guides/tenant-model)

## Doing it by hand

If you would rather see each step, `init` is just these commands in sequence:

```bash
# 1. A tenant owns CI and observability
blissful-infra tenant create acme
blissful-infra tenant up

# 2. A project owns Kafka, Postgres and the gateway
blissful-infra project create shop

# 3. Services are processes inside the project
blissful-infra service add orders --type backend
blissful-infra service add web --type frontend
```

### Setting your context

Rather than passing `--tenant acme --project shop` to every command, set a context once:

```bash
blissful-infra use acme/shop
blissful-infra use              # show current context
blissful-infra use --clear      # clear it
```

Every subsequent command resolves the tenant and project from that context.

## Choosing a stack

Defaults are a Spring Boot backend and a React + Vite frontend, with a Postgres schema allocated per backend service. Override at `service add` time:

```bash
# Explicit template
blissful-infra service add orders --type backend --template spring-boot
blissful-infra service add web --type frontend --template react-vite

# A worker process instead
blissful-infra service add mailer --type worker --runtime python

# Skip the auto-allocated Postgres schema
blissful-infra service add orders --type backend --no-database
```

### Service types

| `--type` | What you get |
|---|---|
| `backend` | A service with an HTTP port, metrics port and its own Postgres schema |
| `frontend` | A service with an HTTP port, no database |
| `worker` | A headless process; pick a language with `--runtime python\|node\|go` |

### Templates

| Template | `--type` | Stack |
|---|---|---|
| `spring-boot` | `backend` | Kotlin + Spring Boot 3 + Kafka + Actuator + OpenTelemetry |
| `react-vite` | `frontend` | React + Vite + TypeScript + TailwindCSS |
| `lambda-python` | `backend` | Python serverless handler *(template on disk; the tenant-model port is still open)* |

### Turning infrastructure off

Both `tenant create` and `project create` accept flags to slim the stack down:

```bash
blissful-infra tenant create acme --no-jenkins --no-tempo
blissful-infra project create shop --no-kafka --no-redis
```

## Managing what you built

```bash
blissful-infra status                 # tenants, projects, services with health
blissful-infra service up orders      # start one service
blissful-infra service logs orders    # tail its logs
blissful-infra service down orders    # stop it
blissful-infra project down           # stop the project's infrastructure
blissful-infra tenant down            # stop the tenant's CI and observability
```

Stopping and restarting is cheap. The stack is fully containerised, so you can tear a project down mid-experiment and bring it back where it was.

## The dashboard

```bash
blissful-infra dashboard up
```

One dashboard at `http://localhost:3002` manages every tenant: live service health, Loki-backed logs, Prometheus metrics, deployment history, a system topology graph and an AI chat tab. [More on the dashboard](/commands/dashboard)

## Where things live

Config and data live under `~/.blissful-infra/`, not in your working directory:

```
~/.blissful-infra/
├── registry.json              # port allocations
├── context.json               # current tenant/project (set by `use`)
└── tenants/
    └── acme/
        ├── docker-compose.tenant.yaml    # Jenkins + observability
        ├── cluster/                      # Terraform workspace (kubernetes runtime)
        ├── gitops/                       # gitops repo checkout (kubernetes runtime)
        └── projects/
            └── shop/
                ├── docker-compose.project.yaml   # Kafka, Postgres, gateway
                └── services/
                    └── orders/           # your service source + its compose file
```

Ports are derived from the tenant and project index, so a second tenant lands one port up from the first and can never collide. `blissful-infra status` shows what each tenant actually got.

## Going further: the Kubernetes runtime

A project can run on a real local Kubernetes cluster instead of plain compose, with ArgoCD syncing your services from a git repo and Argo Rollouts running canary deploys.

```bash
brew install kind kubectl hashicorp/tap/terraform argoproj/tap/kubectl-argo-rollouts
```

Then:

```bash
blissful-infra cluster up                              # ~3-5 min first run
blissful-infra project create shop --runtime kubernetes
blissful-infra service add orders --type backend
blissful-infra deploy orders
```

[Walk the golden path](/guides/golden-path)

## Next steps

- [The tenant model](/guides/tenant-model): how tenants, projects and services fit together
- [The golden path](/guides/golden-path): Kubernetes, ArgoCD and canary deploys end to end
- [Commands: init](/commands/init): every flag on the wizard
- [Commands: service](/commands/service): adding and running services
- [Commands: dashboard](/commands/dashboard): the local control plane
- [Templates overview](/templates/overview): what lives inside each template
