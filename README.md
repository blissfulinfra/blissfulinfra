<div align="center">

# Blissful Infra

**Enterprise infrastructure on your laptop.**

One command creates and runs a full-stack app with CI/CD, observability, and an AI agent. No cloud required.

[![CI](https://github.com/cavanpage/blissful-infra/actions/workflows/ci.yml/badge.svg)](https://github.com/cavanpage/blissful-infra/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@blissful-infra/cli)](https://www.npmjs.com/package/@blissful-infra/cli)

---

[What is blissful-infra?](#what-is-blissful-infra) · [Choose your path](#choose-your-path) · [Quickstart](#quickstart) · [Basics](#basics) · [Next Steps](#next-steps)

---

</div>

## What is blissful-infra?

blissful-infra is a CLI that scaffolds and runs production-grade full-stack applications locally. Run one command and get a backend API, React frontend, Kafka message bus, Postgres database, Prometheus metrics, Grafana dashboards, Jenkins CI/CD pipeline, and an AI debugging agent. Everything is wired together and running in Docker.

```bash
blissful-infra start my-app
```

That's it. No YAML to hand-write. No services to manually connect. No cloud account required.

blissful-infra organizes your local stack into a single managed environment and exposes it through a dashboard UI. The same configuration and workflows work whether you're iterating on a feature locally or handing off to a CI pipeline.

**What makes it different from tools like Tilt or Garden:**

Those tools orchestrate services you already wrote. blissful-infra also *creates* them, scaffolding a production-ready project with observability, CI/CD, and AI tooling wired in from the start.

---

## Choose your path

blissful-infra serves three audiences, all working from the same toolchain.

| You are... | Path | Outcome |
|---|---|---|
| **Learning**: student, new grad, or anyone wanting enterprise-pattern fluency without an AWS bill | [Learn](https://blissful-infra.com/paths/learn) | A guided course that takes you from zero to a running Kubernetes service backed by Kafka, Postgres, and Keycloak. Understand each layer before reaching for a managed equivalent. |
| **Building**: engineer with an idea who wants a fast experimentation loop | [Build](https://blissful-infra.com/paths/build) | One command to a production-grade local stack. Skip the theory, prototype now, dig deeper later. |
| **Delivering**: small studio or indie team running multiple client projects | [Deliver](https://blissful-infra.com/paths/deliver) | Per-client isolated stacks with their own Kafka, Postgres, observability, and CI. One laptop, many clients, no SaaS sprawl. |

### A note on managed services

Most technologies blissful-infra runs locally have excellent managed equivalents: [Auth0](https://auth0.com/) over Keycloak, [RDS](https://aws.amazon.com/rds/) over Postgres, [Confluent Cloud](https://www.confluent.io/) over Kafka, [Datadog](https://www.datadoghq.com/) over the Prometheus/Grafana/Loki stack. Those services are great. They start faster, ship with built-in compliance, and remove most of the operational burden. When you're a small team shipping to production, reaching for one is often the right call.

blissful-infra exists for a different reason. A lot of enterprise development happens on top of managed services that already exist when you arrive. You write business logic against a Cognito instance someone else provisioned, push to an EKS cluster someone else maintains. That's productive, but it hides the layers, and starting from a blank slate becomes intimidating. blissful-infra puts every layer back in your hands so you can experiment, break things, and understand the tradeoffs at each level. When you do graduate to a managed service, you'll know what it's doing on your behalf, what you're paying for, and where the meaningful differences are.

---

## Use Cases

### Starting a new project from scratch

blissful-infra's primary use case. Pick a backend and frontend, optionally add a database or plugins, and have a running full-stack app with real infrastructure in under a minute.

```bash
blissful-infra start my-app --backend spring-boot --database postgres

# With the AI/ML data platform
blissful-infra start my-app --backend spring-boot --database postgres --plugins ai-pipeline
```

### Standardizing dev environments across a team

Every developer runs the same stack. `blissful-infra up` in a project directory reads the `blissful-infra.yaml` config and starts the exact same services, ports, and configuration. No "works on my machine" drift.

```bash
git clone git@github.com:your-org/my-app.git
cd my-app && blissful-infra up
```

### Learning enterprise infrastructure patterns

blissful-infra is designed to be a working reference for how production systems are built. Event-driven microservices, Kafka streams, Kubernetes manifests, GitOps with Argo CD, canary deployments, chaos testing, and observability with Prometheus and Grafana. Everything is generated as real, readable code in your project directory.

### Building AI/ML-powered services

The `ai-pipeline` plugin deploys a full ML data platform alongside your app. A Python FastAPI service classifies Kafka events with scikit-learn, with ClickHouse for prediction storage, MLflow for experiment tracking, and Mage for visual pipeline orchestration.

```bash
blissful-infra start my-app --plugins ai-pipeline
```

Your AI stack is now running:

| Service      | URL                        | Purpose                          |
|--------------|----------------------------|----------------------------------|
| AI Pipeline  | http://localhost:8090/docs | FastAPI + scikit-learn classifier |
| ClickHouse   | http://localhost:8123/play | Columnar store for predictions   |
| MLflow       | http://localhost:5001      | Experiment tracking & model registry |
| Mage         | http://localhost:6789      | Visual data pipeline orchestrator |

---

## Quickstart

**Prerequisites:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) running, Node.js 18+

```bash
# Install
npm install -g @blissful-infra/cli

# Create and run a fullstack app
blissful-infra start my-app

# Open the dashboard
blissful-infra dashboard
```

Your app is now running:

| Service    | URL                       |
|------------|---------------------------|
| Frontend   | http://localhost:3000     |
| Backend    | http://localhost:8080     |
| Grafana    | http://localhost:3001     |
| Prometheus | http://localhost:9090     |
| Dashboard  | http://localhost:3002     |
| Jenkins    | http://localhost:8081     |
| Registry   | localhost:5050            |

---

## Basics

### Projects

A blissful-infra project is a directory with a `blissful-infra.yaml` config file and a generated `docker-compose.yaml`. Every service (backend, frontend, Kafka, databases, monitoring) is defined in that compose file and managed together.

```
my-app/
├── backend/              # Spring Boot (Kotlin)
│   └── Jenkinsfile       # CI/CD pipeline definition
├── frontend/             # React + Vite
├── loki/                 # Log aggregation config
├── prometheus/           # Metrics scrape config (with monitoring)
├── grafana/              # Dashboards and datasources (with monitoring)
├── ai-pipeline/          # ML service (if --plugins ai-pipeline)
├── docker-compose.yaml   # Everything wired together
└── blissful-infra.yaml   # Project config
```

### Templates

blissful-infra ships with one full-stack template (Spring Boot + React + Vite) and one serverless template. Other stacks are deliberately out of scope until they're real. See [Project philosophy](#project-philosophy-real-services-not-vendor-emulation).

**Backend**

| Template        | Stack                                          |
|-----------------|------------------------------------------------|
| `spring-boot`   | Kotlin + Spring Boot + Kafka + WebSockets      |
| `lambda-python` | Python serverless function on LocalStack       |

**Frontend**

| Template      | Stack                                          |
|---------------|------------------------------------------------|
| `react-vite`  | React + Vite + TypeScript + TailwindCSS        |

```bash
blissful-infra start my-app --backend spring-boot --frontend react-vite
```

### Databases

| Option           | What you get                                                       |
|------------------|--------------------------------------------------------------------|
| `none`           | No database                                                        |
| `postgres`       | Postgres + Flyway migrations + JPA entities + repository layer     |
| `redis`          | Redis + Spring Cache (`@Cacheable` / `@CacheEvict`)                |
| `postgres-redis` | Both. Postgres for persistence, Redis as a read-through cache      |

```bash
# Postgres only
blissful-infra start my-app --database postgres

# Postgres + Redis (recommended for production-like setups)
blissful-infra start my-app --database postgres-redis
```

With `postgres-redis` the generated backend includes a `ProductService` with `@Cacheable` on reads and `@CacheEvict` on writes, so you can see cache hit/miss patterns in Grafana from day one.

### Monitoring

Every project includes Prometheus and Grafana by default. Prometheus scrapes your backend's `/actuator/prometheus` endpoint. Three dashboards are provisioned automatically: Service Overview, JVM Metrics, and Infrastructure.

To disable monitoring:

```bash
blissful-infra start my-app --no-monitoring
```

### The Dashboard

The dashboard is a local web UI for managing all your projects in one place.

```bash
blissful-infra dashboard
```

| Tab          | What it does                                              |
|--------------|-----------------------------------------------------------|
| Logs         | Real-time log streaming from all containers               |
| Metrics      | CPU, memory, HTTP latency, error rates                    |
| Agent        | Chat with the AI about errors and issues                  |
| Pipeline     | Jenkins pipeline stages, trigger builds                   |
| Environments | Deploy and rollback across environments                   |
| Settings     | Configure alert thresholds and log retention              |

### MCP Server

blissful-infra ships an [MCP](https://modelcontextprotocol.io) server so Claude can orchestrate your infrastructure directly. Create projects, read logs, check health, trigger builds, and deploy without leaving the chat.

**Requirements:** the dashboard must be running (`blissful-infra dashboard`) before you start the MCP server.

**Claude Desktop**: add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "blissful-infra": {
      "command": "npx",
      "args": ["-y", "blissful-infra", "mcp"],
      "env": {}
    }
  }
}
```

**Claude Code**: add to your project's `.mcp.json` or run:

```bash
blissful-infra mcp --api http://localhost:3002
```

Once connected, you can say things like:

> "Create a new project called fraud-detector with postgres-redis"
> "What's the health of all my running projects?"
> "Show me ERROR logs from the backend service in my-app"
> "Why is the backend in my-app restarting? Check the logs and diagnose."
> "Deploy my-app to staging"
> "Roll back my-app in production to the previous revision"

**Available MCP tools:**

| Tool | What it does |
|---|---|
| `list_projects` | List all projects and status |
| `get_project` | Status of a specific project |
| `create_project` | Scaffold a new project |
| `start_project` / `stop_project` | docker compose up/down |
| `delete_project` | Stop and remove a project |
| `get_health` | Service health for a project |
| `get_metrics` / `get_metrics_summary` | CPU, memory, latency, error rate |
| `get_logs` | Recent container logs |
| `search_logs` | Search logs by service, level, text |
| `query_agent` | Ask the AI to diagnose a problem |
| `get_pipeline` / `run_pipeline` | Jenkins CI status and trigger |
| `deploy` / `rollback` | Argo CD deployments |
| `list_environments` | Available deploy environments |

### Commands

**Core**

| Command              | Description                          |
|----------------------|--------------------------------------|
| `start <name>`       | Create and run a new project         |
| `create <name>`      | Create project without starting      |
| `example [name]`     | Scaffold a reference example project |
| `up [name]`          | Start an existing project            |
| `down [name]`        | Stop a project                       |
| `dev [name]`         | Development mode with hot reload     |
| `logs [name]`        | View project logs                    |
| `dashboard`          | Launch the web dashboard             |
| `mcp`                | Start the MCP server for Claude      |

**CI/CD & Deployments**

| Command                    | Description                          |
|----------------------------|--------------------------------------|
| `pipeline [name]`          | View Jenkins pipeline status         |
| `pipeline [name] --local`  | Run CI/CD pipeline locally           |
| `deploy [name]`            | Deploy to an environment             |
| `canary [name]`            | Start a canary deployment            |

**Observability & Analysis**

| Command           | Description                              |
|-------------------|------------------------------------------|
| `agent [name]`    | AI agent for debugging (Claude or Ollama) |
| `analyze [name]`  | Root cause analysis on failures          |
| `perf [name]`     | Performance analysis                     |
| `chaos [name]`    | Run chaos / resilience tests             |

**Infrastructure**

| Command                       | Description                                         |
|-------------------------------|-----------------------------------------------------|
| `jenkins start/stop/status`   | Manage Jenkins CI server                            |
| `jenkins add-project <name>`  | Register project with Jenkins (automatic via start) |
| `jenkins build <name>`        | Trigger a Jenkins build                             |
| `dashboard`                   | Launch the web dashboard                            |

---

## Examples

Reference implementations showing blissful-infra applied to real-world problems.

```bash
# List available examples
blissful-infra example list

# Scaffold an example project (inspect before running)
blissful-infra example content-recommender

# Then start it
cd content-recommender && blissful-infra up
```

| Example | Problem | Stack |
|---------|---------|-------|
| **[Content Recommender](./examples/content-recommender/)** | Real-time personalized recommendations for a streaming platform | Spring Boot + ALS collaborative filtering + ClickHouse + MLflow |

The `example` command scaffolds a complete, runnable project using the base templates plus the example's custom overrides. No boilerplate to write. Inspect the generated code, then run it.

---

## Next Steps

### Managing multiple environments: the client model

`blissful-infra start` is the front door for a single project. When you need
multiple isolated environments (multiple clients, staging vs production, or
just keeping projects separate from each other), use the **client model**.
Each client gets its own Kafka, Postgres, Jenkins, and observability stack
on its own Docker network. Full isolation per tenant.

```bash
# Create a new client environment (its own Kafka, Postgres, Jenkins, ...)
blissful-infra client create acme-corp

# Add services to it. `service add` reads each template's infra-deps manifest
# and prompts to enable any required (or useful optional) client-level
# components. Pass --yes to auto-enable required deps non-interactively.
blissful-infra service add acme-corp api --backend spring-boot --frontend react-vite

# Toggle infra later, after the client already exists
blissful-infra client infra add acme-corp localstack
blissful-infra client infra remove acme-corp mage

# Lifecycle
blissful-infra client up acme-corp
blissful-infra client status acme-corp
blissful-infra client down acme-corp
```

See [specs/client-model.md](./specs/client-model.md) for the full design and
[docs/adr/0002-per-client-isolation-model.md](./docs/adr/0002-per-client-isolation-model.md)
for why we chose this shape.

### Architectural decisions

Significant choices are captured as ADRs in
[docs/adr/](./docs/adr/). Each one documents the *why* behind a decision:
context, trade-offs, alternatives considered. Read these before making
cross-cutting changes.

### Specs and reference

- **[Learning Guide](./docs/LEARNING_GUIDE.md)**: Enterprise infrastructure patterns (Kafka, Kubernetes, GitOps, observability)
- **[Product Spec](./specs/product.md)**: Full technical specification
- **[Agent Spec](./specs/agent.md)**: How the AI analysis agent works
- **[Client Model](./specs/client-model.md)**: Multi-tenant client environments
- **[Analytics Spec](./specs/analytics.md)**: User session analytics pipeline (planned)
- **[Roadmap](./specs/timeline.md)**: What's built and what's coming

### Plugins

Extend your project with optional plugins:

```bash
# Add an AI/ML pipeline service
blissful-infra start my-app --plugins ai-pipeline
```

| Plugin        | Description                                                                                                  |
|---------------|--------------------------------------------------------------------------------------------------------------|
| `ai-pipeline` | Real-time event classification with Kafka + scikit-learn. Co-deploys ClickHouse, MLflow, and Mage automatically. |

### Contributing

```bash
# Clone and install (npm workspaces resolve the shared package automatically)
git clone https://github.com/cavanpage/blissful-infra.git
cd blissful-infra && npm install

# Build everything (shared, then cli, then dashboard)
npm run build
```

#### Run the dogfood dev environment

`./dev.sh` brings up a `dev` client (the canonical "real-world client" we
develop against) with backend + frontend + LocalStack inside the unified
client-model Compose project. The script creates the client on first run
and just brings it up on subsequent runs.

```bash
./dev.sh
```

After it finishes:

| Service       | URL                          |
|---------------|------------------------------|
| Frontend      | <http://localhost:14101>     |
| Backend API   | <http://localhost:14100>     |
| LocalStack    | <http://localhost:14102>     |
| Dashboard     | <http://localhost:3013>      |
| Grafana       | <http://localhost:3021>      |
| Jenkins       | <http://localhost:8101>      |

Source code lives at `~/.blissful-infra/clients/dev/app/{backend,frontend}`.
Edit there to iterate.

#### Working on templates

Templates live in `packages/cli/templates/`. They are copied into scaffolded
projects with `{{PROJECT_NAME}}` and `{{#IF_POSTGRES}}` blocks resolved at
scaffold time.

To test a template change end-to-end: edit the template, then create a
fresh client + service from it.

```bash
# Build the CLI to pick up template changes
npm run build:cli

# Spin up an isolated test client (different name so it doesn't collide with `dev`)
blissful-infra client create scratch --yes
blissful-infra service add scratch app --backend spring-boot --frontend react-vite

# When done
blissful-infra client remove scratch
```

The template hot-reload mode (`blissful-infra dev --templates`) was
flat-model-only and is currently broken in the client model. See the
"TODOs" in [CLAUDE.md](./CLAUDE.md) for the porting plan.

#### Tests

Three layers. See [docs/adr/0005-three-layer-testing-strategy.md](./docs/adr/0005-three-layer-testing-strategy.md).

```bash
npm test                  # Layer 1+2: schema + compose validation, ~400ms
npm run test:watch        # vitest watch mode in packages/cli
npm run test:integration  # Layer 3: real Docker, ~minutes
npm run test:all          # everything
```

Add a Layer 1/2 test alongside any change to schemas, helpers, or compose
generators. Layer 3 covers full client/service lifecycle.

---

## Acknowledgments

blissful-infra is a thin orchestration layer over excellent open-source projects.
It pulls these as Docker images at runtime. None are vendored or modified.

| Project | License | Role in blissful-infra |
|---|---|---|
| [LocalStack](https://localstack.cloud/) | Apache 2.0 | AWS-service emulation (S3, Lambda, SQS, DynamoDB) |
| [ClickHouse](https://clickhouse.com/) | Apache 2.0 | Columnar analytical warehouse |
| [Apache Kafka](https://kafka.apache.org/) | Apache 2.0 | Event streaming |
| [PostgreSQL](https://www.postgresql.org/) | PostgreSQL License | Transactional database |
| [Jenkins](https://www.jenkins.io/) | MIT | CI/CD pipelines |
| [Prometheus](https://prometheus.io/) | Apache 2.0 | Metrics collection |
| [Grafana](https://grafana.com/) | AGPL 3.0 | Metrics & log dashboards |
| [Jaeger](https://www.jaegertracing.io/) | Apache 2.0 | Distributed tracing |
| [Loki](https://grafana.com/oss/loki/) + Promtail | AGPL 3.0 | Log aggregation |
| [Caddy](https://caddyserver.com/) | Apache 2.0 | TLS edge proxy (planned, ADR-0001) |
| [Keycloak](https://www.keycloak.org/) | Apache 2.0 | Identity & access management |
| [MLflow](https://mlflow.org/) | Apache 2.0 | ML experiment tracking + model registry |
| [Mage](https://www.mage.ai/) | Apache 2.0 | Visual workflow orchestration |
| [Spring Boot](https://spring.io/projects/spring-boot) | Apache 2.0 | Default backend template |
| [React](https://react.dev/) + [Vite](https://vitejs.dev/) | MIT | Default frontend template |

### Project philosophy: real services, not vendor emulation

blissful-infra integrates real open-source platform services for everything it
can. Keycloak instead of mocking AWS Cognito, Postgres instead of mocking
managed RDS, Kafka instead of mocking SQS for queueing. The exception is
LocalStack for AWS-API-shaped services where the protocol matters (S3, Lambda
event shapes, etc.). There's no portable equivalent for those.

Where a paid tier exists upstream (LocalStack Pro, Datadog, Auth0 paid tier,
etc.), blissful-infra doesn't bundle or recommend it. The aim is
"production-grade local infrastructure with zero ongoing cost." Anything that
requires a paid license gets either an open-source equivalent or stays out of
scope.

For a longer take on why blissful-infra prefers OSS over managed services
during the learning phase, and why managed services are still often the right
call once you ship, see the [Philosophy page](https://blissful-infra.com/philosophy).

### AI integration

blissful-infra optionally integrates with [Anthropic's Claude API](https://www.anthropic.com/api)
for the AI agent and analysis features. Users provide their own
`ANTHROPIC_API_KEY`. No key is bundled.

---

<div align="center">

**Iterate in seconds. Deploy with confidence. No cloud required.**

</div>
