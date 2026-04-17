# Blissful Infra — Client Environment Model

## Vision

A solo developer or agency managing multiple client projects needs complete environment isolation — not just per-service isolation, but per-client isolation. Each client gets their own Jenkins, Kafka, Postgres, Grafana, and observability stack, all running locally in Docker with zero interference between clients.

Within a client environment, multiple services share that client's infrastructure. This mirrors how real engineering teams are structured: a platform team owns shared infrastructure, individual services plug into it.

---

## Mental Model

```
Client: acme-corp
├── Infrastructure (shared across all services)
│   ├── Jenkins         — CI/CD pipelines for all acme-corp services
│   ├── Kafka           — shared message bus
│   ├── Postgres        — shared instance, per-service schemas
│   ├── Prometheus      — scrapes all acme-corp services
│   ├── Grafana         — dashboards for all acme-corp services
│   └── ClickHouse      — metrics TSDB (Phase 8+)
│
├── Service: payment-service   (Spring Boot)
├── Service: storefront        (React + Spring Boot)
└── Service: notifications     (Spring Boot)

Client: globex-inc
├── Infrastructure (completely isolated from acme-corp)
│   ├── Jenkins
│   ├── Kafka
│   ├── Postgres
│   ├── Prometheus
│   └── Grafana
│
└── Service: inventory-api     (Spring Boot)
```

No resources are shared across clients. `acme-corp`'s Kafka and `globex-inc`'s Kafka are entirely separate containers on separate Docker networks.

---

## Config Schema

### Client config — `blissful-infra.yaml` (client root)

```yaml
# ~/.blissful-infra/clients/acme-corp/blissful-infra.yaml
type: client
name: acme-corp

infrastructure:
  kafka: true
  postgres: true
  jenkins: true
  observability:
    prometheus: true
    grafana: true
    jaeger: true
    loki: true
    clickhouse: false   # Phase 8+ — Flink + ClickHouse metrics pipeline

plugins: []             # client-level plugins (e.g. localstack for whole env)

deploy:
  target: local-only    # local-only | cloudflare | vercel | aws

services:
  - name: payment-service
    path: ./payment-service
  - name: storefront
    path: ./storefront
  - name: notifications
    path: ./notifications
```

### Service config — `blissful-infra.yaml` (service level)

```yaml
# ~/.blissful-infra/clients/acme-corp/payment-service/blissful-infra.yaml
type: service
name: payment-service
client: acme-corp       # parent client — inherits its infrastructure

backend: spring-boot
frontend: react-vite    # optional
plugins:
  - type: localstack
    instance: localstack
```

Services do not redeclare Kafka, Postgres, or Jenkins — they inherit these from the client. A service config only declares what is unique to that service: its backend/frontend template and any service-level plugins.

---

## Directory Layout

```
~/.blissful-infra/
└── clients/
    ├── acme-corp/
    │   ├── blissful-infra.yaml      # client config
    │   ├── docker-compose.infra.yaml  # shared infrastructure services
    │   ├── payment-service/
    │   │   ├── blissful-infra.yaml  # service config
    │   │   ├── docker-compose.yaml  # service containers
    │   │   └── backend/             # scaffolded Spring Boot app
    │   ├── storefront/
    │   │   ├── blissful-infra.yaml
    │   │   ├── docker-compose.yaml
    │   │   └── backend/
    │   └── notifications/
    │       ├── blissful-infra.yaml
    │       └── docker-compose.yaml
    └── globex-inc/
        ├── blissful-infra.yaml
        ├── docker-compose.infra.yaml
        └── inventory-api/
            ├── blissful-infra.yaml
            └── docker-compose.yaml
```

---

## Docker Compose Strategy

Two compose files per client:

### `docker-compose.infra.yaml` — shared infrastructure

Owned by the client. Contains Jenkins, Kafka, Zookeeper, Postgres, Prometheus, Grafana, Jaeger, Loki, Promtail. Creates the client's Docker network: `{client-name}_infra`.

```yaml
# docker-compose.infra.yaml (acme-corp)
networks:
  infra:
    name: acme-corp_infra

services:
  kafka:
    image: confluentinc/cp-kafka:7.6.0
    networks: [infra]
    # ...

  postgres:
    image: postgres:16
    networks: [infra]
    # ...

  jenkins:
    image: blissful-infra-jenkins:latest
    networks: [infra]
    # ...

  prometheus:
    image: prom/prometheus:v2.51.2
    networks: [infra]
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    # prometheus.yml scrapes all service backends via DNS on infra network
```

### `docker-compose.yaml` — service containers

Each service has its own compose file. Services join the client's shared `infra` network as an **external** network — they do not create it, they join it.

```yaml
# docker-compose.yaml (payment-service)
networks:
  infra:
    external: true
    name: acme-corp_infra   # injected at scaffold time

services:
  backend:
    build: ./backend
    networks: [infra]
    environment:
      KAFKA_BOOTSTRAP_SERVERS: kafka:9092    # resolves via infra network
      DATABASE_URL: jdbc:postgresql://postgres:5432/payment_service
    # ...

  frontend:
    build: ./frontend
    networks: [infra]
    # ...
```

Because all services join the same `infra` network, they can reach Kafka at `kafka:9092`, Postgres at `postgres:5432`, and Jaeger at `jaeger:4318` — using the same service names regardless of which service they belong to.

---

## CLI Commands

### Client management

```bash
# Create a new client environment (provisions shared infra, starts all containers)
blissful-infra client create <client-name> [options]
  --no-jenkins          Skip Jenkins
  --no-kafka            Skip Kafka
  --no-observability    Skip Prometheus/Grafana/Jaeger/Loki

# List all client environments
blissful-infra client list

# Start a stopped client environment (infra + all services)
blissful-infra client up <client-name>

# Stop a client environment
blissful-infra client down <client-name>

# Show client status (infra health + all services)
blissful-infra client status <client-name>

# Remove a client environment entirely
blissful-infra client remove <client-name>
```

### Service management

```bash
# Add a service to an existing client
blissful-infra service add <client-name> <service-name> [options]
  --backend spring-boot|fastapi|express
  --frontend react-vite|nextjs
  --plugins localstack,keycloak,...

# Start/stop a single service within a client
blissful-infra service up <client-name> <service-name>
blissful-infra service down <client-name> <service-name>

# Logs for a specific service
blissful-infra service logs <client-name> <service-name>
```

### Backwards compatibility

The current `blissful-infra start <name>` command is preserved. Under the hood it creates a client with the same name containing a single service. Existing projects continue to work without modification. The flat model is a degenerate case of the client model.

---

## Infrastructure Provisioning

When `blissful-infra client create acme-corp` runs:

1. Create `~/.blissful-infra/clients/acme-corp/` directory
2. Write `blissful-infra.yaml` (client config)
3. Generate `docker-compose.infra.yaml` from declared infrastructure
4. Generate `prometheus.yml` with empty scrape targets (populated as services are added)
5. Generate Grafana provisioning config (datasources, dashboard paths)
6. Generate Jenkins config — scoped to this client
7. Start infra: `docker compose -f docker-compose.infra.yaml up -d`
8. Wait for healthchecks
9. Print access URLs:
   ```
   acme-corp environment ready

   Jenkins:    http://localhost:8091   (admin / admin)
   Grafana:    http://localhost:3011
   Prometheus: http://localhost:9091
   Jaeger:     http://localhost:16691
   ```

Port allocation is discussed below.

---

## Port Allocation

Each client gets a port block. The CLI tracks assigned blocks in `~/.blissful-infra/registry.json`.

| Service | Block offset | acme-corp (block 0) | globex-inc (block 1) |
|---|---|---|---|
| Jenkins | +0 | 8090 | 8091 |
| Grafana | +1 | 3010 | 3011 |
| Prometheus | +2 | 9090 | 9091 |
| Jaeger UI | +3 | 16680 | 16681 |
| Kafka | +4 | 9094 | 9095 |
| Postgres | +5 | 5432 | 5433 |
| Dashboard | +6 | 3002 | 3003 |

Services within a client communicate on the internal `infra` network (no host ports needed for inter-service communication). Only the UI/access ports are exposed to the host.

---

## Prometheus Scrape Config

When a service is added to a client, `prometheus.yml` in the client's infra directory is updated to add a new scrape target:

```yaml
scrape_configs:
  - job_name: "acme-corp-payment-service"
    metrics_path: /actuator/prometheus
    static_configs:
      - targets: ["payment-service-backend:8080"]

  - job_name: "acme-corp-storefront"
    metrics_path: /actuator/prometheus
    static_configs:
      - targets: ["storefront-backend:8080"]
```

Prometheus is then sent a `/-/reload` signal to pick up the new config without restart.

---

## Jenkins Scope

Each client gets its own Jenkins instance. Jenkins knows about all services within that client — it can trigger cross-service builds and has a unified view of that client's CI/CD.

The Jenkinsfile template is unchanged. The Jenkins URL injected into each service's pipeline points to the client's Jenkins instance (resolved via the infra network at `jenkins:8080`).

---

## Dashboard Changes

The blissful-infra dashboard at `localhost:3002` gains a top-level client selector. The current project list becomes a service list scoped to the selected client.

```
┌─────────────────────────────────────────┐
│  blissful-infra          [acme-corp ▼]  │
├─────────────────────────────────────────┤
│  Services          │  payment-service   │
│  ─────────         │  storefront        │
│  payment-service   │  notifications     │
│  storefront        │                    │
│  notifications     │  [Deployments]     │
│                    │  [Metrics]         │
│                    │  [Logs]            │
└─────────────────────────────────────────┘
```

The API server (`packages/cli/src/server/api.ts`) gains client-scoped endpoints:

```
GET  /api/clients                              List all clients
GET  /api/clients/:client                      Client details + infra health
GET  /api/clients/:client/services             List services in client
POST /api/clients/:client/services             Add a service
GET  /api/clients/:client/services/:service    Service details
```

Existing `/api/projects` endpoints remain for backwards compatibility.

---

## Migration Path

Existing projects created with the current flat model are treated as single-service clients. The registry migration:

1. For each entry in the existing project registry, create a client with the same name
2. The project's containers become the single service within that client
3. The project's `blissful-infra.yaml` gets `type: service` and `client: <name>` added
4. A minimal `docker-compose.infra.yaml` is generated from the existing compose file (extracting Kafka, Postgres, etc.)

This migration runs automatically on first `blissful-infra` invocation after upgrading, or manually via `blissful-infra migrate`.

---

## Implementation Phases

### Phase A — Client model foundation
- `ClientConfigSchema` in `packages/shared/src/schemas/config.ts`
- `ServiceConfigSchema` replacing / extending `ProjectConfigSchema`
- `blissful-infra client create` command
- `docker-compose.infra.yaml` generation
- External network wiring in service compose files
- Port allocation registry

### Phase B — Service management
- `blissful-infra service add` command
- Dynamic Prometheus scrape config update on service add
- Jenkins job registration scoped to client

### Phase C — Dashboard
- Client selector in dashboard UI
- Client-scoped API endpoints
- Infra health panel (shows Jenkins/Kafka/Postgres/Grafana status per client)

### Phase D — Migration
- `blissful-infra migrate` command
- Backwards-compatible `start` command shim

---

## Key Design Decisions

- **Full isolation by default** — no shared infrastructure between clients, ever. Docker networks enforce this at the OS level.
- **Backwards compatibility** — `blissful-infra start` continues to work. The flat model is the single-service-client degenerate case.
- **Prometheus is dynamic** — scrape targets are added/removed as services come and go. No restart required.
- **Jenkins is per-client** — not global. A client's Jenkins only knows about that client's services.
- **Port blocks** — deterministic port assignment prevents conflicts when running multiple clients simultaneously.
- **Observability is project-scoped** — each client has its own Grafana/Prometheus/Jaeger stack. No cross-client metric visibility (by design for client confidentiality).
