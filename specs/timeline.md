# Blissful Infra - Development Timeline

## Philosophy

Ship a working "steel thread" MVP as fast as possible. Each phase should produce something usable. Resist the urge to build everything at once.

## Phase Overview

| Phase | Focus | Deliverable | Status |
|-------|-------|-------------|--------|
| **Phase 0** | Specification | Product spec, agent spec, timeline | ✅ Complete |
| **Phase 1** | MVP | CLI + 1 template + local deploy + basic agent | ✅ Complete |
| **Phase 2** | Pipeline | Jenkins CI/CD + ephemeral environments | ✅ Complete |
| **Phase 3** | Observability | Metrics, logs, dashboard v1 | ✅ Complete |
| **Phase 4** | Resilience | Chaos testing + FMEA + Canary deployments | ✅ Complete |
| **Phase 5** | Intelligence | Full agent + knowledge base | 🔧 In Progress |
| **Phase 6** | Scale | More templates + cloud deploy + enterprise components + plugin SDK | ⏳ Planned |
| **Phase 7** | Autonomy | LangGraph virtual employees that build features for your apps | ⏳ Planned |

---

## Phase 0: Specification ✅

**Goal:** Define the product vision, technical architecture, and development roadmap.

### 0.1 Documentation
- [x] Product specification ([product.md](./product.md))
- [x] Agent specification ([agent.md](./agent.md))
- [x] Development timeline ([timeline.md](./timeline.md))
- [x] README with project overview

### 0.2 Project Setup
- [x] Repository initialization
- [x] Versioning strategy (CHANGELOG.md)

---

## Phase 1: MVP ✅

**Goal:** Developer can scaffold a project, run it locally, and ask the agent basic questions.

### 1.1 CLI Foundation
- [x] Project scaffolding with `blissful-infra create`
- [x] Interactive prompts (project name, template selection)
- [x] `blissful-infra up` - start local environment
- [x] `blissful-infra down` - stop local environment
- [x] `blissful-infra logs` - tail local logs
- [x] Configuration file parsing (`blissful-infra.yaml`)

**Tech:** Node.js + TypeScript, Commander.js + Inquirer

**Location:** `packages/cli/`

### 1.2 First Template (Spring Boot)
- [x] Kotlin + Spring Boot hello world
- [x] Standard endpoints (`/health`, `/hello`, `/hello/:name`, `/echo`, `/ready`, `/live`)
- [x] Dockerfile (multi-stage build)
- [x] Docker Compose for local orchestration
- [x] Basic unit tests (JUnit 5 + MockK)
- [x] Structured JSON logging (logstash-logback-encoder)
- [x] Kafka producer/consumer with WebSocket bridge
- [x] Template variable substitution (`{{PROJECT_NAME}}`)

**Location:** `packages/cli/templates/spring-boot/`

### 1.3 Local Infrastructure
- [x] Docker Compose generation with:
  - Application container
  - Kafka (single broker, KRaft mode - no Zookeeper)
  - Redis (optional, based on user selection)
  - PostgreSQL (optional, based on user selection)
- [x] Health check orchestration (wait for dependencies)
- [x] Port management and conflict detection

### 1.4 Basic Agent
- [x] Ollama integration (connection, model detection)
- [x] Simple query interface: `blissful-infra agent --query "..."`
- [x] Interactive mode: `blissful-infra agent`
- [x] Context collection:
  - Read local logs from Docker
  - Read recent git commits
- [x] Basic analysis prompts (no knowledge base yet)
- [x] Model fallback (70b → 8b if unavailable)

### 1.5 Template Enhancements
- [x] HealthController: `/ready` checks database connectivity (use autowired DataSource)
- [x] HealthController: `/ready` checks Kafka connectivity
- [x] HealthController: Track and expose startup time (`/startup` endpoint)
- [x] Add Micrometer Prometheus registry for metrics endpoint (`/actuator/prometheus`)
- [x] Request duration histogram (for p95/p99 latency calculation)
- [x] Request counter with status code labels

**Location:**
- `packages/cli/templates/spring-boot/src/main/kotlin/com/blissful/controller/HealthController.kt`
- `packages/cli/templates/spring-boot/src/main/kotlin/com/blissful/config/MetricsConfig.kt`

### MVP Definition of Done
```
$ npx blissful-infra create
? Project name: my-service
? Template: spring-boot
? Database: postgres

$ cd my-service
$ blissful-infra up
Starting my-service...
✓ Postgres ready
✓ Kafka ready
✓ Application ready

$ curl localhost:8080/hello/world
{"message": "Hello, world!"}

$ blissful-infra agent --query "show me recent logs"
Here are the last 50 log entries...

$ blissful-infra down
Stopped.
```

---

## Phase 2: Pipeline ✅

**Goal:** Automated build, test, and deploy pipeline with ephemeral environments.

### 2.1 Jenkinsfile Template
- [x] Pipeline stages: build → test → containerize → security scan → push → deploy
- [x] Parallel test execution (unit tests + integration tests)
- [x] Build caching for faster iterations
- [x] Artifact publishing (container image)
- [x] Pipeline status reporting
- [x] Conditional K8s deployment stages

**Location:** `packages/cli/templates/spring-boot/Jenkinsfile`

### 2.2 Container Registry
- [x] Local registry option (localhost:5050)
- [x] ECR/GCR/ACR integration (configurable via blissful-infra.yaml)
- [x] Image tagging strategy (git sha + latest)
- [x] Security scanning with Trivy
- [x] Registry utilities (`packages/cli/src/utils/registry.ts`)

### 2.3 Kubernetes Manifests
- [x] Deployment, Service, ConfigMap, Secret templates
- [x] ServiceAccount with security context
- [x] Kustomize base + overlays (staging, production, ephemeral)
- [x] Namespace per environment strategy
- [x] Resource limits and requests (256Mi-2Gi memory, 100m-2000m CPU)
- [x] Readiness probe (`/ready`, 10s initial delay)
- [x] Liveness probe (`/live`, 30s initial delay)

**Location:** `packages/cli/templates/spring-boot/k8s/`

### 2.4 Argo CD Integration
- [x] Application manifest generation
- [x] GitOps sync configuration with auto-heal
- [x] `blissful-infra deploy --env <env>` command
- [x] `blissful-infra rollback --env <env>` command
- [x] `blissful-infra status` command showing all environments

**Location:** `packages/cli/templates/spring-boot/k8s/argocd/application.yaml`

### 2.5 Ephemeral Environments
- [x] Spin up isolated namespace per PR/branch
- [x] Automatic teardown after pipeline (via Jenkinsfile post stage)
- [x] Ephemeral overlay with TTL annotation
- [x] `blissful-infra pipeline --local` for local pipeline run

### 2.6 New CLI Commands
- [x] `blissful-infra deploy` - Deploy via Argo CD or kubectl
- [x] `blissful-infra rollback` - Rollback to previous revision
- [x] `blissful-infra status` - Show deployment status table
- [x] `blissful-infra pipeline --local` - Run build/test/containerize locally

**Location:** `packages/cli/src/commands/{deploy,rollback,status,pipeline}.ts`

### 2.7 Shared Jenkins Server
- [x] `blissful-infra jenkins start` - Start Jenkins + local registry
- [x] `blissful-infra jenkins stop` - Stop Jenkins server
- [x] `blissful-infra jenkins status` - Show Jenkins status
- [x] `blissful-infra jenkins add-project <name>` - Register project with Jenkins
- [x] `blissful-infra jenkins build <name>` - Trigger a build
- [x] `blissful-infra jenkins list` - List registered projects
- [x] Pre-configured with Pipeline, Docker, Git, and supporting plugins via JCasC
- [x] Jenkins Configuration as Code (JCasC) for zero-touch setup
- [x] Custom image build (`blissful-jenkins:latest`) with plugins pre-installed
- [x] Local Docker registry on port 5050
- [x] Default credentials: admin/admin

**Location:** `packages/cli/templates/jenkins/`, `packages/cli/src/commands/jenkins.ts`

### 2.8 Pipeline Enhancements
- [x] Build notifications (Slack webhook integration)
- [ ] Build notifications (email support)
- [x] Gradle/Maven dependency caching in Jenkinsfile
- [x] Docker layer caching for faster rebuilds (BuildKit)
- [x] Pipeline failure notifications with error context
- [x] Build time tracking and metrics logging

**Location:** `packages/cli/templates/spring-boot/Jenkinsfile`, `packages/cli/templates/jenkins/`

### Phase 2 Definition of Done
```
# Create and run a project — Jenkins starts automatically
$ blissful-infra start my-service
Starting Jenkins CI/CD server...
✓ Jenkins is ready
✓ Created my-service/
✓ Containers started
✓ Registered my-service with Jenkins
URL: http://localhost:8081
Username: admin
Password: admin
Registry: localhost:5050

# Or start Jenkins manually
$ blissful-infra jenkins start

# Re-register an existing project (if needed)
$ blissful-infra jenkins add-project my-service
✓ Added my-service to Jenkins

# Trigger a build
$ blissful-infra jenkins build my-service
✓ Build triggered for my-service

# Or run pipeline locally
$ blissful-infra pipeline --local
Running local pipeline...
✓ Build (12.3s)
✓ Test (8.5s)
✓ Containerize (15.2s)
✓ Security Scan (4.1s)
Pipeline completed successfully!
```

---

## Phase 3: Observability ✅

**Goal:** See what's happening in your local services with metrics, logs, and a basic dashboard.

### 3.1 Metrics Collection (Local)
- [x] Docker container metrics collection (CPU, memory, network I/O)
- [x] Spring Boot Actuator integration
- [x] HTTP metrics: request rate, response time, error rate
- [x] JVM/runtime metrics (memory, GC, threads)
- [x] Time series visualization with configurable windows (1m, 5m, 15m, 1h, 24h)
- [x] Real-time metrics polling

### 3.2 Log Aggregation (Local)
- [x] Docker log collection from containers
- [x] Structured log parsing (JSON)
- [x] Log viewer with real-time updates
- [x] `blissful-infra logs` command with filtering

### 3.3 Health Monitoring
- [x] Service health checks (backend, frontend, databases, Kafka)
- [x] Real-time health status display
- [x] Health endpoint polling

### 3.4 Dashboard v1 (Minimal)
- [x] React + Vite + TypeScript scaffolding
- [x] Environment status view (local)
- [x] Service health status cards
- [x] Time series metrics display (CPU, memory, request rate, response time)
- [x] Log viewer with search and filtering
- [x] Agent chat interface with markdown support
- [x] `blissful-infra dashboard` command to open

**Location:** `packages/dashboard/`

**Note:** Phase 3 focuses on local observability only. Cluster-based observability (Prometheus, Loki) and performance testing (k6) moved to Phase 4.

### 3.5 Observability Enhancements ✅
- [x] Historical metrics storage (persist metrics to JSON lines file with rotation)
- [x] Metrics export to JSON/CSV via API
- [x] Dashboard: Request latency percentiles (p50, p95, p99)
- [x] Dashboard: Error rate trends over time
- [x] Dashboard: Load historical metrics on tab switch
- [x] Alert thresholds configuration (CPU, memory, error rate, latency)
- [x] Dashboard: Active alerts display with acknowledge
- [x] Log retention and rotation settings (configurable size, age, file count limits)
- [x] Log search API (filter by service, level, keyword, time range)
- [ ] Dashboard: Comparison view (before/after deploy)

**Location:** `packages/cli/src/utils/metrics-storage.ts`, `packages/cli/src/utils/alerts.ts`, `packages/cli/src/utils/log-storage.ts`, `packages/cli/src/server/api.ts`, `packages/dashboard/src/App.tsx`

### 3.6 Prometheus + Grafana (Default Monitoring Stack) ✅
Prometheus + Grafana ships by default with every project. Industry-standard tooling with PromQL queries, persistent storage, pre-built dashboards, and a direct integration path for the Phase 7 watchdog agent. Linked from the main blissful-infra dashboard header.

**Opt-out via CLI flag:**
```bash
blissful-infra start my-app --no-monitoring   # disable Prometheus + Grafana
```

**What gets deployed:**
```
┌─────────────────────────────────────────────────┐
│              Docker Compose                      │
│                                                  │
│  ┌──────────┐    scrape     ┌──────────────┐    │
│  │  Spring   │◄─────────────│  Prometheus  │    │
│  │  Boot     │  /actuator/  │  :9090       │    │
│  │  :8080    │  prometheus  └──────┬───────┘    │
│  └──────────┘                      │            │
│                              datasource         │
│                                    │            │
│                              ┌─────▼────────┐   │
│                              │   Grafana    │   │
│                              │   :3001      │   │
│                              └──────────────┘   │
└─────────────────────────────────────────────────┘
```

**Prometheus setup:**
- [ ] Prometheus container in docker-compose (opt-in)
- [ ] Auto-generated `prometheus.yml` scrape config targeting app's `/actuator/prometheus`
- [ ] Multi-target scraping (all services that expose metrics)
- [ ] Retention config (default 15d for local dev)
- [ ] Port: 9090

**Grafana setup:**
- [ ] Grafana container with Prometheus datasource pre-configured
- [ ] Pre-built dashboards (auto-provisioned via `/etc/grafana/provisioning/`):
  - Service Overview — request rate, error rate, response time (p50/p95/p99)
  - JVM Metrics — heap usage, GC pauses, thread count
  - Infrastructure — container CPU, memory, network I/O
  - Kafka — consumer lag, throughput, partition status
- [ ] Anonymous access enabled (no login for local dev)
- [ ] Port: 3001

**CLI integration:**
- [ ] `blissful-infra start --monitoring prometheus` — includes Prometheus + Grafana in docker-compose
- [ ] `blissful-infra dashboard` — opens Grafana (port 3001) when monitoring=prometheus, otherwise opens custom dashboard
- [ ] Console output shows Prometheus and Grafana URLs on startup

**Agent integration (Phase 7):**
- [ ] `query_prometheus` read tool for watchdog agent — run PromQL queries to detect anomalies
- [ ] Watchdog can query error rate spikes, latency regressions, resource exhaustion via PromQL
- [ ] Grafana alert rules as an additional trigger source for watchdog notifications

**Location:** `packages/cli/templates/prometheus/`, `packages/cli/templates/grafana/`

### Phase 3 Definition of Done
```
$ blissful-infra dashboard
Opening http://localhost:3000...

# Dashboard shows:
# - Service health status (all services green)
# - Time series charts for CPU, memory, request rate, response time
# - Configurable time windows (1m to 24h)
# - Real-time log viewer with search
# - Agent chat with markdown-formatted responses
```

---

## Phase 4: Resilience

**Goal:** Validate service behavior under failure conditions with performance and chaos testing.

### 4.1 Performance Testing ✅
- [x] k6 test scripts in template (staged VU ramp-up, weighted endpoints, custom metrics)
- [x] `blissful-infra perf --env <env>` command with --duration, --vus, --base-url, --script, --json options
- [x] Baseline thresholds (p95 < 500ms, p99 < 1000ms, error rate < 1%, avg < 200ms)
- [x] Results output (CLI table + JSON export + saved to .blissful-infra/perf/)
- [ ] Integration with pipeline (fail on regression)

### 4.2 Chaos Engineering Setup ✅
- [x] Docker-based chaos experiments (no Chaos Mesh required for local)
- [x] CLI integration: `blissful-infra chaos` command
- [x] Experiment templates per failure type (5 scenarios)
- [x] Dry-run mode for safe preview

**Location:** `packages/cli/src/utils/chaos.ts`, `packages/cli/src/commands/chaos.ts`

### 4.3 Failure Scenarios ✅
- [x] `pod-kill` - container termination with recovery measurement
- [x] `network-latency` - inject latency via tc (low/medium/high intensity)
- [x] `kafka-down` - Kafka unavailability with graceful degradation check
- [x] `db-latency` - database slowdown injection
- [x] `memory-pressure` - memory stress via stress-ng
- [ ] Custom scenario support (plugin system)

### 4.4 FMEA Framework ✅
- [x] Health check before each chaos experiment
- [x] Automated validation during chaos (request monitoring, error rate tracking)
- [x] Recovery verification after chaos (endpoint health + timing)
- [x] Resilience score calculation (25 points per scenario, recovery time bonus)
- [x] `blissful-infra chaos --env <env>` command (runs all scenarios)
- [x] `blissful-infra chaos --env <env> --scenario <s>` for specific tests
- [x] Recommendations engine for failed scenarios
- [x] JSON report export saved to `.blissful-infra/chaos/`

### 4.5 Resilience Scorecard ✅
- [x] Score calculation based on FMEA results (25 points per scenario + recovery bonus)
- [x] Gap identification (missing circuit breakers, dependency isolation, recovery speed)
- [x] Recommendations for improvement (per-scenario and recovery time)
- [x] Score tracking over time (last 50 entries, trend detection)
- [x] `blissful-infra chaos --scorecard` command with strengths, gaps, and history

**Location:** `packages/cli/src/utils/scorecard.ts`

### 4.6 Parallel Version Comparison ✅
- [x] Build and test each version sequentially (git checkout + docker compose)
- [x] Run identical load tests against both (k6 or curl fallback)
- [x] Collect and compare metrics (p95, p99, throughput, error rate, avg latency)
- [x] `blissful-infra compare --old <ref> --new <ref>` command
- [x] Winner determination with weighted confidence scoring
- [x] Results saved to `.blissful-infra/compare/`

**Location:** `packages/cli/src/commands/compare.ts`

### 4.7 Canary Deployments (Argo Rollouts)
**Goal:** Progressive delivery with automated analysis and rollback.

**Framework:** [Argo Rollouts](https://argoproj.github.io/argo-rollouts/) - Kubernetes controller for progressive delivery strategies.

#### 4.7.1 Argo Rollouts Setup ✅
- [x] Argo Rollouts controller installation (Helm chart with values.yaml)
- [x] Prometheus integration for metrics analysis
- [x] Dashboard plugin for Argo CD

**Location:** `packages/cli/templates/cluster/argo-rollouts/`

#### 4.7.2 Rollout Template (replaces Deployment) ✅
- [x] Rollout CRD with canary strategy
- [x] Configurable traffic steps (10% → 25% → 50% → 100%)
- [x] Pause duration between steps (2m, 2m, 5m)
- [x] Anti-affinity for canary/stable pods

**Location:** `packages/cli/templates/spring-boot/k8s/base/rollout.yaml`

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
spec:
  strategy:
    canary:
      steps:
        - setWeight: 10
        - pause: { duration: 2m }
        - analysis:
            templates:
              - templateName: {{PROJECT_NAME}}-analysis
        - setWeight: 25
        - pause: { duration: 2m }
        - setWeight: 50
        - pause: { duration: 5m }
        - setWeight: 100
```

#### 4.7.3 Analysis Templates ✅
- [x] AnalysisTemplate CRD for metric queries (error-rate, p95, p99, success-rate)
- [x] Prometheus metric providers
- [x] Configurable success criteria (thresholds)
- [x] Multiple metric support (error rate, latency, custom)

**Location:** `packages/cli/templates/spring-boot/k8s/base/analysis-template.yaml`

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
spec:
  metrics:
    - name: error-rate
      provider:
        prometheus:
          address: http://prometheus:9090
          query: |
            sum(rate(http_requests_total{status=~"5.*",app="{{PROJECT_NAME}}"}[5m]))
            / sum(rate(http_requests_total{app="{{PROJECT_NAME}}"}[5m])) * 100
      successCondition: result[0] < 1
      failureLimit: 3
    - name: p95-latency
      provider:
        prometheus:
          query: |
            histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{app="{{PROJECT_NAME}}"}[5m])) by (le))
      successCondition: result[0] < 0.2
```

#### 4.7.4 Configuration Schema ✅
- [x] Canary configuration in `blissful-infra.yaml` (CanaryConfig interface)
- [x] Metric thresholds (error rate, latency percentiles)
- [x] Traffic steps customization
- [x] Analysis interval and failure limits

**Configuration example:**
```yaml
# blissful-infra.yaml
canary:
  enabled: true
  steps:
    - weight: 10
      pause: 2m
    - weight: 25
      pause: 2m
    - weight: 50
      pause: 5m
    - weight: 100

  analysis:
    interval: 30s
    failureLimit: 3
    metrics:
      - name: error-rate
        threshold: "< 1%"          # Less than 1% error rate
        query: custom              # Or use built-in
      - name: p95-latency
        threshold: "< 200ms"       # p95 under 200ms
      - name: p99-latency
        threshold: "< 500ms"
      - name: success-rate
        threshold: "> 99%"
```

#### 4.7.5 CLI Commands ✅
- [x] `blissful-infra deploy --canary` - Deploy with canary strategy
- [x] `blissful-infra canary status` - Show rollout progress
- [x] `blissful-infra canary promote` - Skip analysis, promote immediately (+ --full)
- [x] `blissful-infra canary abort` - Abort and rollback
- [x] `blissful-infra canary pause` - Pause rollout
- [x] `blissful-infra canary resume` - Resume paused rollout

**Location:** `packages/cli/src/commands/canary.ts`, `packages/cli/src/utils/rollouts.ts`

#### 4.7.6 Rollback Testing Mode ✅
- [x] `blissful-infra canary test --simulate-failure` - Test auto-rollback
- [x] `blissful-infra canary test --full-drill` - Full rollback drill with timing
- [x] Verify rollback completes successfully
- [x] Report on rollback timing and SLO compliance

**Test scenarios:**
```bash
# Test 1: Simulate high error rate
blissful-infra canary test --simulate-failure error-rate --value 5%

# Test 2: Simulate high latency
blissful-infra canary test --simulate-failure p95-latency --value 500ms

# Test 3: Full rollback drill
blissful-infra canary test --full-drill
# Deploys canary → injects failure → verifies rollback → reports timing
```

#### 4.7.7 Dashboard Integration
- [ ] Rollout progress visualization (deferred to Phase 6)
- [ ] Analysis results display
- [ ] Promote/Abort buttons
- [ ] Rollback history

#### Canary Files Summary

| Action | File Path |
|--------|-----------|
| CREATE | `packages/cli/templates/cluster/argo-rollouts/values.yaml` |
| CREATE | `packages/cli/templates/spring-boot/k8s/base/rollout.yaml` |
| CREATE | `packages/cli/templates/spring-boot/k8s/base/analysis-template.yaml` |
| CREATE | `packages/cli/src/commands/canary.ts` |
| CREATE | `packages/cli/src/utils/rollouts.ts` |
| MODIFY | `packages/cli/src/utils/config.ts` (add canary config interface) |
| MODIFY | `packages/cli/src/commands/deploy.ts` (add --canary flag) |
| MODIFY | `packages/cli/src/index.ts` (register canary command) |
| MODIFY | `packages/dashboard/src/components/CanaryStatus.tsx` |

### Phase 4 Definition of Done
```
$ blissful-infra perf --env staging

Running k6 load test...

Results:
  Requests:    12,847
  Duration:    60s
  RPS:         214
  p95 Latency: 145ms
  Error Rate:  0.02%

✓ All thresholds passed

$ blissful-infra chaos --env staging

Running FMEA scenarios...

Scenario         Result  Recovery
--------         ------  --------
pod-kill         ✓ Pass  8s
network-latency  ✓ Pass  12s
kafka-down       ✗ Fail  N/A
db-latency       ✓ Pass  15s

Resilience Score: 75/100

❌ kafka-down: No fallback when Kafka unavailable
   Suggestion: Add circuit breaker for event publishing

$ blissful-infra compare --old main~1 --new main

Deploying both versions...
Running load tests...

Metric       Old     New     Winner
------       ---     ---     ------
p95 Latency  180ms   120ms   ✓ New
Throughput   1200/s  1350/s  ✓ New
Error Rate   0.1%    0.05%   ✓ New

Recommendation: Promote new version

# Canary Deployment
$ blissful-infra deploy --canary --env production

Starting canary deployment...
✓ Canary pods deployed (10% traffic)
⏳ Running analysis (2m pause)...

Analysis Results:
  error-rate:   0.3% (threshold: < 1%)    ✓ Pass
  p95-latency:  145ms (threshold: < 200ms) ✓ Pass

✓ Step 1 passed, promoting to 25%...
⏳ Running analysis (2m pause)...
✓ Step 2 passed, promoting to 50%...
⏳ Running analysis (5m pause)...
✓ Step 3 passed, promoting to 100%...

✅ Canary deployment complete!

$ blissful-infra canary status

Rollout: my-service
Status:  Progressing
Weight:  50% canary / 50% stable

Step     Weight  Status    Analysis
----     ------  ------    --------
1        10%     Complete  ✓ Passed
2        25%     Complete  ✓ Passed
3        50%     Running   ⏳ In Progress
4        100%    Pending   -

Current Analysis:
  error-rate:   0.2%   ✓ Pass (< 1%)
  p95-latency:  132ms  ✓ Pass (< 200ms)
  p99-latency:  198ms  ✓ Pass (< 500ms)

# Test rollback functionality
$ blissful-infra canary test --simulate-failure error-rate --value 5%

Testing canary rollback...
✓ Deployed canary (10% traffic)
⚡ Injecting failure: error-rate = 5%
⏳ Waiting for analysis...

Analysis detected failure:
  error-rate: 5.2% (threshold: < 1%) ✗ FAIL

🔄 Automatic rollback triggered...
✓ Traffic shifted to stable (100%)
✓ Canary pods terminated
✓ Rollback completed in 12s

Test Result: PASSED
  - Analysis correctly detected failure
  - Rollback triggered automatically
  - Service recovered within SLO (< 30s)
```

---

## Phase 5: Intelligence

**Goal:** Agent learns from incidents and provides actionable insights.

### 5.1 Knowledge Base ✅
- [x] JSON file storage for incidents, patterns, fixes (upgradeable to SQLite)
- [x] Jaccard similarity search for finding similar incidents
- [x] 8 built-in patterns (OOM, connection refused, slow queries, deploy failure, high errors, Kafka lag, cert expiry, disk pressure)
- [x] Incident recording with auto pattern matching
- [x] Pattern extraction and normalization

**Location:** `packages/cli/src/utils/knowledge-base.ts`

### 5.2 Enhanced Data Collectors ✅
- [x] Docker logs collector (with error extraction)
- [x] Container metrics collector (CPU, memory, network)
- [x] Git context collector (commits, diffs)
- [x] Kubernetes collector (events, pod status)
- [x] Chaos results collector (from .blissful-infra/chaos/)
- [x] Performance results collector (from .blissful-infra/perf/)
- [x] Full context aggregation with parallel collection

**Location:** `packages/cli/src/utils/collectors.ts`

### 5.3 Root Cause Analysis ✅
- [x] Timeline construction from multiple sources (logs, git, metrics)
- [x] Correlation with code changes (error timing vs commit timing)
- [x] Confidence scoring (pattern match + correlation + similarity)
- [x] Similar incident retrieval (Jaccard similarity)
- [x] `blissful-infra analyze` command with formatted output
- [x] `blissful-infra analyze --incident <id>` for deep dive
- [x] Issue detection from logs, metrics, and container state

**Location:** `packages/cli/src/utils/analyzer.ts`, `packages/cli/src/commands/analyze.ts`

### 5.4 Fix Generation ✅
- [x] Fix suggestions from matched patterns (with confidence scoring)
- [x] Fix suggestions from similar resolved incidents
- [x] Fix outcome tracking (resolved/partial/failed)
- [x] Success rate by pattern type (auto-updated)
- [ ] Auto-PR creation (deferred)

### 5.5 Proactive Suggestions ✅
- [x] Pattern-based recommendations
- [x] Gap analysis against best practices
- [x] `blissful-infra suggest` command
- [x] Priority ranking (high/medium/low based on confidence)
- [x] Open incident summary and knowledge base stats
- [ ] Daily suggestion generation (deferred - requires cron/scheduler)

### 5.6 Learning Loop ✅
- [x] Track fix outcomes (resolved/partial/failed)
- [x] Update pattern success rates based on fix outcomes
- [x] Pattern occurrence counting and last-seen tracking
- [x] Similar incident matching improves with more data
- [ ] Auto-fix for high-confidence patterns (deferred - requires approval workflow)

### Phase 5 Definition of Done
```
$ blissful-infra analyze

Analyzing recent deployment failure...

📊 Correlating data sources:
  ✓ Git commits (3 commits in range)
  ✓ Jenkins build logs
  ✓ Prometheus metrics
  ✓ Application logs (2,847 entries)
  ✓ Kubernetes events

🔍 Root Cause Analysis:

FINDING: OOMKilled after deploy
CONFIDENCE: 94%

Timeline:
  14:32:01 - Deploy started (commit abc123)
  14:32:45 - New pods scheduled
  14:33:12 - Memory spike (450MB → 1.2GB)
  14:33:18 - OOMKilled

Root Cause:
  Unbounded cache in GreetingService.kt:47

Similar Incidents: 2 found (92% similarity)
  Both resolved by adding cache bounds

Suggested Fix:
  [AUTO-FIX AVAILABLE] Add bounded cache

Apply fix and create PR? [y/N] y

Created PR #142: fix/bounded-greeting-cache
```

---

## Phase 6: Scale

**Goal:** Support more languages, deployment targets, and team workflows.

### 6.1 Additional Templates
- [ ] FastAPI (Python)
- [ ] Express (Node.js + TypeScript)
- [ ] Go Chi
- [ ] React + Vite frontend
- [ ] Fullstack monorepo

### 6.2 Cloud Deployment
- [ ] EKS support
- [ ] GKE support
- [ ] AKS support
- [ ] Cloud-specific configurations
- [ ] Cost estimation

### 6.3 Dashboard v2
- [ ] Pipeline visualization
- [ ] Agent chat interface
- [ ] Incident timeline view
- [ ] Comparison test results
- [ ] Resilience scorecard visualization
- [ ] Suggestion feed

### 6.4 Team Features
- [ ] Multi-user support
- [ ] Shared knowledge base (PostgreSQL option)
- [ ] Audit logging
- [ ] Notification integrations (Slack, Teams)
- [ ] Ticket system integration (Jira, Linear, GitHub Issues)

### 6.5 Template Ecosystem
- [ ] Template versioning
- [ ] Upgrade path for existing projects
- [ ] Custom template support
- [ ] Template marketplace/registry

### 6.6 Enterprise Infrastructure Components
**Goal:** Additional enterprise patterns for comprehensive local simulation.

#### 6.6.1 Service Mesh (Istio/Linkerd)
- [ ] Istio installation template for Kind cluster
- [ ] mTLS between services (automatic encryption)
- [ ] Traffic policies (rate limiting, retries, timeouts)
- [ ] Service-to-service authorization
- [ ] Kiali dashboard for visualization

**Location:** `packages/cli/templates/cluster/istio/`

#### 6.6.2 Secrets Management (Vault)
- [ ] HashiCorp Vault deployment (dev mode)
- [ ] Kubernetes auth method
- [ ] External Secrets Operator integration
- [ ] Secret rotation patterns
- [ ] `blissful-infra secrets` command

**Location:** `packages/cli/templates/cluster/vault/`

#### 6.6.3 Distributed Tracing (Jaeger)
- [x] Jaeger all-in-one deployment
- [x] OpenTelemetry SDK in templates
- [ ] Trace correlation in dashboard
- [ ] Span analysis in agent

**Location:** `packages/cli/templates/cluster/jaeger/`

#### 6.6.4 API Gateway (Kong/Traefik)
- [ ] Ingress controller setup
- [ ] Rate limiting configuration
- [ ] Authentication middleware
- [ ] API versioning patterns

#### 6.6.5 Network Policies
- [ ] Default deny policies
- [ ] Service-specific allow rules
- [ ] Namespace isolation
- [ ] Policy templates per service type

#### 6.6.6 Certificate Management
- [ ] cert-manager installation
- [ ] Self-signed CA for local development
- [ ] TLS ingress configuration
- [ ] Certificate rotation

#### Enterprise Components Summary

| Component | Tool | Purpose | Complexity |
|-----------|------|---------|------------|
| Service Mesh | Istio | mTLS, traffic management | High |
| Secrets | Vault | Credential management | Medium |
| Tracing | Jaeger | Distributed tracing | Low |
| Gateway | Traefik | Ingress, rate limiting | Medium |
| Network Policies | K8s native | Pod isolation | Low |
| Certificates | cert-manager | TLS management | Medium |

**Note:** These components are optional and add significant resource requirements. Enable selectively based on learning goals.

### 6.7 Plugin SDK (Third-Party Extensibility)

**Goal:** Any developer can publish a `blissful-infra-plugin-*` npm package and users can install it with one command. The CLI treats it identically to a built-in plugin.

#### Strategy

Today's plugins (`ai-pipeline`, `agent-service`) are hard-coded: recognized by name in `start.ts`, templates live inside the CLI package, and docker-compose contributions are written inline. This blocks third parties from extending the platform.

The plugin SDK decouples plugin logic from the CLI by introducing a `plugin.json` manifest contract — inspired by how Nx handles generators/executors and how Garden handles providers. The CLI becomes a loader that knows nothing about specific plugin behaviour; it only reads the manifest.

**What other tools do:**

| Tool | Pattern |
|------|---------|
| Nx | `blissful-infra-plugin-*` npm packages exporting generators and executors |
| Garden | npm packages implementing a typed provider interface, resolved and executed at runtime |
| Tilt | Git-hosted Starlark files, loaded by URL — no install step |
| Backstage | npm packages exporting React components + API routers, registered in app config |

For blissful-infra, the **npm package pattern** is the right fit: Node-based CLI, existing npm distribution, plugin authors already know npm.

#### The Plugin Contract

A plugin is an npm package named `blissful-infra-plugin-<name>` containing:

```
blissful-infra-plugin-redis-cache/
├── plugin.json          ← manifest: ports, service definition, health endpoints
├── template/            ← scaffolded into the project directory on install
│   ├── Dockerfile
│   └── src/
└── index.js             ← optional: additional CLI command contributions
```

```json
// plugin.json
{
  "name": "redis-cache",
  "version": "1.0.0",
  "description": "Redis caching layer with cache warming API",
  "port": 8091,
  "template": "./template",
  "healthPath": "/health",
  "service": {
    "environment": {
      "CACHE_TTL": "3600"
    },
    "depends_on": ["redis", "kafka"]
  }
}
```

The CLI reads `plugin.json` at runtime — no hard-coded knowledge of the plugin is needed in the core CLI.

#### Plugin Resolution Order

1. `~/.blissful-infra/plugins/<name>/` — locally installed plugins
2. Globally installed npm packages matching `blissful-infra-plugin-<name>`
3. Built-in plugins bundled with the CLI (`ai-pipeline`, `agent-service`)

#### Dashboard Integration

Rather than loading external React components (complex, fragile), plugins that expose a `/health` and `/status` endpoint automatically get a **generic plugin card** in the dashboard — service name, health status, port, and a link to the plugin's own UI if it serves one. Richer dashboard integration requires the plugin to serve its own frontend on its port.

#### Implementation Plan

##### 6.7.1 Plugin Manifest Schema
- [ ] Define `PluginManifest` TypeScript interface (name, version, port, template, service, healthPath)
- [ ] JSON schema validation on manifest load
- [ ] Error messages for malformed manifests
- [ ] Versioning strategy (semver, compatibility range with CLI version)

**Location:** `packages/cli/src/utils/plugin-manifest.ts`

##### 6.7.2 Plugin Resolver
- [ ] `resolvePlugin(name)` — searches local dir → global npm → built-ins
- [ ] `loadManifest(pluginDir)` — reads and validates `plugin.json`
- [ ] `getPluginTemplate(manifest)` — returns path to template directory
- [ ] `getServiceDefinition(manifest, projectName, port)` — generates docker-compose service block from manifest

**Location:** `packages/cli/src/utils/plugin-resolver.ts`

##### 6.7.3 `blissful-infra plugin` Command
- [ ] `plugin install <name>` — install from npm or local path (`npm install -g blissful-infra-plugin-<name>`)
- [ ] `plugin list` — list installed plugins with versions
- [ ] `plugin remove <name>` — uninstall a plugin
- [ ] `plugin info <name>` — show plugin manifest details

**Location:** `packages/cli/src/commands/plugin.ts`

##### 6.7.4 Dynamic Docker-Compose Generation
- [ ] Replace hard-coded `ai-pipeline` / `agent-service` blocks in `start.ts` and `up.ts` with manifest-driven generation
- [ ] `generatePluginService(manifest, projectName, port)` — replaces inline service objects
- [ ] Template variable substitution applied to plugin templates via existing `copyTemplate`
- [ ] Port allocation: plugins assigned ports sequentially starting at 8090

**Location:** `packages/cli/src/commands/start.ts`, `packages/cli/src/commands/up.ts`

##### 6.7.5 Built-In Plugin Migration
- [ ] Convert `ai-pipeline` template to include a `plugin.json` manifest
- [ ] Convert `agent-service` template to include a `plugin.json` manifest
- [ ] Both continue to work via the built-in fallback in the resolver (no breaking change)
- [ ] Verify existing `--plugins ai-pipeline` still works after refactor

##### 6.7.6 Dashboard Generic Plugin Panel
- [ ] Health check polling extended to read registered plugins from config
- [ ] Any plugin with a `healthPath` gets a health status card automatically
- [ ] Plugin name, port, version, and health status displayed
- [ ] "Open UI" link if plugin serves a frontend

**Location:** `packages/cli/src/server/api.ts`, `packages/dashboard/src/App.tsx`

##### 6.7.7 SDK Documentation
- [ ] `docs/plugin-sdk.md` — Plugin author guide covering: manifest spec, template variables, service definition, publishing to npm
- [ ] Example plugin: `blissful-infra-plugin-example` (minimal working plugin for reference)
- [ ] Update README Plugins section with SDK link

#### Plugin Author Workflow

```bash
# Create a new plugin
mkdir blissful-infra-plugin-my-service
cd blissful-infra-plugin-my-service
# Write plugin.json + template/ directory
npm publish

# User installs and uses it
blissful-infra plugin install my-service
blissful-infra start my-app --plugins my-service
```

#### 6.8 AI Data Platform Stack

**Goal:** When the `ai-pipeline` plugin is enabled, automatically provision a production-grade AI/ML data stack alongside it — columnar storage, experiment tracking, and a visual pipeline orchestrator. Zero extra flags required.

**Tools included:**

| Tool | Role | Port | Open Source Alternative to |
|------|------|------|---------------------------|
| **ClickHouse** | Columnar OLAP store for predictions + events at scale | 8123 | Snowflake, BigQuery |
| **MLflow** | Experiment tracking + model registry + metrics | 5001 | SageMaker Experiments, W&B |
| **Mage** | Visual data pipeline IDE (Python/SQL, scheduling) | 6789 | Palantir Foundry, Airflow |

**What gets deployed (automatically with `--plugins ai-pipeline`):**

```
┌─────────────────────────────────────────────────────────┐
│                     Docker Compose                       │
│                                                          │
│  ┌───────────┐  Kafka events  ┌──────────────────────┐  │
│  │   Kafka   │───────────────►│   AI Pipeline        │  │
│  │  :9092    │                │   (FastAPI + Spark)  │  │
│  └───────────┘                │   :8090              │  │
│                               └──────┬───────────────┘  │
│                                      │                  │
│                      ┌───────────────┼───────────────┐  │
│                      ▼               ▼               ▼  │
│               ┌──────────┐  ┌──────────────┐  ┌───────┐ │
│               │ClickHouse│  │    MLflow    │  │ Mage  │ │
│               │ :8123    │  │    :5001     │  │ :6789 │ │
│               │ (store   │  │ (track       │  │(orch- │ │
│               │  preds)  │  │  experiments)│  │estra- │ │
│               └──────────┘  └──────────────┘  │ tion) │ │
│                                               └───────┘ │
└─────────────────────────────────────────────────────────┘
```

**ClickHouse setup:**
- [ ] ClickHouse container in docker-compose when ai-pipeline plugin present
- [ ] `predictions` table auto-created on startup (timestamp, event_id, name, category, confidence, sentiment)
- [ ] MergeTree engine with timestamp + event_id ordering for fast time-range queries
- [ ] `clickhouse_utils.py` helper in ai-pipeline template: `init_predictions_table()`, `store_prediction()`
- [ ] Port: 8123 (HTTP API)

**MLflow setup:**
- [ ] MLflow tracking server in docker-compose alongside ai-pipeline
- [ ] SQLite backend store (zero external dependencies)
- [ ] `mlflow_utils.py` helper: `setup_mlflow()`, `log_model_training()`
- [ ] Classifier training stats logged as MLflow run on startup (n_samples, n_classes, algorithm)
- [ ] Port: 5001

**Mage setup:**
- [ ] Mage orchestration container in docker-compose
- [ ] Persistent volume for pipeline definitions
- [ ] Pre-configured with project directory via env var
- [ ] Access Mage UI to build Kafka → ClickHouse pipelines visually
- [ ] Port: 6789

**ai-pipeline template integration:**
- [ ] `config.py` — add `MLFLOW_TRACKING_URI`, `MLFLOW_EXPERIMENT`, `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`, `CLICKHOUSE_DB` env vars
- [ ] `requirements.txt` — add `mlflow-skinny`, `clickhouse-connect`
- [ ] `app/mlflow_utils.py` — MLflow tracking helpers (best-effort, non-blocking)
- [ ] `app/clickhouse_utils.py` — ClickHouse storage helpers (best-effort, non-blocking)
- [ ] `app/main.py` — initialize data platform connections on startup, store predictions to ClickHouse, log training to MLflow
- [ ] `app/model/classifier.py` — `get_training_metadata()` returns stats for MLflow logging

**Port allocation:**
- [ ] `ports.ts` — check ClickHouse (8123), MLflow (5001), Mage (6789) when ai-pipeline plugin present

**Console output:**
```
  ✓ AI Pipeline:   http://localhost:8090
  ✓ ClickHouse:    http://localhost:8123
  ✓ MLflow:        http://localhost:5001
  ✓ Mage:          http://localhost:6789
```

#### Phase 6.8 Definition of Done
```
$ blissful-infra start my-app --plugins ai-pipeline
✓ AI Pipeline running on http://localhost:8090
✓ ClickHouse ready at http://localhost:8123
✓ MLflow UI at http://localhost:5001
✓ Mage pipelines at http://localhost:6789

# MLflow shows experiment "my-app-pipeline" with model training run
# ClickHouse has predictions table, rows added on each /predict call
# Mage UI lets you build visual Kafka → ClickHouse pipelines
```

### Phase 6.7 Definition of Done
```
# Plugin author publishes a plugin
$ npm publish blissful-infra-plugin-redis-cache

# User installs and uses it
$ blissful-infra plugin install redis-cache
✓ Installed blissful-infra-plugin-redis-cache@1.0.0

$ blissful-infra start my-app --plugins redis-cache
✓ Copied redis-cache template → my-app/redis-cache/
✓ Added redis-cache service to docker-compose.yaml (port 8091)
✓ my-app-redis-cache running on http://localhost:8091

$ blissful-infra plugin list
PLUGIN          VERSION   SOURCE    PORT
ai-pipeline     built-in  built-in  8090
redis-cache     1.0.0     npm       8091

# Dashboard shows redis-cache health card automatically
# (no dashboard code changes required for new plugins)
```

**Success metrics for 6.7:**
- [ ] Third-party plugin installable and usable end-to-end without changes to the CLI codebase
- [ ] Built-in `ai-pipeline` migrated to manifest-driven loading (no regression)
- [ ] `plugin install` / `plugin list` / `plugin remove` all working
- [ ] Generic dashboard health card appears for any plugin with a `healthPath`
- [ ] SDK doc covers everything a plugin author needs to publish a working plugin

---

### 6.9 KubeAI Integration

**Goal:** Add KubeAI as a Kubernetes-native AI inference layer — run open-weight LLMs (Llama, Mistral, Gemma) locally on a Kind cluster with an OpenAI-compatible API, so the `agent-service` plugin can target local models instead of the Anthropic API.

#### Why KubeAI

KubeAI is a Kubernetes operator that manages model servers as first-class resources. It exposes an OpenAI-compatible endpoint (`/v1/chat/completions`, `/v1/completions`) so no code changes are needed in existing agent services — just swap `AI_MODEL` and `OPENAI_BASE_URL` env vars. Fits directly into the Phase 6 cloud deployment story since the same manifests work on EKS/GKE/AKS.

#### What Gets Added

**CLI flag:**
```
blissful-infra start my-app --plugins agent-service --ai-runtime kubeai
```
Gated on `deploy_target` being `kind` or higher (not `local-only`) since KubeAI requires a running K8s cluster.

**Cluster template (`packages/cli/templates/cluster/kubeai/`):**
- `operator.yaml` — KubeAI operator install (Helm or kustomize)
- `models/llama3.yaml` — `Model` CR for Llama 3.2 3B (small enough for dev machines)
- `models/mistral.yaml` — `Model` CR for Mistral 7B
- `gateway.yaml` — Service + Ingress exposing `/v1` on port 8080

**Agent service env patch:**
When `--ai-runtime kubeai`, override agent service env:
```
AI_PROVIDER: openai-compatible
OPENAI_BASE_URL: http://kubeai/openai/v1
AI_MODEL: llama-3.2-3b
```

**New CLI command:**
```
blissful-infra models list        # list available Model CRs and their status
blissful-infra models pull <name> # pre-pull a model (starts the model pod)
blissful-infra models status      # show inference pod health + GPU/CPU mode
```

**Dashboard integration:**
- New "Models" card in the AI section showing model name, backend (CPU/GPU), ready status, and requests/sec from Prometheus scrape

#### Locations

| Action | Path |
|--------|------|
| CREATE | `packages/cli/templates/cluster/kubeai/operator.yaml` |
| CREATE | `packages/cli/templates/cluster/kubeai/models/llama3.yaml` |
| CREATE | `packages/cli/templates/cluster/kubeai/models/mistral.yaml` |
| CREATE | `packages/cli/templates/cluster/kubeai/gateway.yaml` |
| CREATE | `packages/cli/src/commands/models.ts` |
| MODIFY | `packages/cli/src/commands/start.ts` — `--ai-runtime` flag + env patch |
| MODIFY | `packages/cli/src/utils/ports.ts` — port 8080 for KubeAI gateway |

#### Phase 6.9 Definition of Done
```
# Start a project with KubeAI inference
$ blissful-infra start my-app --plugins agent-service --ai-runtime kubeai
✓ KubeAI operator installed on Kind cluster
✓ Model llama-3.2-3b pulled and ready
✓ Agent service targeting http://kubeai/openai/v1

# List available models
$ blissful-infra models list
NAME              BACKEND   STATUS   READY
llama-3.2-3b      CPU       Running  ✓
mistral-7b        CPU       Pending  …

# Agent service responds using local LLM — no Anthropic key required
$ curl http://localhost:8095/chat -d '{"message": "hello"}'
{"reply": "Hi! I'm running on Llama 3.2 locally via KubeAI."}
```

**Success metrics:**
- [ ] KubeAI operator installs cleanly on Kind cluster
- [ ] `Model` CR for Llama 3.2 3B reaches `Ready` state on a dev machine (CPU mode)
- [ ] Agent service hits `/v1/chat/completions` on KubeAI gateway with no code changes
- [ ] `blissful-infra models list` shows model status
- [ ] Dashboard shows Models card with ready/pending state
- [ ] Existing `--ai-runtime anthropic` (default) unaffected

---

### 6.10 Spring Boot Template Enhancements
**Goal:** Harden the Kotlin/Spring Boot template with real-world resilience and HTTP client patterns.

#### 6.10.1 Resilience4j Patterns
Wrap external calls (Kafka publish, DB writes, downstream HTTP) with Resilience4j decorators so the template demonstrates production-grade fault tolerance out of the box.

- [ ] Add `resilience4j-spring-boot3` dependency to `build.gradle.kts`
- [ ] Circuit breaker on `EventPublisher.publish()` (Kafka producer)
- [ ] Retry with exponential backoff on DB writes (JPA repository calls)
- [ ] Rate limiter on `GET /hello` to demonstrate throttling
- [ ] Bulkhead on downstream HTTP calls (thread pool isolation)
- [ ] Expose Resilience4j metrics via Actuator → Prometheus → Grafana
- [ ] Add `application.yaml` config block for all Resilience4j instances

**Reference:** https://resilience4j.readme.io/docs/getting-started

**Files:**
| Action | File |
|--------|------|
| MODIFY | `packages/cli/templates/spring-boot/build.gradle.kts` — add `resilience4j-spring-boot3` |
| MODIFY | `packages/cli/templates/spring-boot/src/main/kotlin/com/blissful/event/EventPublisher.kt` — `@CircuitBreaker` + `@Retry` |
| MODIFY | `packages/cli/templates/spring-boot/src/main/kotlin/com/blissful/controller/HelloController.kt` — `@RateLimiter` |
| MODIFY | `packages/cli/templates/spring-boot/src/main/resources/application.yaml` — Resilience4j instance config |

#### 6.10.2 WebClient (Spring WebFlux) with Example External Call
Replace `RestTemplate` (deprecated) with reactive `WebClient` and wire in a real call to a free public REST API to demonstrate non-blocking HTTP, error handling, and OTEL trace propagation.

- [ ] Add `spring-boot-starter-webflux` dependency to `build.gradle.kts`
- [ ] Create `WebClientConfig.kt` — define a `WebClient` bean with base URL + timeout
- [ ] Create `ExternalApiService.kt` — call a free public API (e.g. `https://catfact.ninja/fact`) returning a `Mono<T>`
- [ ] Add `GET /external` endpoint in `HelloController` that calls `ExternalApiService`
- [ ] Wrap `WebClient` call with Resilience4j `@CircuitBreaker` (ties 6.10.1 + 6.10.2 together)
- [ ] OTEL Java agent automatically propagates trace context through `WebClient` — verify in Jaeger

**Reference:** https://docs.spring.io/spring-framework/reference/web/webflux-webclient/client-retrieve.html

**Files:**
| Action | File |
|--------|------|
| MODIFY | `packages/cli/templates/spring-boot/build.gradle.kts` — add `spring-boot-starter-webflux` |
| CREATE | `packages/cli/templates/spring-boot/src/main/kotlin/com/blissful/config/WebClientConfig.kt` |
| CREATE | `packages/cli/templates/spring-boot/src/main/kotlin/com/blissful/service/ExternalApiService.kt` |
| MODIFY | `packages/cli/templates/spring-boot/src/main/kotlin/com/blissful/controller/HelloController.kt` — add `GET /external` |

#### 6.10.3 Flyway Database Migrations
Replace `spring.jpa.hibernate.ddl-auto=update` with version-controlled SQL migrations. Every schema change is a numbered script, applied automatically on startup and tracked in a `flyway_schema_history` table.

- [ ] Add `flyway-core` dependency to `build.gradle.kts`
- [ ] Create `src/main/resources/db/migration/V1__init.sql` — initial schema (greetings table)
- [ ] Set `spring.flyway.enabled=true`, `spring.jpa.hibernate.ddl-auto=validate` in `application.yaml`
- [ ] Add `V2__add_greeting_index.sql` as an example of a follow-on migration

**Files:**
| Action | File |
|--------|------|
| MODIFY | `packages/cli/templates/spring-boot/build.gradle.kts` — add `flyway-core` |
| CREATE | `packages/cli/templates/spring-boot/src/main/resources/db/migration/V1__init.sql` |
| CREATE | `packages/cli/templates/spring-boot/src/main/resources/db/migration/V2__add_greeting_index.sql` |
| MODIFY | `packages/cli/templates/spring-boot/src/main/resources/application.yaml` — flyway + ddl-auto=validate |

#### 6.10.4 Global Exception Handler + RFC 7807 Problem Details
Replace raw Spring 500 responses with a `@ControllerAdvice` that maps all exceptions to the RFC 7807 `application/problem+json` shape — a standard every API client can parse uniformly.

- [ ] Create `GlobalExceptionHandler.kt` with `@ControllerAdvice`
- [ ] Map `MethodArgumentNotValidException` → 400 with field-level error detail
- [ ] Map `NoSuchElementException` → 404
- [ ] Map `IllegalArgumentException` → 400
- [ ] Map `Exception` (catch-all) → 500 without stack trace leakage
- [ ] Use Spring 6's built-in `ProblemDetail` type (no extra library needed)
- [ ] Add `@Valid` annotations to existing controller request bodies

**Response shape:**
```json
{
  "type": "https://example.com/errors/validation-failed",
  "title": "Validation Failed",
  "status": 400,
  "detail": "name must not be blank",
  "instance": "/hello"
}
```

**Files:**
| Action | File |
|--------|------|
| CREATE | `packages/cli/templates/spring-boot/src/main/kotlin/com/blissful/exception/GlobalExceptionHandler.kt` |
| MODIFY | `packages/cli/templates/spring-boot/src/main/kotlin/com/blissful/controller/HelloController.kt` — add `@Valid` |
| MODIFY | `packages/cli/templates/spring-boot/build.gradle.kts` — confirm `spring-boot-starter-validation` present |

#### 6.10.5 Transactional Outbox Pattern
The most common way to lose events: write to the DB, then the app crashes before Kafka publish. The outbox pattern writes the event to a DB table in the **same transaction** as the business write, then a separate publisher polls and sends to Kafka. Guarantees at-least-once delivery with no dual-write risk.

```
Business logic
    │
    ├── INSERT greeting → greetings table     ┐ same
    └── INSERT event   → outbox table         ┘ transaction

Outbox Publisher (scheduled)
    │
    ├── SELECT unprocessed rows from outbox
    ├── Publish each to Kafka
    └── Mark row as processed
```

- [ ] Create `OutboxEvent` entity (`id`, `event_type`, `payload`, `processed_at`, `created_at`)
- [ ] Create `OutboxRepository` (Spring Data JPA)
- [ ] Modify `HelloController` to write greeting + outbox event in one `@Transactional` block
- [ ] Create `OutboxPublisher` — `@Scheduled(fixedDelay = 1000)` polls unprocessed rows, publishes to Kafka, marks processed
- [ ] Wire `OutboxPublisher` to existing `EventPublisher`

**Files:**
| Action | File |
|--------|------|
| CREATE | `packages/cli/templates/spring-boot/src/main/kotlin/com/blissful/entity/OutboxEvent.kt` |
| CREATE | `packages/cli/templates/spring-boot/src/main/kotlin/com/blissful/repository/OutboxRepository.kt` |
| CREATE | `packages/cli/templates/spring-boot/src/main/kotlin/com/blissful/event/OutboxPublisher.kt` |
| MODIFY | `packages/cli/templates/spring-boot/src/main/kotlin/com/blissful/controller/HelloController.kt` — `@Transactional` + outbox write |
| CREATE | `packages/cli/templates/spring-boot/src/main/resources/db/migration/V3__add_outbox_table.sql` |

#### 6.10.6 Kafka Dead Letter Queue (DLQ)
When a consumer fails to process a message after N retries, it should land in a DLQ topic for inspection — not silently drop or crash the consumer. Spring Kafka's `@RetryableTopic` handles this automatically.

- [ ] Annotate `EventConsumer` with `@RetryableTopic(attempts = 3, backoff = @Backoff(delay = 1000, multiplier = 2.0))`
- [ ] This auto-creates `greetings-retry-0`, `greetings-retry-1`, `greetings-dlt` topics
- [ ] Add `@DltHandler` method on `EventConsumer` — logs the failed message with full context
- [ ] Add DLQ message count metric via Micrometer

**Files:**
| Action | File |
|--------|------|
| MODIFY | `packages/cli/templates/spring-boot/src/main/kotlin/com/blissful/event/EventConsumer.kt` — `@RetryableTopic` + `@DltHandler` |

#### 6.10.7 Correlation ID / MDC Propagation
Every log line in a single HTTP request should share one `X-Request-ID`. Without this, tracing a request across log lines requires grepping for unrelated strings. The OTEL trace ID is already injected by the Java agent; this adds HTTP-level correlation for clients that send their own request IDs.

- [ ] Create `CorrelationFilter` — servlet filter that reads `X-Request-ID` header (or generates a UUID), stores in MDC as `requestId`, forwards as response header
- [ ] Update `logback-spring.xml` to include `requestId` in every log line's JSON output
- [ ] Register filter as a `@Bean` in `WebConfig` or via `@Component`

**Files:**
| Action | File |
|--------|------|
| CREATE | `packages/cli/templates/spring-boot/src/main/kotlin/com/blissful/filter/CorrelationFilter.kt` |
| MODIFY | `packages/cli/templates/spring-boot/src/main/resources/logback-spring.xml` — add `requestId` field |

#### 6.10.8 OpenAPI / Swagger Docs
Auto-generate interactive API docs from the existing controller code — zero annotations needed for basic coverage. `springdoc-openapi` scans `@RestController` methods and produces a spec at `/v3/api-docs` and a UI at `/swagger-ui.html`.

- [ ] Add `springdoc-openapi-starter-webmvc-ui` dependency to `build.gradle.kts`
- [ ] Add `@Operation` and `@ApiResponse` annotations to `HelloController` as examples
- [ ] Configure `springdoc.api-docs.path=/v3/api-docs` and `springdoc.swagger-ui.path=/swagger-ui.html` in `application.yaml`
- [ ] Expose `/v3/api-docs` and `/swagger-ui/**` via Spring Security (if JWT added in future)

**Files:**
| Action | File |
|--------|------|
| MODIFY | `packages/cli/templates/spring-boot/build.gradle.kts` — add `springdoc-openapi-starter-webmvc-ui` |
| MODIFY | `packages/cli/templates/spring-boot/src/main/kotlin/com/blissful/controller/HelloController.kt` — add `@Operation` examples |
| MODIFY | `packages/cli/templates/spring-boot/src/main/resources/application.yaml` — springdoc paths |

#### 6.10.9 JWT / OAuth2 Resource Server
Protect endpoints with Bearer token validation. Spring Security's OAuth2 resource server validates JWT signatures against a JWKS endpoint — no manual token parsing needed.

- [ ] Add `spring-boot-starter-security` + `spring-security-oauth2-resource-server` to `build.gradle.kts`
- [ ] Create `SecurityConfig.kt` — configure `httpSecurity.oauth2ResourceServer { jwt { } }`
- [ ] Set `spring.security.oauth2.resourceserver.jwt.jwk-set-uri` in `application.yaml` (points to local Keycloak or mock JWKS)
- [ ] Protect `POST /echo` and `GET /greetings` — leave `GET /hello` and `/health` public
- [ ] Add `@PreAuthorize("hasRole('USER')")` example on one endpoint
- [ ] Add Keycloak dev container to docker-compose (optional, gated on `--auth` flag)

**Files:**
| Action | File |
|--------|------|
| MODIFY | `packages/cli/templates/spring-boot/build.gradle.kts` — add security + oauth2 resource server |
| CREATE | `packages/cli/templates/spring-boot/src/main/kotlin/com/blissful/config/SecurityConfig.kt` |
| MODIFY | `packages/cli/templates/spring-boot/src/main/resources/application.yaml` — jwt jwk-set-uri |

#### 6.10.10 Audit Trail + Soft Deletes
Track who created/modified each record and when, without application code changes — Spring Data JPA auditing handles it automatically. Soft deletes prevent accidental data loss and support compliance requirements.

- [ ] Enable JPA auditing: `@EnableJpaAuditing` on `Application.kt`
- [ ] Add `@CreatedDate`, `@LastModifiedDate`, `@CreatedBy`, `@LastModifiedBy` fields to `Greeting` entity
- [ ] Create `AuditorAwareImpl` — returns current user from `SecurityContext` (or `"system"` fallback)
- [ ] Add `deleted_at` column to `Greeting` + `@SQLRestriction("deleted_at IS NULL")` filter
- [ ] Add `DELETE /greetings/{id}` endpoint that sets `deleted_at` instead of hard-deleting
- [ ] Flyway migration `V4__add_audit_columns.sql`

**Files:**
| Action | File |
|--------|------|
| MODIFY | `packages/cli/templates/spring-boot/src/main/kotlin/com/blissful/Application.kt` — `@EnableJpaAuditing` |
| MODIFY | `packages/cli/templates/spring-boot/src/main/kotlin/com/blissful/entity/Greeting.kt` — audit fields + `deleted_at` |
| CREATE | `packages/cli/templates/spring-boot/src/main/kotlin/com/blissful/config/AuditConfig.kt` |
| CREATE | `packages/cli/templates/spring-boot/src/main/resources/db/migration/V4__add_audit_columns.sql` |

#### Phase 6.10 Definition of Done
```
# Circuit breaker trips after Kafka is down
$ docker stop my-app-kafka
$ curl http://localhost:8080/hello
{"error": "circuit breaker open: kafka-producer"}  # not a 500, graceful fallback

# Rate limiter kicks in
$ for i in {1..20}; do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/hello; done
200 200 200 ... 429 429 429

# External API call works and shows up in Jaeger with child span
$ curl http://localhost:8080/external
{"fact": "Cats have 32 muscles in each ear."}
# Jaeger: root span GET /external → child span GET catfact.ninja/fact

# Validation error returns RFC 7807 problem details
$ curl -X POST http://localhost:8080/echo -d '{}'
{"type":"about:blank","title":"Bad Request","status":400,"detail":"data must not be null"}

# Flyway runs on startup
INFO  FlywayAutoConfiguration - Flyway migration has applied 4 migration(s) to schema "public"

# Outbox guarantees no lost events even if Kafka is briefly down
$ docker stop my-app-kafka && curl http://localhost:8080/hello && docker start my-app-kafka
# Event appears in Kafka once broker is back — not lost

# Kafka consumer fails 3 times → message lands in DLT
# greetings-dlt topic has 1 message; consumer is still healthy

# Correlation ID flows through every log line
$ curl -H "X-Request-ID: abc-123" http://localhost:8080/hello
# All log lines for this request contain: "requestId": "abc-123"

# Swagger UI available
$ open http://localhost:8080/swagger-ui.html
# Interactive docs showing all endpoints, request/response shapes

# JWT protection
$ curl http://localhost:8080/echo -d '{"data":"test"}'
HTTP/1.1 401 Unauthorized
$ curl -H "Authorization: Bearer <valid-token>" http://localhost:8080/echo -d '{"data":"test"}'
{"echo": "test"}

# Soft delete
$ curl -X DELETE http://localhost:8080/greetings/1
HTTP/1.1 204 No Content
$ curl http://localhost:8080/greetings  # deleted record not returned
$ SELECT * FROM greeting WHERE deleted_at IS NOT NULL;  # record still in DB
```

---

## Phase 7: Autonomy

**Goal:** Close the loop. Phases 1-6 gave blissful-infra eyes (observability), reflexes (resilience), and a brain (intelligence). Phase 7 gives it a voice — LangGraph-powered virtual employees that analyze your codebase and suggest changes for human review.

### The Product Thesis

blissful-infra already knows things that most teams don't act on fast enough:

- **Phase 3** detects a memory spike at 14:32
- **Phase 4** knows the service can't survive a Kafka outage
- **Phase 5** identifies the root cause as an unbounded cache in `GreetingService.kt:47` with 94% confidence

But today, that insight sits in a terminal output until a human reads it, context-switches, and manually writes the fix. Phase 7 eliminates that gap. When the system detects a problem, a virtual employee analyzes the codebase, drafts a fix with full diffs, and presents it for human review. The human decides whether to apply it — not the agent.

This is the **suggest-first model**: agents think, humans decide.

### Why Suggest-First (Not Auto-PR)

LLMs produce wrong code often enough that auto-committing and opening PRs creates noise, not value. A suggestion that's wrong costs nothing — a PR that's wrong wastes review time and erodes trust.

The suggest-first model:
- **No risk** — agent never writes to disk until human says "accept"
- **No trust levels needed** — the safety IS the suggestion model
- **Iterative** — human can say "change X" and agent revises before applying
- **Higher acceptance rate** — humans shape the output before it lands

### The Suggestion Lifecycle

```
assign → analyze → suggest → review → [revise]* → accept → apply + PR
                                         ↑              │
                                         └──────────────┘
                                         (iterate until right)
```

1. **Assign** — human gives agent a task
2. **Analyze** — agent reads codebase (read-only: `list_files`, `read_file`, `search_in_files`)
3. **Suggest** — agent produces a plan + proposed diffs (stored in memory, not on disk)
4. **Review** — human sees the full suggestion with file-by-file diffs in CLI
5. **Revise** — human requests changes, agent updates the suggestion
6. **Accept** — human approves, agent writes files, creates branch, opens PR

### How Each Phase Feeds Suggestions

| Phase | What it provides | How agents use it |
|-------|-----------------|-------------------|
| **Phase 1** (MVP) | Project structure, templates | Agents read conventions to follow when suggesting code |
| **Phase 2** (Pipeline) | Jenkins, CI/CD | Agent can suggest build config changes, Jenkinsfile tweaks |
| **Phase 3** (Observability) | Metrics, logs, health checks | Agent reads error logs and metrics to inform suggestions |
| **Phase 4** (Resilience) | Chaos tests, perf baselines | Agent reads chaos results to suggest resilience fixes |
| **Phase 5** (Intelligence) | Knowledge base, root cause analysis | Agent queries similar incidents to suggest known fixes |
| **Phase 6** (Scale) | Multi-language templates | Agents suggest code in any template language |

### Value Propositions

**1. Expert Second Opinion on Demand**
When Phase 5 detects an OOM with 94% confidence, the agent reads the codebase, drafts a fix, and shows you the diff. You decide if it's right.

```
$ blissful-infra agent status bob
Suggestion Ready: Fix OOMKilled in GreetingService

$ blissful-infra agent review bob
Plan: Add bounded cache with LRU eviction
Knowledge base: 2 similar incidents, both fixed with cache bounds

--- a/src/main/kotlin/com/blissful/service/GreetingService.kt
+++ b/src/main/kotlin/com/blissful/service/GreetingService.kt
@@ -45,7 +45,7 @@
-    private val cache = mutableMapOf<String, Greeting>()
+    private val cache = LinkedHashMap<String, Greeting>(100, 0.75f, true)

$ blissful-infra agent accept bob
✓ Files written, branch created: fix/bounded-greeting-cache
✓ PR opened: #148
```

**2. Feature Scaffolding with Human Polish**
Agent drafts the boilerplate — CRUD endpoints, data models, tests — and you refine before applying.

```
$ blissful-infra agent assign alice "Add a /users endpoint with pagination"
$ blissful-infra agent review alice
# Shows: 4 new files, 14 test cases, full diffs

$ blissful-infra agent revise alice "Use UUID instead of auto-increment IDs"
# Agent updates suggestion...

$ blissful-infra agent review alice
# Shows: updated diffs with UUID

$ blissful-infra agent accept alice
✓ Files written, branch created: feat/add-users-endpoint
✓ PR opened: #47
```

**3. Resilience Gap Closure**
After a chaos test fails, agent suggests the fix. You review, iterate, accept.

```
Chaos: kafka-down scenario FAILED
$ blissful-infra agent assign sre "Fix kafka-down chaos failure"
$ blissful-infra agent review sre
Plan: Add @CircuitBreaker annotation on KafkaProducer
# Shows diff...

$ blissful-infra agent accept sre
✓ Applied. Run 'blissful-infra chaos --scenario kafka-down' to verify.
```

**4. Knowledge Amplification**
Every accepted suggestion feeds back into the knowledge base (Phase 5). Rejected suggestions are tracked too — the system learns what doesn't work.

### Architecture

```
┌─────────────────────────────────────────────────┐
│                 blissful-infra CLI               │
│  agent assign/review/revise/accept/reject        │
└──────────────────┬──────────────────────────────┘
                   │ HTTP (localhost:8095)
┌──────────────────▼──────────────────────────────┐
│              Agent Service (Python)              │
│  FastAPI + LangGraph                             │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │  Phase 1: READ-ONLY analysis            │    │
│  │  list_files, read_file, search_in_files │    │
│  │  git_status, git_diff                   │    │
│  └────────────────┬────────────────────────┘    │
│                   ▼                              │
│  ┌─────────────────────────────────────────┐    │
│  │  Phase 2: SUGGESTION (in-memory diffs)  │    │
│  │  Proposed file changes stored in state  │    │
│  │  Human reviews via CLI or dashboard     │    │
│  └────────────────┬────────────────────────┘    │
│                   ▼ (only after human "accept")  │
│  ┌─────────────────────────────────────────┐    │
│  │  Phase 3: APPLY                         │    │
│  │  write_file, git_create_branch,         │    │
│  │  git_add_and_commit, create_pr          │    │
│  └─────────────────────────────────────────┘    │
└──────────────────┬──────────────────────────────┘
                   │ mounted volume (/workspace)
┌──────────────────▼──────────────────────────────┐
│                Your Project                      │
│  source code, tests, configs, git history        │
└─────────────────────────────────────────────────┘
```

### 7.1 LangGraph Agent Framework ✅
- [x] LangGraph integration with tool-calling agents
- [x] Agent runtime as a blissful-infra plugin service (Python, runs alongside project)
- [x] Configurable LLM backend (Claude, Ollama local models)
- [x] Agent state persistence (JSON file, upgradeable to SQLite)
- [x] CLI commands: `agent hire`, `agent fire`, `agent list`, `agent assign`, `agent status`
- [x] Feature Engineer role with read-only analysis tools

**Location:** `packages/cli/templates/agent-service/`, `packages/cli/src/commands/agent.ts`

### 7.2 Suggestion Engine
The core of the suggest-first model. Agent produces proposed changes without touching the filesystem.

- [ ] **Suggestion state** — in-memory proposed diffs stored in agent state (plan text + file changes)
- [ ] **`agent review <name>`** — CLI renders the suggestion: plan explanation + file-by-file unified diffs
- [ ] **`agent revise <name> "<feedback>"`** — agent re-analyzes with human feedback, updates suggestion
- [ ] **`agent accept <name>`** — writes proposed files to disk, creates branch, commits, opens PR
- [ ] **`agent reject <name>`** — discards suggestion, resets agent to idle
- [ ] **Revision history** — track each revision of a suggestion (v1 → v2 → v3)

### 7.3 Watchdog Mode (Human-in-the-Loop Debugging)
The agent runs as a live debugging companion while your app is running. Instead of waiting for you to notice errors, the agent watches container logs and health checks, diagnoses issues automatically, and prompts you to investigate.

**How it works:**
```
┌─────────────────────────────────────┐
│         Running Containers          │
│  backend, frontend, kafka, db...    │
└──────────────┬──────────────────────┘
               │ logs + health checks
┌──────────────▼──────────────────────┐
│          Watchdog Agent             │
│  Monitors: stdout/stderr, /health  │
│  Detects: crashes, 5xx, exceptions │
│  Analyzes: reads code (read-only)  │
│  Produces: diagnosis + suggested   │
│            fix (in-memory diff)    │
└──────────────┬──────────────────────┘
               │ notification
┌──────────────▼──────────────────────┐
│          Developer CLI              │
│                                     │
│  ⚠ [alice] NullPointerException    │
│    in UserService.java:42           │
│    Suggested fix ready.             │
│                                     │
│  [Investigate]  [Silence]           │
└─────────────────────────────────────┘
```

**User actions on alert:**
- **Investigate** — opens the diagnosis + suggested fix diff (enters `review → revise → accept` flow)
- **Silence** — mutes that error pattern. Options:
  - `silence 10m` — mute for 10 minutes
  - `silence this` — mute this specific error pattern permanently
  - `silence all` — pause all watchdog alerts

**What gets detected:**
- Container crashes / restarts (health check failures)
- HTTP 5xx responses in logs
- Unhandled exceptions / stack traces
- OOM kills
- Connection refused errors (database, Kafka, external services)

**Integration with existing phases:**
- Reads Phase 3 health checks and metrics (already polling)
- Queries Phase 5 knowledge base for similar past incidents
- Suggested fixes follow the same suggest-first model (no writes until accept)

- [ ] Log watcher — stream container logs, detect error patterns (regex + LLM classification)
- [ ] Health check watcher — tie into existing `api.ts` health polling
- [ ] Auto-diagnosis — agent reads relevant source code when error detected
- [ ] CLI notifications — prompt user with `[Investigate] [Silence]` choices
- [ ] Silence system — per-pattern, timed, and global silence modes
- [ ] `agent watch start` — enable watchdog mode for an agent
- [ ] `agent watch stop` — disable watchdog mode
- [ ] `agent watch silences` — list active silences
- [ ] `agent watch clear-silence <id>` — remove a silence rule

### 7.4 Virtual Employee Roles
Each role is a LangGraph StateGraph with a specialized system prompt and read-only tool set. Write tools only activate on accept.

| Role | Trigger | Reads | Suggests |
|------|---------|-------|----------|
| **Feature Engineer** | Manual task | Code structure, conventions, tests | New files + test code |
| **Bug Fixer** | Alert or manual | Logs, knowledge base, source code | Fix diffs |
| **SRE Bot** | Chaos failure or manual | Chaos results, metrics, infra config | Config/code changes |
| **Docs Writer** | Manual | Source code, existing docs | Doc updates |

- [x] Feature Engineer (MVP)
- [ ] Bug Fixer — reads Phase 5 alerts and knowledge base
- [ ] SRE Bot — reads Phase 3 metrics and Phase 4 chaos results
- [ ] Docs Writer — scans code for undocumented endpoints/models

### 7.5 Tool Graph
Two phases of tools, separated by the human approval boundary.

**Read tools (always available):**
- [x] `read_file`, `list_files`, `search_in_files` — codebase analysis
- [x] `git_status`, `git_diff` — current state awareness
- [ ] `query_logs`, `query_metrics` — Phase 3 observability data
- [ ] `query_prometheus` — PromQL queries against Prometheus (when monitoring=prometheus)
- [ ] `search_incidents`, `get_fix_suggestions` — Phase 5 knowledge base
- [ ] `read_chaos_results`, `read_perf_results` — Phase 4 data

**Write tools (only after human accept):**
- [x] `write_file` — apply proposed changes to disk
- [x] `git_create_branch`, `git_add_and_commit` — create branch and commit
- [ ] `create_pr` — open PR on GitHub
- [ ] `run_tests` — verify changes after apply

### 7.6 Dashboard Integration
- [ ] Suggestion viewer — see proposed diffs in the browser with syntax highlighting
- [ ] Accept/reject/revise buttons — one-click actions from dashboard
- [ ] Agent activity feed — recent suggestions across all agents
- [ ] Acceptance rate tracking — which agents produce useful suggestions

### 7.7 CLI Commands
- [x] `blissful-infra agent chat` — Interactive AI assistant (legacy, now a subcommand)
- [x] `blissful-infra agent hire <role> --name <n>` — Spawn a virtual employee
- [x] `blissful-infra agent fire <name>` — Stop a virtual employee
- [x] `blissful-infra agent list` — Show active virtual employees
- [x] `blissful-infra agent assign <name> <task>` — Assign a task
- [x] `blissful-infra agent status <name>` — Show agent progress
- [ ] `blissful-infra agent review <name>` — View suggestion with diffs
- [ ] `blissful-infra agent revise <name> "<feedback>"` — Request changes to suggestion
- [ ] `blissful-infra agent accept <name>` — Apply suggestion, create branch + PR
- [ ] `blissful-infra agent reject <name>` — Discard suggestion
- [ ] `blissful-infra agent watch start` — Enable watchdog mode (monitors logs + health)
- [ ] `blissful-infra agent watch stop` — Disable watchdog mode
- [ ] `blissful-infra agent watch silences` — List active silence rules
- [ ] `blissful-infra agent watch clear-silence <id>` — Remove a silence rule

**Location:** `packages/cli/templates/agent-service/`, `packages/cli/src/commands/agent.ts`

### Competitive Differentiation

Most AI coding tools (Copilot, Cursor, Devin) either autocomplete at the cursor or autonomously write code and hope it's right. blissful-infra takes a different approach: **suggest, don't commit.** The agent has deep infrastructure context (metrics, chaos results, incident history, deployment pipeline) that editor-level tools can never have — and it presents that context as reviewable suggestions rather than fait accompli PRs.

This is the difference between "AI that writes code and hopes for the best" and "AI that drafts informed suggestions for humans to approve."

### Phase 7 Definition of Done
```
$ blissful-infra start my-app --plugins agent-service
✓ Agent service running on http://localhost:8095

$ blissful-infra agent hire feature-engineer --name alice
✓ Virtual employee "alice" (Feature Engineer) is online

$ blissful-infra agent assign alice "Add a /users endpoint with CRUD operations"
✓ Task assigned to alice
# Alice analyzes codebase (read-only)...

$ blissful-infra agent status alice
Agent: alice (Feature Engineer)
Status: Suggestion Ready
Current Task: Add /users endpoint with CRUD operations

Progress:
  ✓ Analyzed codebase (12 files read)
  ✓ Identified patterns (existing controllers, test style)
  ✓ Drafted suggestion (4 new files, 2 modified)

→ Run 'agent review alice' to see suggestion

$ blissful-infra agent review alice
Suggestion v1: Add /users endpoint with CRUD operations

Plan:
  Create UserController.kt following existing HelloController pattern
  Create UserService.kt with CRUD methods
  Create UserRepository.kt (Spring Data JPA)
  Create UserDTO.kt for request/response
  Add 14 test cases following existing test conventions

--- /dev/null → src/main/kotlin/.../controller/UserController.kt
+++ (new file, 45 lines)
+ @RestController
+ @RequestMapping("/users")
+ class UserController(private val userService: UserService) {
+ ...

--- /dev/null → src/test/.../controller/UserControllerTest.kt
+++ (new file, 120 lines)
+ ...

[accept] [revise] [reject]

$ blissful-infra agent revise alice "Use UUID for user IDs, not auto-increment"
✓ Revising suggestion...

$ blissful-infra agent review alice
Suggestion v2: (updated with UUID)
# Shows updated diffs...

$ blissful-infra agent accept alice
✓ 4 files written
✓ Branch created: feat/add-users-endpoint
✓ Committed: "Add /users endpoint with CRUD operations"
✓ PR opened: #47

# Watchdog: live debugging while app is running
$ blissful-infra agent watch start
✓ Watchdog enabled — monitoring container logs and health checks

# ... developer is working, app throws an error ...

⚠ [watchdog] NullPointerException in UserService.java:42
  Cause: req.getUser() returns null when auth header missing
  Suggested fix ready (1 file, 3 lines changed)

  [Investigate]  [Silence]

$ blissful-infra agent review watchdog
Suggestion: Add null check for user in UserService

--- a/src/main/kotlin/.../service/UserService.kt
+++ b/src/main/kotlin/.../service/UserService.kt
@@ -40,6 +40,8 @@
     fun getUser(req: Request): User {
+        val user = req.getUser()
+            ?: throw ResponseStatusException(HttpStatus.UNAUTHORIZED, "Missing auth")
-        return req.getUser()

$ blissful-infra agent accept watchdog
✓ Fix applied

# Too noisy? Silence it.
$ blissful-infra agent watch silences
No active silences.

$ blissful-infra agent watch start --silence "NullPointerException" --duration 30m
✓ Silenced "NullPointerException" for 30 minutes
```

---

## Dependency Graph

```
Phase 1 (MVP) ─── project structure, templates, Docker
    │
    ├──────────────────────┐
    ▼                      ▼
Phase 2 (Pipeline)    Phase 3 (Observability)
    CI/CD, builds          metrics, logs, health
    │                      │
    └──────────┬───────────┘
               ▼
         Phase 4 (Resilience)
               chaos, perf, canary
               │
               ▼
         Phase 5 (Intelligence)
               knowledge base, root cause
               │
               ▼
         Phase 6 (Scale)
               multi-lang, cloud, teams
               │
               ▼
         Phase 7 (Autonomy) ◄── consumes ALL previous phases
               virtual employees that ACT on what Phases 1-6 KNOW
```

**Notes:**
- Phase 2 and 3 can be developed in parallel after Phase 1
- Phase 4 requires both Pipeline and Observability
- Phase 5 builds on all previous phases
- Phase 6 is additive and can be done incrementally
- Phase 7 is the capstone — it consumes every previous phase:
  - Phase 1: agents follow project conventions when writing code
  - Phase 2: agents trigger builds and verify tests
  - Phase 3: SRE Bot watches metrics, Bug Fixer reads logs
  - Phase 4: SRE Bot runs chaos tests after fixes
  - Phase 5: Bug Fixer queries knowledge base for similar incidents
  - Phase 6: agents work across any language template

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Ollama hardware requirements | Ship with 8b model as default, 70b optional |
| Template maintenance burden | Start with 1 template, prove patterns before expanding |
| Dashboard scope creep | CLI-first approach, dashboard for visualization only |
| Pipeline complexity | Local pipeline option first, cluster later |
| Agent accuracy | Conservative confidence thresholds, always require approval for actions |

---

## Success Metrics

### Phase 1 (MVP)
- [ ] Time from `create` to `curl` < 3 minutes
- [ ] Agent responds to basic queries

### Phase 2 (Pipeline)
- [x] Full pipeline completes < 10 minutes
- [x] Ephemeral environments work reliably
- [x] Local pipeline command available

### Phase 3 (Observability)
- [x] Metrics available within 30s of request
- [x] Logs searchable across services
- [x] Dashboard displays real-time metrics and health status
- [ ] Prometheus scrapes app metrics within 15s of startup
- [ ] Grafana dashboards load with pre-populated panels (no manual config)
- [x] Loki integration

### Phase 4 (Resilience)
- [ ] Performance tests complete < 5 minutes
- [ ] 5+ chaos scenarios working
- [ ] Comparison tests complete < 15 minutes

### Phase 5 (Intelligence)
- [ ] Root cause accuracy > 80%
- [ ] Fix suggestions accepted > 60% of time

### Phase 6 (Scale)
- [ ] All 6 templates working
- [ ] Cloud deployment verified on 1+ provider
- [ ] Third-party plugin installable and usable without CLI changes
- [ ] Built-in plugins migrated to manifest-driven loading

### Phase 7 (Autonomy)
- [ ] Agent produces a reviewable suggestion with correct diffs for a feature task
- [ ] Human can revise a suggestion and agent updates it correctly
- [ ] Accepted suggestion writes files, creates branch, opens PR successfully
- [ ] Suggestion acceptance rate > 50% (after revision)
- [ ] Mean time from assign to suggestion-ready < 2 minutes
- [ ] Bug Fixer reads Phase 5 alert and suggests a correct fix
- [ ] Watchdog detects a container error and prompts user within 10 seconds
- [ ] Watchdog diagnosis identifies correct root cause for common errors (5xx, NPE, OOM)
- [ ] Silence system correctly suppresses repeated alerts for the same error pattern

---

## Getting Started

Begin with Phase 1. Do not move to Phase 2 until MVP is complete and tested.

```bash
# Start here
mkdir -p packages/cli
cd packages/cli
npm init -y
npm install typescript commander inquirer
```

Focus on the smallest possible increment that delivers value. Ship early, iterate often.
