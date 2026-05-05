# Template System

Templates are raw scaffold files shipped inside the `@blissful-infra/cli` npm package under `templates/`. They are **not** TypeScript, they are Dockerfiles, Kotlin source, YAML, shell scripts, and config files with placeholder syntax processed at scaffold time.

See [packages/cli/CLAUDE.md](../../CLAUDE.md) for CLI context. The substitution logic lives in `src/utils/template.ts`.

---

## Directory map

```
templates/
├── spring-boot/          # Kotlin + Spring Boot 3 backend template
│   ├── src/main/         # Application source (controllers, services, entities)
│   ├── src/test/         # Unit and integration test stubs
│   ├── Dockerfile        # Multi-stage build with OpenTelemetry Java agent
│   ├── Dockerfile.dev    # Dev image (no multi-stage, faster rebuild)
│   ├── Jenkinsfile       # CI/CD pipeline (deploys via blissful-infra API)
│   ├── build.gradle.kts  # Gradle build: Kotlin, Spring Boot, Kafka, JPA
│   ├── k8s/              # Kubernetes manifests (base + staging/ephemeral overlays)
│   └── k6/               # k6 load test scripts
├── react-vite/           # React + Vite + TypeScript + TailwindCSS frontend
│   ├── src/              # React app (pages, components, hooks, lib)
│   ├── Dockerfile        # nginx-based production image
│   └── nginx.conf        # nginx config (proxies /api/ and /ws/ to backend)
├── jenkins/              # Shared Jenkins CI server (started once, shared across projects)
│   ├── Dockerfile        # Jenkins LTS with pre-installed plugins
│   ├── casc.yaml         # Jenkins Configuration as Code
│   ├── plugins.txt       # Plugin list for jenkins-plugin-cli
│   └── docker-compose.yaml
├── grafana/              # Grafana provisioning + pre-built dashboards
│   ├── dashboards/       # JSON dashboard definitions
│   └── provisioning/     # Datasource + dashboard provider configs
├── prometheus/
│   └── prometheus.yml    # Scrape config (targets: backend /actuator/prometheus)
├── loki/
│   ├── loki-config.yaml
│   └── promtail-config.yaml
├── cluster/              # Kubernetes cluster config (Argo Rollouts, etc.)
│   └── argo-rollouts/
└── plugins/              # Optional plugin overlays added on top of base stack
    ├── ai-pipeline/      # FastAPI ML service with ClickHouse + MLflow
    ├── agent-service/    # Python AI agent service
    └── scraper/          # Scrapy web scraper base (minimal placeholder)
```

---

## Substitution syntax

At scaffold time, `src/utils/template.ts` walks every template file and applies substitutions before writing to the output directory.

### Variable substitution

```
{{PROJECT_NAME}}     →  the project name passed to `blissful-infra start`
{{REGISTRY_URL}}     →  Docker registry URL (default: localhost:5050)
```

Variables use double curly braces. Substitution is string-replace, no escaping mechanism.

### Conditional blocks

```
{{#IF_POSTGRES}}
... content only included when database includes postgres ...
{{/IF_POSTGRES}}

{{#IF_KUBERNETES}}
... content only included when kubernetes flag is set ...
{{/IF_KUBERNETES}}
```

Blocks are removed (along with their content) when the condition is false. Nesting is not supported.

**Available condition flags:** `IF_POSTGRES`, `IF_REDIS`, `IF_KUBERNETES`, `IF_KAFKA` (check `src/utils/template.ts` for the full list).

---

## Plugin overlay system

Plugins add services on top of the base stack. When a project includes `--plugins ai-pipeline`, the CLI:
1. Scaffolds the base stack normally
2. Copies `templates/plugins/ai-pipeline/` into the project directory (overlaying or adding files)
3. Adds the plugin service to the generated `docker-compose.yaml`

Plugin services declare their type in `blissful-infra.yaml` under `plugins:`. The `start.ts` command's `generateDockerCompose()` function reads plugins and adds the corresponding service blocks.

**Example plugin service block (ai-pipeline):**
```yaml
ai-pipeline:
  build: { context: ./ai-pipeline, dockerfile: Dockerfile }
  container_name: my-app-ai-pipeline
  environment:
    KAFKA_BOOTSTRAP_SERVERS: kafka:9094
    CLICKHOUSE_HOST: clickhouse
  depends_on:
    kafka: { condition: service_healthy }
    clickhouse: { condition: service_healthy }
```

---

## Spring Boot template specifics

- **Language:** Kotlin, targeting JVM 21
- **Framework:** Spring Boot 3.x with Spring Web, Spring Data JPA, Spring Kafka, WebSocket support
- **Build:** Gradle (Kotlin DSL). Run with `./gradlew build -x test` in CI.
- **Observability:** OpenTelemetry Java agent bundled in the Dockerfile (`COPY otel-javaagent.jar`). OTLP traces exported to Jaeger. Metrics exposed at `/actuator/prometheus`.
- **Health:** `/actuator/health`, used by the Jenkinsfile deploy stage to confirm the service is up.
- **Database migrations:** Flyway (when postgres is enabled). Migration files go in `src/main/resources/db/migration/`.

### Jenkinsfile

The Jenkinsfile is the most complex template. Key behaviors:
- **Initialize stage:** POSTs to `http://host.docker.internal:3002/api/projects/{{PROJECT_NAME}}/deployments` to register the deployment.
- **Build stage:** Parallel Compile + Lint (Gradle with build cache).
- **Test stage:** Parallel Unit Tests + Integration Tests (postgres flag only).
- **Containerize:** Docker BuildKit with layer caching (`--cache-from`).
- **Security Scan:** Trivy (CRITICAL exits 1, HIGH warns only).
- **Push:** Pushes to local Docker registry at `{{REGISTRY_URL}}`.
- **Deploy:** Calls `/api/projects/{{PROJECT_NAME}}/up` to restart containers, then health-checks `/actuator/health`.
- **Post success/failure:** PATCHes the deployment record with final status + sends Slack notification (optional).
- **Kubernetes conditional:** `{{#IF_KUBERNETES}}` wraps ephemeral PR environments and Argo CD staging deploy.

---

## React Vite template specifics

- **Stack:** React 19, Vite, TypeScript, TailwindCSS, React Router, Zustand
- **Production image:** nginx multi-stage build. nginx serves static assets and proxies `/api/` → `backend:8080`.
- **nginx.conf:** Handles SPA routing (`try_files $uri $uri/ /index.html`), WebSocket upgrade for `/ws/`, and API proxy.
- Note: `react-vite/node_modules/` is checked in (pre-installed deps for faster `npm install` in generated projects). Do not modify these; they are the template's own installed packages.

---

## Adding a new template or plugin

1. Create `templates/plugins/<name>/` with at minimum a `Dockerfile` and `requirements.txt` (or `package.json`).
2. Add plugin service generation logic in `packages/cli/src/commands/start.ts` → `generateDockerCompose()`.
3. Register the plugin type in `packages/cli/src/utils/plugin-registry.ts`.
4. If the plugin has an example app, add it under `examples/` and reference it from an example's `blissful-infra.yaml`.
