---
title: blissful-infra start
description: Scaffold and run a full-stack project in one command.
---

`blissful-infra start <name>` is the primary command. It creates a new project directory, generates all configuration, and boots the entire Docker Compose stack.

## Usage

```bash
blissful-infra start <name> [options]
```

`<name>` must be lowercase alphanumeric with hyphens (e.g. `my-app`, `fraud-detector`, `api-v2`).

## Options

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--backend <backend>` | `-b` | `spring-boot` | Backend framework template |
| `--frontend <frontend>` | `-f` | `react-vite` | Frontend framework template |
| `--database <database>` | `-d` | `postgres` | Database option |
| `--plugins <plugins>` | `-p` | — | Comma-separated plugin list |
| `--no-monitoring` | — | monitoring on | Disable Prometheus + Grafana |
| `--deploy-target <target>` | — | `local-only` | Cloud deploy target: `cloudflare`, `vercel`, or `aws` |
| `--link` | `-l` | — | Template dev mode: skip copying, link to template sources |

## Examples

```bash
# Default stack (Spring Boot + React + Postgres)
blissful-infra start my-app

# FastAPI backend
blissful-infra start my-app --backend fastapi

# Postgres + Redis cache layer
blissful-infra start my-app --database postgres-redis

# AI/ML pipeline plugin
blissful-infra start my-app --plugins ai-pipeline

# Multiple plugins
blissful-infra start my-app --plugins ai-pipeline,agent-service

# Minimal stack (no monitoring overhead)
blissful-infra start my-app --no-monitoring --database none

# Scaffold for Cloudflare deploy (generates wrangler.toml, sets deploy.target)
blissful-infra start my-app --deploy-target cloudflare
```

## What `start` does step by step

### 1. Pre-flight checks

Before creating anything, the CLI:

- Verifies Docker Desktop is running (`docker info`)
- Checks that required ports are free. If any port is in use, the command lists the conflicts and exits cleanly. You can stop the conflicting service or use `blissful-infra down` to stop a previous project.

Required ports (default stack):

| Port | Service |
|------|---------|
| 3000 | Frontend |
| 3001 | Grafana |
| 3002 | Dashboard |
| 8080 | Backend API |
| 8081 | Jenkins |
| 9090 | Prometheus |
| 9092 | Kafka external listener |
| 5432 | Postgres |
| 6379 | Redis (with `redis` or `postgres-redis`) |
| 16686 | Jaeger |
| 3100 | Loki |
| 5050 | Docker registry |

### 2. Jenkins

If the shared Jenkins server is not already running, `start` boots it automatically. Jenkins is a shared service — it persists across projects and lives in `~/.blissful-infra/jenkins/`.

### 3. Scaffold

The CLI creates the project directory and copies template files. `{{PROJECT_NAME}}` placeholders in all template files are replaced with the project name you provided. Conditional blocks like `{{#IF_POSTGRES}}` are resolved based on the `--database` flag, so the generated code only includes what your stack actually needs.

For the default `spring-boot` + `react-vite` + `postgres` stack, this creates:

- `backend/` — compiled Kotlin source, Gradle wrapper, Dockerfile, Jenkinsfile, Flyway migrations, JPA entities
- `frontend/` — React + Vite + TypeScript source, TailwindCSS config, Dockerfile
- `loki/` — Loki and Promtail configuration files
- `prometheus/` — Prometheus scrape config targeting `backend:8080/actuator/prometheus`
- `grafana/` — Datasource provisioning (Prometheus + Loki) and three pre-built dashboards
- `nginx.conf` — Reverse proxy routing `/api/` and `/ws/` to the backend, everything else to the frontend
- `blissful-infra.yaml` — Project configuration file
- `.gitignore`

### 4. docker-compose.yaml generation

The CLI programmatically generates `docker-compose.yaml` based on your flags. Services included:

**Always present:** `kafka`, `backend`, `frontend`, `nginx`, `jaeger`, `loki`, `promtail`, `dashboard`

**With `postgres` or `postgres-redis`:** adds `postgres`

**With `redis` or `postgres-redis`:** adds `redis`

**With `--monitoring` (default):** adds `prometheus`, `grafana`

**With `--plugins ai-pipeline`:** adds `clickhouse`, `mlflow`, `mage`, and the AI pipeline service itself

All services have health checks and proper `depends_on` conditions so containers start in dependency order.

### 5. Build and start

Runs `docker compose up -d --build` in the project directory. The backend Dockerfile includes the OpenTelemetry Java agent for automatic distributed tracing to Jaeger.

### 6. Jenkins job registration

After containers start, the CLI registers the project as a Jenkins pipeline job pointing at the `backend/Jenkinsfile`. The job is created in a `blissful-projects` folder at `http://localhost:8081/job/blissful-projects/job/<name>`.

### 7. Output

Once everything is running, the CLI prints all service URLs and opens the frontend and dashboard in your browser.

## Service ports with `--plugins ai-pipeline`

When the AI pipeline plugin is enabled, three additional data platform services start:

| Service    | URL                         | Purpose                              |
|------------|-----------------------------|--------------------------------------|
| AI Pipeline | http://localhost:8090/docs | FastAPI + scikit-learn classifier    |
| ClickHouse | http://localhost:8123/play  | Columnar store for predictions       |
| MLflow     | http://localhost:5001       | Experiment tracking + model registry |
| Mage       | http://localhost:6789       | Visual data pipeline orchestrator    |

## The `--link` flag

Use `--link` when developing the blissful-infra templates themselves. Instead of making a fully independent copy, the project is scaffolded and then you can use `blissful-infra dev --templates <name>` to sync template changes live into the running project. See [blissful-infra dev](/commands/dev) for the full template development workflow.

## Error handling

**Port conflict:** The CLI lists which ports are occupied and which services own them, then exits without creating any files.

**Docker not running:** Clear error with instructions to start Docker Desktop.

**Directory already exists:** The CLI refuses to overwrite an existing directory. Use a different name or remove the old directory first.

**Build failure:** If `docker compose up --build` fails, the project directory is still created (so you can debug). The CLI prints the compose exit and suggests running `docker compose up --build` manually from the project directory to see the full output.
