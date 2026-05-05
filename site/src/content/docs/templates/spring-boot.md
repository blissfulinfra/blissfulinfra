---
title: Spring Boot Template
description: Kotlin + Spring Boot 3 backend with Kafka, JPA, WebSockets, and full observability.
---

The `spring-boot` template generates a production-ready Kotlin + Spring Boot 3 backend. It is the default backend when you run `blissful-infra start` without specifying `--backend`.

## Stack

| Component | Version | Purpose |
|-----------|---------|---------|
| Kotlin | 1.9+ | Application language |
| Spring Boot | 3.x | Web framework, dependency injection |
| Spring Kafka | - | Kafka producer and consumer |
| Spring Data JPA | - | Database access via Hibernate ORM |
| Spring WebSocket | - | Real-time bidirectional communication |
| Spring Cache | - | `@Cacheable` Redis integration |
| Flyway | - | Database schema migrations |
| Gradle | 8.x | Build tool with Kotlin DSL |
| OpenTelemetry Java agent | 2.x | Auto-instrumentation for traces |

## What gets generated

```
backend/
├── src/main/kotlin/com/blissful/{{project_name}}/
│   ├── Application.kt            # Spring Boot entry point
│   ├── config/
│   │   ├── KafkaConfig.kt        # Topic creation + serializers
│   │   └── WebSocketConfig.kt    # STOMP endpoint configuration
│   ├── controller/
│   │   └── MessageController.kt  # REST + WebSocket message handlers
│   ├── service/
│   │   └── MessageService.kt     # Business logic, Kafka publish
│   ├── consumer/
│   │   └── MessageConsumer.kt    # Kafka listener → WebSocket broadcast
│   ├── model/
│   │   └── Message.kt            # JPA entity (with @IF_POSTGRES block)
│   └── repository/
│       └── MessageRepository.kt  # Spring Data JPA repository
├── src/main/resources/
│   ├── application.yml           # App config (Kafka, DB, Redis, OTel)
│   └── db/migration/
│       └── V1__create_messages.sql  # Flyway initial schema
├── build.gradle.kts              # Gradle build with all dependencies
├── Dockerfile                    # Multi-stage build, includes OTel agent
└── Jenkinsfile                   # CI/CD pipeline definition
```

## The example application

The generated app implements a simple real-time chat to demonstrate the full stack working together. The flow:

1. Browser sends a message via WebSocket (`/ws/send`)
2. Spring controller receives it and publishes to the `messages` Kafka topic
3. A `@KafkaListener` in `MessageConsumer.kt` consumes from the topic
4. The consumer broadcasts the message to all connected WebSocket clients via `SimpMessagingTemplate`
5. Browser receives the broadcast on subscription `/topic/messages`
6. Message is persisted to Postgres via `MessageRepository.save()` (if database includes postgres)
7. Recent messages are cached in Redis (if using `postgres-redis`)

## Key endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Simple health check |
| `GET` | `/actuator/health` | Spring Boot health endpoint (used by Docker healthcheck) |
| `GET` | `/actuator/prometheus` | Prometheus metrics scrape endpoint |
| `POST` | `/api/messages` | Send a message via REST |
| `GET` | `/api/messages` | Get recent messages |
| `WS` | `/ws` | STOMP WebSocket endpoint |

## Kafka configuration

The template creates two topics at startup:

| Topic | Partitions | Purpose |
|-------|-----------|---------|
| `messages` | 3 | Chat messages flowing backend → consumer → clients |
| `events` | 3 | General event bus (used by AI pipeline plugin when enabled) |

Kafka is configured in `application.yml` using the `KAFKA_BOOTSTRAP_SERVERS` environment variable (set to `kafka:9094` inside Docker, `localhost:9092` locally).

## Database integration

### With `--database postgres`

- `MessageRepository` extends `JpaRepository<Message, Long>`
- Flyway migration at `db/migration/V1__create_messages.sql` creates the `messages` table
- `DATABASE_URL`, `DB_USERNAME`, and `DB_PASSWORD` environment variables are read from the Docker Compose environment
- Connection pool configured for local development (max 5 connections)

### With `--database postgres-redis`

All of the above, plus:

- `MessageService` is annotated with `@Cacheable(value = "messages")` on reads
- `@CacheEvict(value = "messages", allEntries = true)` on writes
- Redis cache is configured via `REDIS_URL` environment variable
- Cache hits/misses are visible in the Grafana JVM dashboard under custom metrics

### With `--database none`

The JPA, Flyway, and repository layers are omitted entirely. The app runs without any database dependency.

## Observability

### Distributed tracing

The Dockerfile copies the OpenTelemetry Java agent JAR into the image and adds `-javaagent:/otel-agent.jar` via `JAVA_TOOL_OPTIONS`. This instruments all HTTP requests, Kafka produces/consumes, and JDBC queries automatically. Traces are exported to Jaeger at `http://jaeger:4318` (OTLP/HTTP).

Open Jaeger at `http://localhost:16686` and search for service `<project-name>-backend` to see traces.

### Metrics

Spring Actuator exposes Prometheus-format metrics at `/actuator/prometheus`. Prometheus scrapes this endpoint every 15 seconds. Pre-built Grafana dashboards display:

- JVM heap usage, GC pause times, thread count
- HTTP request rate, latency percentiles (p50/p95/p99), error rate
- Kafka consumer lag
- Cache hit/miss ratio (with Redis)

### Logs

All container logs are collected by Promtail and shipped to Loki. Logs are queryable in Grafana using LogQL or through the Dashboard's Logs tab with full-text search.

## CI/CD pipeline (Jenkinsfile)

The generated `backend/Jenkinsfile` defines a declarative pipeline with these stages:

```groovy
pipeline {
  stages {
    stage('Checkout') { ... }   // git checkout from local path
    stage('Build')    { ... }   // ./gradlew build
    stage('Test')     { ... }   // ./gradlew test (JUnit results published)
    stage('Docker')   { ... }   // docker build -t localhost:5050/<name>:<build>
    stage('Push')     { ... }   // docker push localhost:5050/<name>:<build>
  }
}
```

Trigger a build from the CLI:

```bash
blissful-infra jenkins build my-app
```

## Development workflow

For the fastest inner loop when editing backend code, use Spring Boot DevTools mode:

```bash
cd my-app
blissful-infra dev
# Starts Spring Boot DevTools: saves trigger JVM restart in ~2-3 seconds
```

Template development (editing the template source itself) is currently
supported via the repo's `dev.sh` script, see the [Contributing
section](https://github.com/cavanpage/blissful-infra#contributing) of the
README for the current workflow.
