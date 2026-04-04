---
title: Getting Started
description: Install blissful-infra and run a full-stack app locally with one command — Spring Boot, React, Kafka, Postgres, Prometheus, Grafana, Jenkins CI/CD, and an AI agent, all wired together.
---

blissful-infra is a CLI that gives you a production-grade sandbox on your laptop. In under two minutes you have a running full-stack app — backend, frontend, database, message bus, tracing, metrics, CI/CD, and a web dashboard — wired together and managed as a unit. Experiment freely. Tear it down. Start fresh. It's all local, isolated, and completely under your control.

## Prerequisites

- **Node.js 18+** — the CLI is a Node.js package
- **Docker Desktop** — all services run in Docker containers; Desktop must be running before you use any `blissful-infra` commands
- **4 GB free RAM** recommended (the full stack with monitoring uses ~2–3 GB)

You do not need a cloud account, Kubernetes, or any other tooling pre-installed.

## Install

```bash
npm install -g @blissful-infra/cli
```

Verify the installation:

```bash
blissful-infra --version
```

## Quick start

```bash
blissful-infra start my-app
```

This single command:

1. Checks Docker is running and pre-flight checks ports
2. Ensures the shared Jenkins CI server is up (starts it if not)
3. Scaffolds a `my-app/` directory with backend, frontend, and config files
4. Generates a `docker-compose.yaml` wiring all services together
5. Runs `docker compose up --build` and streams the build output
6. Registers the project with Jenkins
7. Opens the frontend (`http://localhost:3000`) and dashboard (`http://localhost:3002`) in your browser

Images are pulled on first run and cached — subsequent starts are significantly faster.

## What gets created

```
my-app/
├── backend/              # Spring Boot (Kotlin) — REST API + Kafka producer/consumer
│   ├── src/              # Application source code
│   ├── build.gradle.kts  # Gradle build file
│   ├── Dockerfile        # Multi-stage build with OpenTelemetry agent
│   └── Jenkinsfile       # CI/CD pipeline definition
├── frontend/             # React + Vite + TypeScript + TailwindCSS
│   ├── src/              # React application source
│   ├── package.json
│   └── Dockerfile        # nginx-based production image
├── loki/                 # Loki + Promtail log aggregation config
├── prometheus/           # Prometheus scrape configuration
├── grafana/              # Pre-provisioned dashboards and datasources
├── nginx.conf            # Reverse proxy: routes /api/ and /ws/ to backend
├── docker-compose.yaml   # All services wired together
└── blissful-infra.yaml   # Project config (backend, frontend, database options)
```

## Choosing a stack at creation time

The defaults are Spring Boot backend + React+Vite frontend + Postgres database. Override any of them:

```bash
# FastAPI backend + Postgres
blissful-infra start my-app --backend fastapi --database postgres

# Spring Boot + Postgres AND Redis (cache layer)
blissful-infra start my-app --database postgres-redis

# No database (API-only or external DB)
blissful-infra start my-app --database none

# With AI/ML data pipeline
blissful-infra start my-app --plugins ai-pipeline

# Skip Prometheus + Grafana (lighter stack)
blissful-infra start my-app --no-monitoring
```

### Available backends

| Flag value    | Stack                                       |
|---------------|---------------------------------------------|
| `spring-boot` | Kotlin + Spring Boot 3 + Kafka + WebSockets |
| `fastapi`     | Python + FastAPI + Kafka + WebSockets       |
| `express`     | Node.js + Express + TypeScript + Kafka      |
| `go-chi`      | Go + Chi + Kafka + WebSockets               |

### Available frontends

| Flag value   | Stack                                    |
|--------------|------------------------------------------|
| `react-vite` | React + Vite + TypeScript + TailwindCSS  |
| `nextjs`     | Next.js + TypeScript + TailwindCSS       |

### Database options

| Flag value       | What you get                                                          |
|------------------|-----------------------------------------------------------------------|
| `none`           | No database service                                                   |
| `postgres`       | Postgres 16 + Flyway migrations + JPA entities + repository layer     |
| `redis`          | Redis 7 + Spring Cache (`@Cacheable` / `@CacheEvict`)                 |
| `postgres-redis` | Both — Postgres for persistence, Redis as a read-through cache layer  |

## Managing your project

Once your project is running, the key commands are:

```bash
# View logs for all services
blissful-infra logs

# Stop all containers
blissful-infra down

# Start a stopped project
blissful-infra up

# Development mode — hot reload with file watching
blissful-infra dev

# Open the dashboard
blissful-infra dashboard
```

`down` and `up` are cheap — the stack is fully containerized, so stopping and restarting costs nothing. You can tear down a project mid-experiment and bring it back exactly where it was.

## Reproducing environments

Every project has a `blissful-infra.yaml` that captures the full configuration. To reproduce the exact same sandbox on another machine:

```bash
git clone git@github.com:your-org/my-app.git
cd my-app && blissful-infra up
```

This reads `blissful-infra.yaml`, regenerates `docker-compose.yaml`, and starts the stack — byte-for-byte identical to what was originally created. Share it with a teammate and they get the same environment, no setup guide required.

## Next steps

- [Commands: start](/commands/start) — all flags and options for `blissful-infra start`
- [Commands: deploy](/commands/deploy) — ship your local app to Cloudflare, Vercel, or AWS
- [Commands: dev](/commands/dev) — hot reload and template development mode
- [Commands: dashboard](/commands/dashboard) — the local monitoring dashboard
- [Templates overview](/templates/overview) — what lives inside each template
