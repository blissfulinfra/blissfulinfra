<div align="center">

# Blissful Infra

**An enterprise sandbox on your laptop.**

Real Kafka, real Postgres, real observability, real CI. Wired together by one command. Built for engineers who want to iterate on architecture patterns without a cloud bill.

[![CI](https://github.com/cavanpage/blissful-infra/actions/workflows/ci.yml/badge.svg)](https://github.com/cavanpage/blissful-infra/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@blissful-infra/cli)](https://www.npmjs.com/package/@blissful-infra/cli)

---

[What is blissful-infra?](#what-is-blissful-infra) · [Why I built this](#why-i-built-this) · [Choose your path](#choose-your-path) · [Quickstart](#quickstart) · [Basics](#basics) · [Next Steps](#next-steps)

---

</div>

## What is blissful-infra?

blissful-infra is a CLI that spins up a real enterprise-shaped stack on your laptop. Run one command and get a backend API, React frontend, Kafka message bus, Postgres database, Prometheus metrics, Grafana dashboards, Jenkins CI/CD pipeline and an AI debugging agent. Everything is wired together and running in Docker.

```bash
blissful-infra init
```

That's it. A guided wizard walks you through picking infrastructure and adding your first service. No YAML to hand-write. No services to manually connect. No cloud account required.

The idea is that you should be able to try an architecture pattern, throw it away and try the next one in the time it usually takes to read the docs for one of them. The same config that drives the local stack also drives the deploy when a project is ready to ship.

**What makes it different from tools like Tilt or Garden:**

Those tools orchestrate services you already wrote. blissful-infra also *creates* them, scaffolding a production-shaped project with observability, CI/CD and AI tooling wired in from the start.

## Why I built this

I spent a few years at Intuit on the Identity / Auth team. Most of the infrastructure you work with at that scale is already provided for you. Auth, observability, deploy pipelines, message buses, datastores. Productive, but layered. Internal platforms exist for good reasons (resource caps, standardization, blast-radius limits) and they do their job well. The trade off is that several layers of abstraction sit between you and the technology underneath.

I wanted to go deeper on the enterprise patterns I used every day. I wanted to wire Kafka up by hand, watch a JWT round trip through Keycloak, swap Redis for a Postgres read replica and benchmark the difference. The frustrating part was that none of the interesting work started with the experiment. It started with two hours of `docker-compose.yaml` and an evening of "why is Kafka not reachable from the JVM container".

blissful-infra is the tool I wanted. Spin up real infrastructure fast, focus on the fun parts: building apps, services and products. For enterprise engineers it is a sandbox that mirrors what real teams run. For solo developers and small studios it is enterprise-shape infrastructure without the enterprise bill (a managed Kafka, Postgres, observability stack and CI runner across two or three client projects adds up to real money every month).

Longer version on the site: [Why I built this →](https://blissful-infra.com/about)

---

## Choose your path

blissful-infra serves three audiences, all working from the same toolchain.

| You are... | Path | Outcome |
|---|---|---|
| **Building**: enterprise engineer or indie builder who wants to iterate on architecture patterns fast | [Build](https://blissful-infra.com/paths/build) | One command to a real stack you can actually pull apart. Skip the boilerplate, prototype now, dig deeper later. |
| **Learning**: student, new grad or anyone wanting enterprise-pattern fluency without an AWS bill | [Learn](https://blissful-infra.com/paths/learn) | A guided course that takes you from zero to a running Kubernetes service backed by Kafka, Postgres and Keycloak. Understand each layer before reaching for a managed equivalent. |
| **Delivering**: small studio or indie team running multiple client projects | [Deliver](https://blissful-infra.com/paths/deliver) | Per-client isolated stacks with their own Kafka, Postgres, observability and CI. One laptop, many clients, no SaaS sprawl. |

### A note on managed services

Most technologies blissful-infra runs locally have excellent managed equivalents: [Auth0](https://auth0.com/) over Keycloak, [RDS](https://aws.amazon.com/rds/) over Postgres, [Confluent Cloud](https://www.confluent.io/) over Kafka, [Datadog](https://www.datadoghq.com/) over the Prometheus/Grafana/Loki stack. Those services are great. They start faster, ship with built-in compliance, and remove most of the operational burden. When you're a small team shipping to production, reaching for one is often the right call.

blissful-infra exists for a different reason. A lot of enterprise development happens on top of managed services that already exist when you arrive. You write business logic against a Cognito instance someone else provisioned, push to an EKS cluster someone else maintains. That's productive, but it hides the layers, and starting from a blank slate becomes intimidating. blissful-infra puts every layer back in your hands so you can experiment, break things, and understand the tradeoffs at each level. When you do graduate to a managed service, you'll know what it's doing on your behalf, what you're paying for, and where the meaningful differences are.

---

## Use Cases

### Starting a new project from scratch

blissful-infra's primary use case. The `init` wizard prompts you for a client name, the infrastructure components you want, and your first service. Under a minute later you have a running full-stack app with real infra.

```bash
blissful-infra init
```

Want to skip prompts? Pass `--yes` to accept all defaults (creates client `dev` with the standard infra and a `spring-boot` + `react-vite` service called `app`).

### Standardizing dev environments across a team

Every developer runs `blissful-infra init` and picks the same client name. The client config lives in `~/.blissful-infra/clients/<name>/blissful-infra.yaml`; check it into your team repo or share the relevant parts so everyone gets the same Kafka, Postgres, Jenkins, and observability stack with the same ports.

### Learning enterprise infrastructure patterns

blissful-infra is designed to be a working reference for how production systems are built. Event-driven microservices, Kafka streams, Kubernetes manifests, GitOps with Argo CD, canary deployments, chaos testing, and observability with Prometheus and Grafana. Everything is generated as real, readable code in your client directory.

### Building AI/ML-powered services

The `ai-pipeline` plugin deploys a full ML data platform alongside your app. A Python FastAPI service classifies Kafka events with scikit-learn, with ClickHouse for prediction storage, MLflow for experiment tracking, and Mage for visual pipeline orchestration. Pick it from the plugin checkbox during `init` and the dashboard auto-draws the Kafka edge from your backend to the pipeline in the ontology graph.

(Exact URLs depend on the port block assigned to your client — `client status <name>` lists them.)

---

## Your first client, step by step

This walks you from zero through a running frontend + backend + data pipeline, all visible in an ontology graph you can extend visually.

### Prerequisites

```bash
docker --version   # Docker Desktop running (or Docker Engine on Linux)
node --version     # Node 20+
```

### Install

```bash
git clone https://github.com/cavanpage/blissful-infra.git
cd blissful-infra
npm install
npm run build:cli
npm link -w packages/cli
```

`npm link` makes `blissful-infra` available globally.

### 1. Run the one command

```bash
blissful-infra init
```

This is the single entry point. Everything else is prompts.

### 2. Name your client

```
👋 Welcome to blissful-infra

This will set up one isolated client environment with its own Kafka,
Postgres, observability stack, dashboard, and (optionally) a first service.

? Client environment name: (dev) _
```

A **client** is your isolated environment — its own infra stack, its own port range, its own dashboard. You can have many side by side. Hit enter to accept `dev`.

### 3. Choose infrastructure

```
? Infrastructure components (space to toggle, enter to confirm)
  ◉ Kafka
  ◉ Postgres
  ◉ Jenkins (CI/CD)
  ◉ Prometheus + Grafana (metrics)
  ◉ Tempo (tracing)
  ◉ Loki + Promtail (logs)
  ◯ ClickHouse warehouse
  ◯ AWS emulator (floci, LocalStack-compatible)
  ◯ Keycloak IAM
  ◯ MLflow model registry
  ◯ Mage workflow orchestrator
```

The defaults are sensible for a data-pipeline app.

### 4. Add your first service

```
? Add your first service now? Y
? Service name: app
? Backend framework: spring-boot
? Frontend framework: react-vite
? Plugins:
  ◉ ai-pipeline
  ◯ agent-service
  ◯ gatling
```

The scaffold drops in real, runnable code — not stubs.

### 5. Wait

```
Allocating port block...                  ✓ block 0 allocated
Creating client directory...              ✓
Generating docker-compose.infra.yaml...   ✓
Copying spring-boot backend...            ✓
Copying react-vite frontend...            ✓
Copying ai-pipeline plugin...             ✓
[+] Running 11/11
 ✔ Container dev-kafka          Healthy
 ✔ Container dev-postgres       Healthy
 ✔ Container dev-jenkins        Started
 ✔ Container dev-grafana        Healthy
 ✔ Container dev-prometheus     Healthy
 ✔ Container dev-tempo          Healthy
 ✔ Container dev-loki           Healthy
 ✔ Container dev-dashboard      Healthy
 ✔ Container dev-app-backend   Healthy
 ✔ Container dev-app-frontend  Healthy
 ✔ Container dev-ai-pipeline    Healthy
```

First run takes a few minutes (pulling images, building Jenkins). Subsequent runs are seconds.

### 6. Open the dashboard

Look for `Dashboard: http://localhost:3010` in the output (port is `3010 + blockIndex` — first client gets `3010`).

What you'll see:

- **Header:** `blissful-infra · dev` — the blue badge confirms the client
- **Sidebar:** `Services (1)` → `app`
- **Buttons:** `Graph` · `Grafana` · `New Service`

### 7. See your system in the ontology

Click **Graph** in the header.

- **Left column (services):** `app`
- **Right column (infra):** `kafka`, `postgres`, `jenkins`, `grafana`, `prometheus`, `tempo`, `loki`, `dashboard`, `ai-pipeline`
- **Edge already drawn:** `app → kafka` labeled "publishes events"

The edge is auto-wired because you picked `ai-pipeline`. Click it.

### 8. Inspect the auto-wired contract

The right panel opens with two tabs: **Settings** and **Contract** (green dot = contract defined).

Click **Contract**. Monaco opens with a starter Avro schema:

```json
{
  "type": "record",
  "name": "Event",
  "namespace": "dev.app",
  "fields": [
    { "name": "id", "type": "string" },
    { "name": "timestamp", "type": "long" },
    { "name": "payload", "type": "string" }
  ]
}
```

Edit it to match what you want to publish, then click **Wire it up**:

```
Wrote 1 file(s): contracts/kafka.avsc · Avro producer codegen coming soon — schema saved, env vars injected
```

The schema is now at `~/.blissful-infra/clients/dev/app/contracts/kafka.avsc`, and `KAFKA_BOOTSTRAP_SERVERS=kafka:29092` is now in your service's compose.

### 9. Add a service-to-service connection

Click **New Service** (or run `blissful-infra service add dev api`). Pick `spring-boot` backend, no frontend.

Back in **Graph**, drag from the **right handle of `app`** to the **left handle of `api`**. A new edge appears.

Click it → **Contract** → **Start from template**. Edit the OpenAPI YAML to define the API:

```yaml
openapi: 3.0.3
info:
  title: api
  version: 0.1.0
paths:
  /users/{id}:
    get:
      summary: Get user
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: string }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  id:    { type: string }
                  name:  { type: string }
                  email: { type: string }
```

Click **Wire it up**:

```
Wrote 3 file(s): contracts/api.openapi.yaml,
                 src/generated/api-client/index.ts,
                 src/generated/api-client/client.ts
```

Import the typed client in `app`:

```ts
import { client } from "./generated/api-client/client";
const { data } = await client.GET("/users/{id}", { params: { path: { id: "42" } } });
```

It's typed against the contract.

### 10. Live-edit a service's compose file

Click any node → **Config** tab. The service's `docker-compose.yaml` opens in Monaco. Change a memory limit, add an env var, save. Then:

```bash
blissful-infra service up dev app
```

### 11. Tear down

```bash
blissful-infra client down dev      # stop, keep data
blissful-infra client up dev        # start back up
blissful-infra client remove dev    # wipe everything
```

That's the full happy path. Where it usually breaks for first-timers: Docker not running, or port conflicts if another stack is on `3010+`. Both surface clear errors.

---

## Basics

### Projects

A blissful-infra project is a directory with a `blissful-infra.yaml` config file and a generated `docker-compose.yaml`. Every service (backend, frontend, Kafka, databases, monitoring) is defined in that compose file and managed together.

```
app/
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
blissful-infra start app --backend spring-boot --frontend react-vite
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
blissful-infra start app --database postgres

# Postgres + Redis (recommended for production-like setups)
blissful-infra start app --database postgres-redis
```

With `postgres-redis` the generated backend includes a `ProductService` with `@Cacheable` on reads and `@CacheEvict` on writes, so you can see cache hit/miss patterns in Grafana from day one.

### Monitoring

Every project includes Prometheus and Grafana by default. Prometheus scrapes your backend's `/actuator/prometheus` endpoint. Three dashboards are provisioned automatically: Service Overview, JVM Metrics, and Infrastructure.

To disable monitoring:

```bash
blissful-infra start app --no-monitoring
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
> "Show me ERROR logs from the backend service in app"
> "Why is the backend in app restarting? Check the logs and diagnose."
> "Deploy app to staging"
> "Roll back app in production to the previous revision"

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
blissful-infra start app --plugins ai-pipeline
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
| [Tempo](https://grafana.com/oss/tempo/) | AGPL 3.0 | Distributed tracing (replaces Jaeger as of [ADR-0016](./docs/adr/0016-tempo-replaces-jaeger.md)) |
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
