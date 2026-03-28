---
title: "Stop Paying for Cloud Dev Environments: Run Your Entire Stack Locally"
description: How to run Kafka, Postgres, Prometheus, Grafana, Jenkins CI/CD, and distributed tracing on your laptop — for free — with one command.
---

Cloud development environments have become the default for teams building modern applications. Gitpod, GitHub Codespaces, and cloud-hosted staging environments make it easy to get started — but they come with a cost that compounds quickly: per-hour billing, slow feedback loops because your code has to travel to a data center and back, and a shared environment that breaks when a teammate pushes something bad.

There's a better way. Everything your production stack needs can run on your laptop, and the feedback loop goes from minutes to seconds.

## What "the full stack" actually means

A modern production application isn't just a backend and a database. By the time you're running in production, you typically have:

- **A backend API** — Spring Boot, FastAPI, Express, or Go
- **A frontend** — React, Next.js, or similar
- **A database** — Postgres for persistence, Redis for caching
- **A message bus** — Kafka for event-driven communication between services
- **Observability** — Prometheus for metrics, Grafana for dashboards, Jaeger for distributed tracing, Loki for log aggregation
- **CI/CD** — Jenkins (or similar) for automated build, test, and deploy pipelines
- **A reverse proxy** — nginx to route traffic

Setting all of this up by hand takes days. Keeping it in sync across a team takes ongoing effort. And running it in the cloud costs money before you've written a single line of business logic.

## The one-command alternative

```bash
npm install -g @blissful-infra/cli
blissful-infra start my-app
```

That's it. In under 90 seconds you have all of the above running locally, wired together, and accessible in your browser. No cloud account. No YAML to write. No DevOps knowledge required.

Here's what gets created:

| Service | URL | What it does |
|---|---|---|
| Frontend | `http://localhost:3000` | React + Vite app |
| Backend API | `http://localhost:8080` | Spring Boot REST + WebSocket |
| Dashboard | `http://localhost:3002` | blissful-infra management UI |
| Grafana | `http://localhost:3001` | Pre-built metrics dashboards |
| Prometheus | `http://localhost:9090` | Scrapes `/actuator/prometheus` |
| Jaeger | `http://localhost:16686` | Distributed trace viewer |
| Jenkins | `http://localhost:8081` | CI/CD pipeline |
| Kafka | `localhost:9092` | Event streaming |
| Postgres | `localhost:5432` | Primary database |
| Loki | `localhost:3100` | Log aggregation |

Every service is pre-configured to talk to the others. Prometheus already knows where to scrape metrics. Grafana already has dashboards provisioned. Jaeger already receives traces from the backend. You don't connect any of it — it's connected.

## Why local beats cloud for development

### Feedback loops

The single most important metric for developer productivity is how quickly you can go from "I changed code" to "I can see the result." In a cloud dev environment, that round trip involves your code leaving your machine, hitting a build server, deploying to a remote container, and the result coming back. Even with fast CI/CD that's 2–5 minutes.

Locally, with hot reload:

```bash
blissful-infra dev
# Watching for changes...
# Change detected in backend/src/main/kotlin/GreetingController.kt
# Restarting backend... done in 4s
```

4 seconds vs 4 minutes. Across a full workday that's the difference between making 100 attempts at getting something right and making 10.

### You can break things freely

In a shared staging environment, breaking something affects everyone. You think twice before running a destructive migration or intentionally crashing a service to test your error handling.

Locally, there are no stakes. Want to test what happens when Kafka goes down?

```bash
docker compose stop kafka
# Your app throws consumer errors — you see exactly how it behaves
docker compose start kafka
# Back to normal
```

Want to test a rollback? Blow up a database migration? Run chaos experiments? All of it is free and reversible in under 30 seconds.

### It runs offline

A cloud dev environment requires internet. A plane, a coffee shop with bad WiFi, or a corporate network with heavy filtering can kill your productivity instantly.

The blissful-infra stack runs entirely on Docker Desktop. No internet required after the initial image pull.

## The observability stack, explained

One of the hardest things to replicate locally is a proper observability setup. Here's what you get out of the box and how it's wired:

### Prometheus + Grafana

The Spring Boot backend exposes metrics at `/actuator/prometheus`. Prometheus is pre-configured to scrape that endpoint every 15 seconds. Grafana has datasources and dashboards provisioned on startup — you open `localhost:3001` and JVM heap, HTTP request rate, and error rate are already graphed.

```yaml
# prometheus/prometheus.yml (pre-generated)
scrape_configs:
  - job_name: 'backend'
    static_configs:
      - targets: ['backend:8080']
    metrics_path: '/actuator/prometheus'
```

### Distributed tracing with Jaeger

The backend Dockerfile includes the OpenTelemetry Java agent. Every HTTP request and Kafka message automatically generates a trace span. Open Jaeger at `localhost:16686`, pick the `backend` service, and you can see exactly how long each database query and downstream call took.

No instrumentation code to write. The agent handles it.

### Log aggregation with Loki

Promtail collects stdout from every Docker container and ships it to Loki. From the blissful-infra dashboard at `localhost:3002` you can tail logs across all services in one view — no `docker compose logs -f` juggling.

## CI/CD that actually runs

Jenkins is pre-configured with a pipeline that mirrors what you'd run in production:

1. **Build** — Gradle compile + lint (parallel)
2. **Test** — Unit tests + integration tests (parallel, with TestContainers)
3. **Containerize** — Docker BuildKit with layer caching
4. **Security scan** — Trivy for CRITICAL vulnerabilities
5. **Push** — to the local Docker registry at `localhost:5050`
6. **Deploy** — restarts your local containers with the new image

The Jenkinsfile is generated in your project directory. Push a change to your local Git and Jenkins picks it up automatically.

## Choosing your stack

The default is Spring Boot + React + Postgres, but you can mix and match:

```bash
# FastAPI backend
blissful-infra start my-app --backend fastapi

# With both Postgres and Redis
blissful-infra start my-app --database postgres-redis

# No database (API-only)
blissful-infra start my-app --database none

# Skip monitoring (lighter stack for older machines)
blissful-infra start my-app --no-monitoring
```

Available backends: Spring Boot (Kotlin), FastAPI (Python), Express (Node.js), Go Chi.

## The AI agent

The dashboard at `localhost:3002` includes an AI chat interface that's connected to your running stack. Ask it questions against live data:

- "Why is the error rate spiking?"
- "Show me the slowest database queries in the last hour"
- "What changed in the last deployment?"

The agent reads your logs, metrics, and traces in real time. It's not answering from documentation — it's looking at your actual running system.

## From local to live

When you're ready to share your project beyond your laptop:

```bash
blissful-infra deploy
# → Live at https://my-app.blissful-infra.com
```

The same stack you built locally deploys to Cloudflare's edge infrastructure. Your local Postgres maps to Cloudflare D1, Redis to KV, Kafka to Queues. No config changes. The `blissful-infra.yaml` that defined your local environment defines your production one.

[Get started →](/getting-started) or [view pricing →](/pricing) if you're ready to deploy.

## Prerequisites

- **Node.js 18+**
- **Docker Desktop** — the only real requirement; must be running before you use any `blissful-infra` commands
- **4GB free RAM** — the full stack with monitoring uses 2–3GB

That's the entire list. No Kubernetes. No cloud account. No prior DevOps experience.

```bash
npm install -g @blissful-infra/cli
blissful-infra start my-app
```
