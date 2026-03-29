# Blissful Infra - Technical Specification

**Enterprise-grade infrastructure in a local sandbox. Zero cloud costs.**

## Vision

Give software engineers a complete enterprise development environment running locally on their laptop. Learn, experiment, and develop with the same infrastructure patterns used at scale — without cloud accounts, without touching shared environments, without surprise bills.

## Problem

Enterprise infrastructure is complex and inaccessible:

**For engineers joining companies:**
- CI/CD pipelines, Kubernetes, GitOps, canary deployments are hard to understand without hands-on experience
- Shared environments are fragile — experimentation risks breaking things for others
- Cloud resources are expensive — spinning up a test EKS cluster costs real money

**For teams building production services:**
- Testing deployment strategies (canary, blue-green) requires infrastructure that doesn't exist locally
- Validating rollback procedures means intentionally breaking production-like environments
- Chaos testing and resilience validation need dedicated resources

**For startups:**
- Enterprise patterns (observability, GitOps, progressive delivery) seem out of reach
- Building infrastructure expertise takes time away from building the product
- Cloud costs scale faster than revenue

## Solution

A local sandbox that simulates enterprise infrastructure:

- **CI/CD Pipeline** — Jenkins with build, test, scan, deploy stages
- **Container Registry** — Local Docker registry for images
- **Kubernetes Manifests** — Deployment, Service, ConfigMap with Kustomize overlays
- **GitOps** — Argo CD application manifests for declarative deployments
- **Observability** — Metrics, logs, health monitoring, and dashboard
- **Canary Deployments** — Progressive rollouts with automated analysis and rollback
- **Chaos Testing** — FMEA scenarios to validate service resilience
- **AI Agent** — Local LLM that analyzes failures and suggests fixes

All running locally. No cloud account required. Same patterns as production.

## Fast Feedback Loops

The core value proposition: **iterate in seconds, not hours**.

| Workflow | Traditional (Cloud) | blissful-infra (Local) |
|----------|---------------------|------------------------|
| Code → Deploy → Test | 15-30 min (CI queue + deploy) | **30 seconds** |
| Test pipeline changes | Commit → PR → CI runs | **Run locally, instant** |
| Experiment with K8s config | Change → commit → wait | **Edit → apply → see** |
| Test rollback procedure | Coordinate downtime window | **Anytime, no risk** |
| Debug deployment failure | Dig through Datadog/CloudWatch | **Logs right in terminal** |
| Try canary deployment | Requires prod-like traffic | **Simulate locally** |

**Why this matters:**
- Learning happens through experimentation — fast feedback = more experiments = faster learning
- Confidence comes from practice — test rollbacks 100 times locally before doing it once in production
- Innovation requires safety — try wild ideas without fear of breaking shared environments

## Functional Requirements

### CLI (blissful-infra)

Interactive CLI similar to Vite's create experience:
```
$ npx blissful-infra create

? Project name: my-service
? Select template:
  ❯ spring-boot    (Kotlin + Spring Boot + Kafka + WebSockets)
    fastapi        (Python + FastAPI + Kafka + WebSockets)
    express        (Node + Express + TypeScript + Kafka + WebSockets)
    go-chi         (Go + Chi router + Kafka + WebSockets)
    react-vite     (React + Vite + TypeScript + Redux + shadcn/ui)
    fullstack      (Backend + Frontend monorepo)

? Include database?
  ❯ none
    postgres
    redis
    postgres + redis

? Deployment target:
  ❯ local-only     (Docker Compose)
    kubernetes     (Argo CD + Kind for local)
    cloud          (EKS/GKE/AKS)

Scaffolding project in ./my-service...
Done. Now run:

  cd my-service
  blissful-infra up
```

#### CLI Commands
```
blissful-infra create                              # interactive project scaffolding
blissful-infra create <name> --template <t>        # non-interactive scaffolding
blissful-infra up                                  # run locally (Docker Compose + Kafka)
blissful-infra down                                # stop local environment
blissful-infra deploy --env <env>                  # deploy to environment via Argo CD
blissful-infra promote --from <env> --to <env>     # promote version between environments
blissful-infra rollback --env <env>                # rollback to previous version
blissful-infra pipeline --local                    # run full pipeline locally
blissful-infra perf --env <env>                    # run performance tests
blissful-infra chaos --env <env>                   # run FMEA chaos tests
blissful-infra chaos --env <env> --scenario <s>    # run specific failure scenario
blissful-infra compare --old <ref> --new <ref>     # run parallel comparison test
blissful-infra dashboard                           # open dashboard UI
blissful-infra logs --env <env>                    # tail logs from environment
blissful-infra status                              # show deployment status across environments
blissful-infra analyze                             # analyze recent failures and suggest fixes
blissful-infra analyze --incident <id>             # deep dive on specific incident
blissful-infra suggest                             # get improvement recommendations
blissful-infra agent                               # interactive AI agent session
blissful-infra agent --query "why did deploy fail" # one-shot agent query
```

### Templates

Each template includes:
- A working hello world application with health and test endpoints
- Dockerfile optimized for the stack
- Jenkinsfile for CI/CD pipeline
- Kubernetes manifests and Docker Compose for local
- Integration tests
- Performance tests (k6)
- FMEA chaos test scenarios
- Structured logging for agent analysis

#### Backend Templates

| Template | Stack | Test Coverage |
|----------|-------|---------------|
| `spring-boot` | Kotlin + Spring Boot + Kafka + WebSockets | JUnit 5 + MockK + WebTestClient + TestContainers |
| `fastapi` | Python + FastAPI + Kafka + WebSockets | pytest + httpx + TestContainers |
| `express` | Node + Express + TypeScript + Kafka + WebSockets | Jest + Supertest + TestContainers |
| `go-chi` | Go + Chi router + Kafka + WebSockets | Go test + httptest + TestContainers |

#### Frontend Templates

| Template | Stack |
|----------|-------|
| `react-vite` | React + Vite + TypeScript + Redux Toolkit + shadcn/ui |

#### Fullstack Template

| Template | Stack |
|----------|-------|
| `fullstack` | Monorepo with backend (choice) + frontend + shared types |

#### Standard Backend Endpoints

All backend templates expose:
- `GET /health` - returns `{ "status": "healthy", "timestamp": "..." }`
- `GET /hello` - returns `{ "message": "Hello, World!" }`
- `GET /hello/:name` - returns `{ "message": "Hello, {name}!" }`
- `POST /echo` - returns request body as response
- `GET /ready` - Kubernetes readiness probe
- `GET /live` - Kubernetes liveness probe
- `WS /ws/events` - WebSocket endpoint for real-time event stream

#### Event Architecture

All backend templates include:
- Kafka producer that emits domain events (e.g., `greeting.created`)
- Kafka consumer that bridges events to WebSocket clients
- Events include: `eventId`, `aggregateId`, `occurredAt`, `eventType`, and event-specific payload

### Dashboard

Single unified dashboard (React + Vite + TypeScript + Redux + shadcn/ui) for deployment orchestration and observability.

#### Features

- Environment status (local / staging / production)
- Current version deployed per environment
- Argo CD sync status
- One-click promote / rollback actions
- Live pipeline execution with stage progress
- Per-stage metrics and duration
- Test results and coverage reports
- Security scan results
- Response time (p50, p95, p99)
- Throughput (requests/sec)
- Error rate
- Kafka lag
- WebSocket connection count
- Resource utilization (CPU, memory)
- Side-by-side metrics for old vs new version comparison
- FMEA test results with failure mode analysis
- Resilience scorecard
- AI agent chat interface
- Improvement suggestions feed
- Incident analysis timeline

### AI Analysis Agent

Local LLM-powered agent that correlates data sources to identify root causes and suggest improvements. Runs entirely on local infrastructure via Ollama - no external API costs.

#### LLM Configuration
```yaml
# blissful-infra.yaml
agent:
  provider: ollama
  model: llama3.1:70b          # or codellama, mistral, deepseek-coder
  endpoint: http://localhost:11434
  fallback_model: llama3.1:8b  # smaller model for quick queries
  embedding_model: nomic-embed-text
  context_window: 32000
  temperature: 0.1             # low temp for factual analysis
```

#### Data Sources

Agent correlates across:

| Source | Data Collected | Purpose |
|--------|----------------|---------|
| Git | Commits, diffs, blame | Correlate code changes with failures |
| Jenkins | Build logs, test results, timing | Identify build/test failures |
| Argo CD | Deployment events, sync status | Track deployment state changes |
| Prometheus | Metrics time series | Performance and resource analysis |
| Loki | Application logs | Error patterns and stack traces |
| Chaos Mesh | FMEA test results | Resilience gaps |
| k6 | Performance test results | Load test analysis |
| Kubernetes | Events, pod status, resource usage | Infrastructure issues |

#### Analysis Capabilities

**Root Cause Analysis**
```
$ blissful-infra analyze --incident deploy-2024-01-15-001

Analyzing incident deploy-2024-01-15-001...

📊 Correlating data sources:
  ✓ Git commits (3 commits in deploy range)
  ✓ Jenkins build logs
  ✓ Prometheus metrics (15 min window)
  ✓ Application logs (2,847 entries)
  ✓ Kubernetes events

🔍 Root Cause Analysis:

FINDING: OOMKilled after deploy
CONFIDENCE: 94%

Timeline:
  14:32:01 - Deploy started (commit abc123)
  14:32:45 - New pods scheduled
  14:33:12 - Memory usage spike (450MB → 1.2GB)
  14:33:18 - OOMKilled event
  14:33:19 - Pod restart

Root Cause:
  Commit abc123 introduced unbounded cache in GreetingService.kt:47
  
  - val cache = mutableMapOf<String, GreetingResponse>()
  + val cache = CacheBuilder.newBuilder()
  +     .maximumSize(1000)
  +     .expireAfterWrite(Duration.ofMinutes(5))
  +     .build<String, GreetingResponse>()

Contributing Factors:
  - Memory limit set to 512MB (insufficient headroom)
  - No memory-based alerts configured
  - Load test didn't include cache warming scenario

Suggested Fixes:
  1. [AUTO-FIX AVAILABLE] Add bounded cache - PR #142
  2. Increase memory limit to 1GB
  3. Add memory utilization alert at 80%

Apply auto-fix? [y/N]
```

**Performance Regression Analysis**
```
$ blissful-infra analyze

Analyzing recent comparison test...

📉 Performance Regression Detected

Metric: p95 latency
Old version: 45ms
New version: 180ms
Degradation: 300%

🔍 Analysis:

Correlating with code changes...

FINDING: N+1 query introduced
CONFIDENCE: 87%

Commit: def456 "Add user preferences to greeting"
File: HelloController.kt:23

  users.forEach { user ->
    val prefs = prefRepository.findByUserId(user.id)  // N queries!
    ...
  }

Suggested Fix:
  - val prefs = prefRepository.findByUserId(user.id)
  + val prefsMap = prefRepository.findByUserIds(users.map { it.id })
  +     .associateBy { it.userId }

Similar past incidents: 2 (links)
```

#### Self-Learning & Improvement Suggestions

Agent continuously learns from deployments and suggests infrastructure improvements.

**Knowledge Base**
- Stores anonymized incident patterns locally
- Builds embedding index for similarity search
- Tracks which fixes resolved which issues
- Learns your codebase patterns over time
```yaml
# blissful-infra.yaml
agent:
  knowledge_base:
    path: .blissful-infra/knowledge
    retention_days: 90
    index_on_deploy: true
```

**Improvement Suggestions**
```
$ blissful-infra suggest

🎯 Infrastructure Improvement Suggestions

Based on analysis of 47 deployments over 30 days:

HIGH PRIORITY:

1. Add circuit breaker for payment-service calls
   - 3 incidents caused by payment-service timeouts
   - Average recovery time: 4 minutes
   - Suggested: Resilience4j circuit breaker
   - Impact: Reduce blast radius of downstream failures
   [Generate PR]

2. Increase Kafka consumer parallelism
   - Consumer lag exceeded 10k messages 5 times
   - Current: 1 partition, 1 consumer
   - Suggested: 3 partitions, 3 consumers
   - Impact: 3x throughput headroom
   [Generate PR]

3. Add database connection pool metrics
   - 2 incidents with connection exhaustion
   - No visibility into pool utilization
   - Suggested: Expose HikariCP metrics to Prometheus
   - Impact: Early warning for connection issues
   [Generate PR]

MEDIUM PRIORITY:

4. Missing chaos test coverage
   - No test for: redis-down, dns-failure
   - Suggested: Add FMEA scenarios
   [Generate scenarios]

5. Flaky test detected
   - KafkaIntegrationTest.kt fails 8% of runs
   - Pattern: Timing-dependent assertion
   - Suggested fix available
   [View fix]

OPTIMIZATIONS:

6. Docker image size reduction
   - Current: 847MB
   - Suggested: Multi-stage build + distroless
   - Projected: 124MB
   [Generate Dockerfile]
```

**Learning Feedback Loop**
```mermaid
flowchart TD
    Deploy["Deploy & Test"] --> Collect["Collect Data"] --> Analyze["Analyze & Learn"]
    Analyze --> KB

    subgraph KB["Knowledge Base"]
        IH["Incident History"]
        PE["Pattern Embeddings"]
        FO["Fix Outcomes"]
    end

    KB --> Suggest["Improvement Suggestions\nProven fixes · new tests · scaling · refactors"]
    Suggest --> NextDeploy["Next Deploy"]
    NextDeploy --> Deploy
```

#### Interactive Agent Session
```
$ blissful-infra agent

🤖 Easy Infra Agent (llama3.1:70b via Ollama)
   Type 'help' for commands, 'exit' to quit

> why is staging slower than prod?

Analyzing staging vs production metrics...

Staging p95: 230ms
Production p95: 45ms

Differences found:
1. Staging has 1 replica, prod has 3 (less load distribution)
2. Staging DB is on shared instance (noisy neighbor)
3. Staging missing Redis cache (disabled in config)

Recommendation: Enable Redis cache in staging to match prod config.
Run: blissful-infra config set staging.redis.enabled true

> what broke in the last deploy?

Checking last deployment (14:32 today)...

Deployment failed at integration-test stage.

Failure: HealthControllerTest.GET_health_returns_healthy_status
Error: Connection refused to localhost:8080

Root cause: Application failed to start
Reason: Missing KAFKA_BOOTSTRAP_SERVERS environment variable

The variable was removed in commit abc123 when refactoring config.

Fix: Add KAFKA_BOOTSTRAP_SERVERS to deployment.yaml

> generate a fix

Creating PR #143...

Branch: fix/missing-kafka-env
Changes:
  - infra/k8s/deployment.yaml: Add KAFKA_BOOTSTRAP_SERVERS env var

PR created: https://github.com/you/my-service/pull/143
```

### FMEA Chaos Testing

Failure Mode and Effects Analysis - validate service resilience under real-world failure conditions using Chaos Mesh.
```
blissful-infra chaos --env staging
blissful-infra chaos --env staging --scenario kafka-down
blissful-infra chaos --env staging --duration 5m --load 100
```

#### Failure Scenarios

| Scenario | Failure Injected | Expected Behavior |
|----------|------------------|-------------------|
| `network-latency` | 500ms latency on all pod traffic | Requests complete within timeout, no errors |
| `network-partition` | Drop 50% of packets | Circuit breaker trips, graceful degradation |
| `pod-kill` | Kill random app pod | Traffic shifts to healthy pods, no user-facing errors |
| `kafka-down` | Kafka broker unavailable | Events queued/retried, API remains responsive |
| `db-latency` | 2s latency on database queries | Timeouts handled, fallback responses served |
| `db-down` | Database unavailable | Cached responses served, clear error messaging |
| `memory-pressure` | Consume 90% of pod memory | Pod evicted and rescheduled, no data loss |
| `cpu-stress` | Spike CPU to 100% | Latency increases but requests still served |
| `dns-failure` | DNS resolution fails | Retries with backoff, cached resolutions used |
| `dependency-timeout` | External service times out | Circuit breaker opens, fallback activated |

#### FMEA Test Flow

1. **Baseline** - Capture normal performance metrics
2. **Inject Failure** - Apply chaos scenario via Chaos Mesh
3. **Observe** - Monitor service behavior under failure
4. **Validate** - Check against expected behavior and SLOs
5. **Recover** - Remove failure injection
6. **Verify Recovery** - Confirm metrics return to baseline
7. **Report** - Generate FMEA analysis report
8. **Learn** - Agent indexes results for future suggestions

#### FMEA Report

| Failure Mode | Severity | Detection Time | Recovery Time | Impact | Mitigation Status |
|--------------|----------|----------------|---------------|--------|-------------------|
| Kafka down | High | 2s | 45s | Events delayed | ✅ Circuit breaker |
| Pod crash | Medium | 5s | 12s | Brief latency spike | ✅ Rolling deployment |
| DB latency | High | 1s | 30s | Degraded response time | ⚠️ Needs caching |
| Network partition | Critical | 3s | 60s | Partial outage | ❌ No fallback |

#### Resilience Scorecard
```mermaid
%%{init: {"quadrantChart": {"chartWidth": 400}}}%%
pie title Resilience Score: 78/100
    "✅ Circuit Breakers (configured & tested)" : 15
    "✅ Retry Logic (exponential backoff)" : 15
    "✅ Health Checks (liveness & readiness)" : 15
    "✅ Graceful Shutdown (SIGTERM handled)" : 15
    "⚠️ Caching (partial coverage)" : 10
    "❌ Bulkheads (not implemented)" : 15
    "❌ Rate Limiting (not configured)" : 15
```

#### Configuration
```yaml
# blissful-infra.yaml
chaos:
  enabled: true
  tool: chaos-mesh
  scenarios:
    - network-latency
    - pod-kill
    - kafka-down
    - db-latency
  default_duration: 2m
  load_during_chaos: 50
  slos:
    max_error_rate_percent: 5
    max_p99_latency_ms: 2000
    max_recovery_time_s: 60
  abort_on_critical_failure: true
```

### Parallel Version Comparison

Deploy old and new versions simultaneously, run identical load tests, compare results.
```
blissful-infra compare --old main~1 --new main --env staging
```

#### Comparison Flow

1. **Provision** - Deploy both versions to isolated namespaces
2. **Warm Up** - Send baseline traffic to both versions
3. **Load Test** - Run identical k6 tests against both in parallel
4. **Chaos Test** (optional) - Run FMEA scenarios against both versions
5. **Collect Metrics** - Gather performance data from both versions
6. **Analyze** - Agent compares metrics and explains differences
7. **Report** - Display results in dashboard and CLI
8. **Teardown** - Destroy comparison environments

#### Comparison Metrics

| Metric | Description | Default Threshold |
|--------|-------------|-------------------|
| p95 Latency | 95th percentile response time | < 200ms |
| p99 Latency | 99th percentile response time | < 500ms |
| Throughput | Requests per second | > 1000 req/s |
| Error Rate | Percentage of failed requests | < 1% |
| CPU Usage | Average CPU utilization | < 80% |
| Memory Usage | Average memory consumption | < 1GB |
| Resilience Score | FMEA test pass rate | >= 80% |

#### Configuration
```yaml
# blissful-infra.yaml
comparison:
  warmup_duration: 30s
  test_duration: 5m
  concurrent_users: 100
  include_chaos: true
  thresholds:
    p95_latency_ms: 200
    p99_latency_ms: 500
    min_throughput_rps: 1000
    max_error_rate_percent: 1
    max_cpu_percent: 80
    max_memory_mb: 1024
    min_resilience_score: 80
  auto_promote: false
  critical_metrics:
    - p95_latency_ms
    - error_rate_percent
    - resilience_score
```

### Pipeline (Jenkins)

Every template includes a Jenkinsfile with these stages:

1. **Build** - lint, unit test, compile
2. **Containerize** - docker build, security scan (Trivy)
3. **Deploy Ephemeral** - spin up temporary environment via Argo CD
4. **Integration Test** - smoke test endpoints, verify Kafka events, verify WebSocket delivery
5. **Performance Test** - k6 load tests against ephemeral environment
6. **FMEA Chaos Test** - resilience validation under failure conditions
7. **Comparison Test** (optional) - parallel old vs new version comparison
8. **AI Analysis** - agent analyzes results, flags issues, updates knowledge base
9. **Teardown** - destroy ephemeral environment
10. **Deploy** - promote to target environment via Argo CD (on main branch)

### Kubernetes Orchestration (Argo CD)

- GitOps-based deployment model
- Application manifests stored in Git, Argo CD syncs to cluster
- Automated sync for ephemeral and comparison environments
- Manual promotion gates for staging/production
- Rollback support via Git revert
- Health status monitoring pushed to dashboard

## Non-Functional Requirements

- **Speed**: Local deployments complete in < 60 seconds
- **Portability**: No vendor lock-in; eject to raw manifests anytime
- **Architecture**: Domain driven design, onion layering approach
- **Observability**: Built-in logging and metrics from day one
- **Performance**: Baseline p95 latency < 200ms, validated in pipeline
- **Resilience**: Minimum 80% FMEA pass rate required for promotion
- **Comparison**: Full parallel comparison completes in < 15 minutes
- **AI Analysis**: Root cause analysis completes in < 30 seconds
- **Cost**: Zero external API costs - all AI runs locally via Ollama

## Supported Deployment Targets

- Local (Docker Compose / Kind / Minikube)
- Kubernetes (any cluster via Argo CD)
- Cloud-managed (EKS, GKE, AKS)

## Architecture
```mermaid
flowchart TD
    CLI["blissful-infra CLI"]
    Dashboard["Dashboard (React)"]

    CLI --> Dashboard

    Dashboard --> Jenkins["Jenkins\n(Pipeline)"]
    Dashboard --> Agent
    Dashboard --> ArgoCD["Argo CD\n(GitOps)"]

    subgraph Agent["AI Analysis Agent"]
        Ollama["Ollama (Local LLM)\nllama3.1:70b · nomic-embed-text"]
        KB2["Knowledge Base\nIncident history · Pattern embeddings · Fix outcomes"]
    end

    Jenkins --> Prom2["Prometheus + Grafana"]
    Agent --> Prom2
    Agent --> Loki["Loki (Logs)"]
    Agent --> ChaosMesh["Chaos Mesh"]
    ArgoCD --> Prom2

    Prom2 & Loki & ChaosMesh --> Cluster

    subgraph Cluster["Docker Compose / Kubernetes Cluster"]
        App["App"]
        KafkaNode["Kafka"]
        PGNode["Postgres"]
    end
```