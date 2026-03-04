<div align="center">

# blissful-infra

**Enterprise infrastructure on your laptop.**

One command creates and runs a full-stack app with CI/CD, observability, and an AI agent — no cloud required.

---

[What is blissful-infra?](#what-is-blissful-infra) · [Use Cases](#use-cases) · [Quickstart](#quickstart) · [Basics](#basics) · [Next Steps](#next-steps)

---

</div>

## What is blissful-infra?

blissful-infra is a CLI that scaffolds and runs production-grade full-stack applications locally. Run one command and get a backend API, React frontend, Kafka message bus, Postgres database, Prometheus metrics, Grafana dashboards, Jenkins CI/CD pipeline, and an AI debugging agent — all wired together and running in Docker.

```bash
blissful-infra start my-app
```

That's it. No YAML to hand-write. No services to manually connect. No cloud account required.

blissful-infra organizes your local stack into a single managed environment and exposes it through a dashboard UI. The same configuration and workflows work whether you're iterating on a feature locally or handing off to a CI pipeline.

**What makes it different from tools like Tilt or Garden:**

Those tools orchestrate services you already wrote. blissful-infra also *creates* them — scaffolding a production-ready project with observability, CI/CD, and AI tooling wired in from the start. It's the difference between a toolkit and a complete local platform.

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

Every developer runs the same stack. `blissful-infra up` in a project directory reads the `blissful-infra.yaml` config and starts the exact same services, ports, and configuration — no "works on my machine" drift.

```bash
git clone git@github.com:your-org/my-app.git
cd my-app && blissful-infra up
```

### Learning enterprise infrastructure patterns

blissful-infra is designed to be a working reference for how production systems are built — event-driven microservices, Kafka streams, Kubernetes manifests, GitOps with Argo CD, canary deployments, chaos testing, and observability with Prometheus and Grafana. Everything is generated as real, readable code in your project directory.

### Building AI/ML-powered services

The `ai-pipeline` plugin deploys a full ML data platform alongside your app — a Python FastAPI service that classifies Kafka events with scikit-learn, plus ClickHouse for prediction storage, MLflow for experiment tracking, and Mage for visual pipeline orchestration.

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
npm install -g blissful-infra

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

A blissful-infra project is a directory with a `blissful-infra.yaml` config file and a generated `docker-compose.yaml`. Every service — backend, frontend, Kafka, databases, monitoring — is defined in that compose file and managed together.

```
my-app/
├── backend/              # Spring Boot / FastAPI / Express / Go
│   └── Jenkinsfile       # CI/CD pipeline definition
├── frontend/             # React + Vite
├── loki/                 # Log aggregation config
├── prometheus/           # Metrics scrape config (with monitoring)
├── grafana/              # Dashboards and datasources (with monitoring)
├── ai-pipeline/          # ML service (if --plugins ai-pipeline)
├── k8s/                  # Kubernetes manifests + Argo CD (if --deploy kubernetes)
├── docker-compose.yaml   # Everything wired together
└── blissful-infra.yaml   # Project config
```

### Templates

The backend and frontend are generated from templates. Choose the stack that fits your project:

**Backend**

| Template      | Stack                                          |
|---------------|------------------------------------------------|
| `spring-boot` | Kotlin + Spring Boot + Kafka + WebSockets      |
| `fastapi`     | Python + FastAPI + Kafka + WebSockets          |
| `express`     | Node + Express + TypeScript + Kafka            |
| `go-chi`      | Go + Chi + Kafka + WebSockets                  |

**Frontend**

| Template      | Stack                                          |
|---------------|------------------------------------------------|
| `react-vite`  | React + Vite + TypeScript + TailwindCSS        |
| `nextjs`      | Next.js + TypeScript + TailwindCSS             |

```bash
blissful-infra start my-app --backend fastapi --frontend react-vite
```

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
| `agent [name]`    | AI agent for debugging (uses Ollama)     |
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

# Scaffold an example project (no Docker started — inspect first)
blissful-infra example content-recommender

# Then start it
cd content-recommender && blissful-infra up
```

| Example | Problem | Stack |
|---------|---------|-------|
| **[Content Recommender](./examples/content-recommender/)** | Real-time personalized recommendations for a streaming platform | Spring Boot + ALS collaborative filtering + ClickHouse + MLflow |

The `example` command scaffolds a complete, runnable project using the base templates plus the example's custom overrides (ML model, data layer, endpoints). No boilerplate to write — inspect the generated code, then run it.

---

## Next Steps

- **[Learning Guide](./docs/LEARNING_GUIDE.md)** — Understand the enterprise infrastructure patterns blissful-infra uses (Kafka, Kubernetes, GitOps, observability)
- **[Product Spec](./specs/product.md)** — Full technical specification for all features
- **[Agent Spec](./specs/agent.md)** — How the AI analysis agent works
- **[Roadmap](./specs/timeline.md)** — What's built and what's coming

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
# Clone and install
git clone https://github.com/cavanpage/blissful-infra.git
cd blissful-infra && npm install

# Build the CLI
cd packages/cli && npm run build

# Create a test project with linked templates (edits reflect immediately)
node dist/index.js start test-app --link

# Cleanup
docker compose -f test-app/docker-compose.yaml down
rm -rf test-app
```

> **Note:** In link mode, template variables like `{{PROJECT_NAME}}` won't be substituted since files are symlinked. Use `--link` for developing template code, then test without it to verify substitution.

---

<div align="center">

**Iterate in seconds. Deploy with confidence. No cloud required.**

</div>
