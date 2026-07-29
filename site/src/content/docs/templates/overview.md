---
title: Templates Overview
description: How blissful-infra templates work, what they generate and how to extend them.
---

Templates are the source blueprints that `blissful-infra service add` copies and customises. Each is a complete starting point for one technology stack.

## Template locations

Templates live in `packages/cli/templates/` in the blissful-infra repository:

```
packages/cli/templates/
├── spring-boot/          # Kotlin + Spring Boot backend
├── react-vite/           # React + Vite frontend
├── lambda-python/        # Python serverless function (not wired up, see below)
├── gitops/               # Rollout, Services, ConfigMap, ArgoCD Application
├── cluster/              # Terraform workspace for the kind cluster
└── jenkins/              # Jenkins server configuration
```

Observability configuration (Prometheus, Grafana, Loki, Tempo) is **not** templated. It is generated inline when a tenant's compose file is written, so it always matches the tenant's actual port block.

## Variable substitution

Template files use `{{VAR_NAME}}` placeholders, replaced at scaffold time. This drives package names, image tags, container names, database schema names, Kafka consumer group IDs and more.

### Conditional blocks

Templates support conditional blocks:

```
{{#IF_POSTGRES}}
spring.datasource.url=jdbc:postgresql://postgres:5432/{{PROJECT_NAME}}
{{/IF_POSTGRES}}

{{#IF_KUBERNETES}}
# Included only when the parent project uses --runtime kubernetes
{{/IF_KUBERNETES}}
```

The `IF_KUBERNETES` guard is how one template serves both runtimes: a service scaffolded into a kubernetes-runtime project gets different wiring from the same source files.

Binary files (images, compiled assets, JARs) are copied without substitution.

## Available templates

### Backend

| Template | Language | Framework | Features |
|---|---|---|---|
| `spring-boot` | Kotlin | Spring Boot 3 | Kafka producer/consumer, WebSockets, JPA, Flyway, Actuator, OpenTelemetry |
| `hono` | TypeScript | Hono | Runs in a container locally and promotes to Cloudflare Workers unchanged. See [`deploy --target cloudflare`](/commands/deploy#promoting-to-cloudflare) |
| `lambda-python` | Python | AWS Lambda | Scaffolds, but the runtime wiring is [not ported to the tenant model yet](/templates/lambda-python) |

Other stacks (FastAPI, Express, Go) are deliberately out of scope until there is a real working template behind them rather than a placeholder. See [Philosophy](/philosophy).

### Frontend

| Template | Language | Framework | Features |
|---|---|---|---|
| `react-vite` | TypeScript | React + Vite | TailwindCSS, WebSocket client, chat UI, hot reload |

### Workers

Workers (`--type worker --runtime python|node|go`) currently scaffold a minimal placeholder rather than a full template.

### Infrastructure

Not selectable, used automatically by the commands that need them:

| Template | Used by |
|---|---|
| `gitops/service/` | [`deploy`](/commands/deploy): Rollout, canary/stable Services, ConfigMap, ArgoCD Application |
| `cluster/` | [`cluster up`](/commands/cluster): the Terraform workspace |
| `jenkins/` | The tenant's Jenkins container |

## The default example app

Backend templates generate a working chat application to demonstrate the stack:

1. Sent from the frontend to the backend over WebSocket
2. Published to a Kafka topic
3. Consumed by a Kafka listener
4. Broadcast back to all connected clients
5. Persisted to the service's own Postgres schema

So you can watch Kafka message flow and distributed traces in Grafana before writing any code.

## A note on plugins

Earlier versions had per-service plugins (`ai-pipeline`, `agent-service`, `keycloak`, `localstack`) enabled with a `--plugins` flag. **These were removed in 2.0** along with the client model, and their templates are gone from disk. The `--plugins` flag no longer exists.

The `gatling` load-testing template is the only one still present, and it is not currently wired into `service add`.

## Extending templates

For project-specific changes, edit the generated files in your service directory under `~/.blissful-infra/tenants/<tenant>/projects/<project>/services/<service>/`. They are real files you own, and blissful-infra does not regenerate or overwrite them after scaffolding.

To change the templates themselves, work in `packages/cli/templates/` in a checkout of the repository.

## See also

- [Spring Boot template](/templates/spring-boot)
- [React + Vite template](/templates/react-vite)
- [`service`](/commands/service): how templates get used
