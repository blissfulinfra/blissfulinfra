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
│   ├── Jenkinsfile       # CI pipeline (build/test/scan; deploys are CLI-driven)
│   ├── build.gradle.kts  # Gradle build: Kotlin, Spring Boot, Kafka, JPA
│   └── k6/               # k6 load test scripts
├── react-vite/           # React + Vite + TypeScript + TailwindCSS frontend
│   ├── src/              # React app (pages, components, hooks, lib)
│   ├── Dockerfile        # nginx-based production image
│   └── nginx.conf        # nginx config (proxies /api/ and /ws/ to backend)
├── lambda-python/        # Serverless backend (awaiting tenant-model port)
├── jenkins/              # Tenant Jenkins CI server image
│   ├── Dockerfile        # Jenkins LTS with pre-installed plugins
│   ├── casc.yaml         # Jenkins Configuration as Code
│   ├── plugins.txt       # Plugin list for jenkins-plugin-cli
│   └── docker-compose.yaml
├── cluster/terraform/    # ADR-0020: kind cluster + ArgoCD + Argo Rollouts +
│                         # Gitea, rendered to tenants/<t>/cluster/ by `cluster up`
└── gitops/service/       # ADR-0020: per-service manifests (Rollout, canary/
                          # stable Services, ConfigMap, ArgoCD Application),
                          # rendered into the tenant's gitops repo by `deploy`
```

Observability configs (Prometheus, Grafana, Loki, Tempo) are generated inline by `src/utils/tenant-compose.ts`, not templated. The pre-2.0 plugin overlay templates were removed with the client model.

---

## Substitution syntax

At scaffold time, `src/utils/template.ts` walks every template file and applies substitutions before writing to the output directory.

### Variable substitution

```
{{PROJECT_NAME}}     →  the service name (`service add` maps it into this role)
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

## Cluster + gitops rendering (ADR-0020)

Two template sets render outside the scaffold flow, with a plain `{{VAR}}`
string replace (no conditional blocks):

- `cluster/terraform/` → rendered by `utils/terraform.ts` to
  `~/.blissful-infra/tenants/<t>/cluster/` on `cluster up`. Vars:
  `TENANT_NAME`, `KUBE_API_PORT`, `ARGOCD_PORT`, `GITEA_PORT`. Chart and
  provider versions are pinned here — bump them here.
- `gitops/service/` → rendered by `utils/gitops.ts` into the tenant's gitops
  checkout on first `deploy`. Vars: `TENANT_NAME`, `PROJECT_NAME`,
  `SERVICE_NAME`, `IMAGE_NAME`, `IMAGE_TAG`, `GITOPS_REPO_URL`. Subsequent
  deploys only rewrite the kustomization `newTag`.

---

## Spring Boot template specifics

- **Language:** Kotlin, targeting JVM 21
- **Framework:** Spring Boot 3.x with Spring Web, Spring Data JPA, Spring Kafka, WebSocket support
- **Build:** Gradle (Kotlin DSL). Run with `./gradlew build -x test` in CI.
- **Observability:** OpenTelemetry Java agent bundled in the Dockerfile (`COPY otel-javaagent.jar`). OTLP traces exported to Tempo at `http://tempo:4318` ([ADR-0016](../../../../docs/adr/0016-tempo-replaces-jaeger.md) replaced Jaeger with Tempo). Metrics exposed at `/actuator/prometheus`.
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
- Kubernetes-runtime deploys do NOT go through Jenkins — `blissful-infra deploy` owns that path (ADR-0020).

---

## React Vite template specifics

- **Stack:** React 19, Vite, TypeScript, TailwindCSS, React Router, Zustand
- **Production image:** nginx multi-stage build. nginx serves static assets and proxies `/api/` → `backend:8080`.
- **nginx.conf:** Handles SPA routing (`try_files $uri $uri/ /index.html`), WebSocket upgrade for `/ws/`, and API proxy.
- `react-vite/node_modules/` is never checked in (gitignored build residue).

---

## Adding a new template

1. Create `templates/<name>/` with a `Dockerfile` and the app scaffold.
2. Teach `service add` about it: extend the template validation in
   `packages/cli/src/commands/service-v2.ts` (`buildServiceConfig`).
3. Add an L2 test asserting the generated service compose is valid.

