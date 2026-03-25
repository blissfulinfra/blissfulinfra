---
title: Templates Overview
description: How blissful-infra templates work, what they generate, and how to extend them.
---

Templates are the source code blueprints that `blissful-infra start` copies and customises to create your project. Each template is a complete, production-ready starting point for a specific technology stack.

## Template locations

Templates live in `packages/cli/templates/` in the blissful-infra repository:

```
packages/cli/templates/
├── spring-boot/          # Kotlin + Spring Boot backend
├── react-vite/           # React + Vite frontend
├── fastapi/              # Python + FastAPI backend
├── express/              # Node.js + Express backend
├── go-chi/               # Go + Chi backend
├── nextjs/               # Next.js frontend
├── loki/                 # Log aggregation config
├── prometheus/           # Metrics scrape config
├── grafana/              # Pre-provisioned dashboards
├── jenkins/              # Jenkins server configuration
└── plugins/
    └── ai-pipeline/      # AI/ML data platform plugin
```

## Variable substitution

Template files use `{{PROJECT_NAME}}` as a placeholder. When you run `blissful-infra start my-app`, every occurrence of `{{PROJECT_NAME}}` in every file is replaced with `my-app`. This affects:

- Spring Boot application properties (`spring.application.name`)
- Gradle project name and Docker image tags
- Docker Compose container names and volume names
- Database name and credentials
- Kafka consumer group IDs
- Nginx configuration

### Conditional blocks

Templates also support conditional blocks based on the `--database` flag:

```
{{#IF_POSTGRES}}
// This code is included when database is 'postgres' or 'postgres-redis'
spring.datasource.url=jdbc:postgresql://postgres:5432/{{PROJECT_NAME}}
{{/IF_POSTGRES}}

{{#IF_REDIS}}
// Included when database is 'redis' or 'postgres-redis'
spring.data.redis.url=${REDIS_URL:redis://localhost:6379}
{{/IF_REDIS}}
```

Binary files (images, compiled assets, JARs) are copied as-is without substitution.

## Available templates

### Backend templates

| Template | Language | Framework | Features |
|----------|----------|-----------|---------|
| `spring-boot` | Kotlin | Spring Boot 3 | Kafka producer/consumer, WebSockets, JPA, Flyway, Actuator, OpenTelemetry |
| `fastapi` | Python | FastAPI | Kafka consumer, WebSockets, async handlers, Pydantic models |
| `express` | TypeScript | Express | Kafka producer/consumer, WebSockets, TypeScript strict mode |
| `go-chi` | Go | Chi | Kafka consumer, WebSockets, structured logging |

### Frontend templates

| Template | Language | Framework | Features |
|----------|----------|-----------|---------|
| `react-vite` | TypeScript | React + Vite | TailwindCSS, WebSocket client, chat UI, hot reload |
| `nextjs` | TypeScript | Next.js | App Router, TailwindCSS, WebSocket client |

### Infrastructure templates

These are always included and are not selectable:

| Template | Purpose |
|----------|---------|
| `loki` | Loki log aggregation config + Promtail Docker socket scraper |
| `prometheus` | Prometheus config scraping `backend:8080/actuator/prometheus` |
| `grafana` | Datasource provisioning + 3 pre-built dashboards |

## The default example app

All backend templates generate a working chat application to demonstrate the stack. When you first open your app, you can send messages through the React frontend and see them:

1. Sent from the frontend to the backend via WebSocket
2. Published to a Kafka topic by the backend
3. Consumed by a Kafka listener in the backend
4. Broadcast back to all connected WebSocket clients
5. Persisted to Postgres (with `postgres` or `postgres-redis`)
6. Served from the Redis cache on subsequent page loads (with `postgres-redis`)

This means you can observe Kafka message flow, cache hit/miss patterns in Grafana, and distributed traces in Jaeger — all from a working app — before writing any code.

## Extending templates

You can modify the template files directly if you are working on blissful-infra itself (see [blissful-infra dev --templates](/commands/dev)).

For project-specific customisation, edit the generated files in your project directory. They are real files you own — blissful-infra does not re-generate or overwrite them after `start`.

## Plugins

Plugins extend the generated project with additional services. Unlike templates, plugins are additive — they add new containers to `docker-compose.yaml` and new directories to your project.

| Plugin | What it adds |
|--------|-------------|
| `ai-pipeline` | FastAPI + scikit-learn classifier consuming Kafka events. Co-deploys ClickHouse (columnar store), MLflow (experiment tracking), and Mage (visual pipeline orchestrator). |
| `agent-service` | Claude-powered agent service with workspace access. Reads logs, runs tools, and responds to structured task requests via HTTP API. |
| `scraper` | Scrapy-based web scraper that publishes articles to a Kafka topic for downstream processing. |

Enable plugins at creation time:

```bash
blissful-infra start my-app --plugins ai-pipeline
blissful-infra start my-app --plugins ai-pipeline,agent-service
```
