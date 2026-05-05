---
title: The client model
description: How to manage multiple isolated environments, each its own Kafka, Postgres, Jenkins, and observability stack.
---

The **client model** is blissful-infra's way of running multiple isolated
environments on one machine. Each *client* is a fully self-contained stack
with its own Kafka, Postgres, Jenkins, and observability, running on its
own Docker network, with its own port block.

Within a client, multiple **services** share that client's infrastructure.
This mirrors how engineering teams structure real platforms: a platform
team owns the shared infra, individual product teams plug services into it.

## When to use it

Use the client model when:

- You're a solo developer or small agency managing **multiple client
  projects** and want each completely isolated
- You want **separate dev / staging / prod sandboxes** for the same project
- You're building a **multi-tenant platform** and want to dogfood
  per-tenant isolation locally
- You hit port conflicts running multiple `blissful-infra start` projects

For a brand-new single project where you just want to try things out,
[`blissful-infra start`](/commands/start) is still the right entrypoint.
The two models coexist.

## Mental model

```text
Client: acme-corp
├── Infrastructure (shared across this client's services)
│   ├── Jenkins        : CI/CD for all acme-corp services
│   ├── Kafka          : shared message bus
│   ├── Postgres       : shared instance, per-service schemas
│   ├── Prometheus     : scrapes all acme-corp services
│   ├── Grafana        : dashboards for all acme-corp services
│   └── Tempo / Loki   : traces and logs (both viewed in Grafana)
│
├── Service: payment-service   (Spring Boot)
├── Service: storefront        (React + Spring Boot)
└── Service: notifications     (Spring Boot)

Client: globex-inc
├── Infrastructure (completely isolated from acme-corp)
│   ├── Jenkins
│   ├── Kafka
│   ├── Postgres
│   ├── Prometheus / Grafana / Tempo / Loki
│
└── Service: inventory-api     (Spring Boot)
```

**No resources are shared across clients.** `acme-corp`'s Kafka and
`globex-inc`'s Kafka are entirely separate containers on entirely separate
Docker networks. Cross-client traffic is impossible. Docker enforces this
at the OS level.

## Quick start

```bash
# Create a client environment with default infrastructure
blissful-infra client create acme-corp

# Add a service to it
blissful-infra service add acme-corp api --backend spring-boot --frontend react-vite

# Lifecycle
blissful-infra client up acme-corp     # bring everything up
blissful-infra client status acme-corp # see what's running
blissful-infra client down acme-corp   # stop everything
blissful-infra client remove acme-corp # destructive: full teardown
```

See [`client`](/commands/client) and [`service`](/commands/service) for full
command references.

## Topology, one Compose project per client

All of a client's containers (infra + every service) live under **one
Docker Compose project**, named after the client. The CLI achieves this
via the Compose `include:` directive, service-specific Compose files are
merged into the client's parent Compose file at runtime.

```text
docker-compose.infra.yaml  (name: acme-corp)
├── kafka, postgres, jenkins, grafana, prometheus, tempo, loki, dashboard
├── include:
│   ├── ./payment-service/docker-compose.yaml
│   ├── ./storefront/docker-compose.yaml
│   └── ./notifications/docker-compose.yaml
```

Run `docker compose ls` and you see one row per client, not one per
service. Run `docker compose ps` from the client directory and you see all
containers (infra + services) together. This is the single-namespace
property that makes the client model practical day-to-day.

The architectural rationale is captured in
[ADR-0003](https://github.com/cavanpage/blissful-infra/blob/main/docs/adr/0003-unified-compose-project-per-client.md).

## Port allocation

Each client gets a **port block**, allocated deterministically from
`~/.blissful-infra/registry.json`. The first client gets block 0, the
second block 1, etc. Within a block:

| Service | Block 0 (acme-corp) | Block 1 (globex-inc) |
|---|---|---|
| Jenkins | 8090 | 8091 |
| Grafana | 3010 | 3011 |
| Prometheus | 9090 | 9091 |
| Tempo (HTTP API) | 3200 | 3201 |
| Kafka | 9094 | 9095 |
| Postgres | 5432 | 5433 |
| Dashboard | 3002 | 3003 |

Each service inside a client gets host ports starting at
`13000 + (blockIndex × 100) + (serviceIndex × 4)`:

| Service | block 0, svc 0 | block 0, svc 1 | block 1, svc 0 |
|---|---|---|---|
| backend | 13000 | 13004 | 13100 |
| frontend | 13001 | 13005 | 13101 |
| localstack | 13002 | 13006 | 13102 |

Multiple clients can run simultaneously on one laptop without manual port
juggling. If a port in a block is already taken (e.g. by a flat-model
project), the CLI bumps to the next free block automatically.

## Filesystem layout

```text
~/.blissful-infra/
├── registry.json                      # port allocation across all clients
└── clients/
    └── acme-corp/
        ├── blissful-infra.yaml         # client config (type: client)
        ├── docker-compose.infra.yaml   # generated; includes all services
        ├── prometheus/                 # per-client config
        ├── grafana/
        ├── loki/
        ├── payment-service/
        │   ├── blissful-infra.yaml     # service config (type: service)
        │   ├── docker-compose.yaml     # included by parent
        │   ├── backend/                # source
        │   ├── frontend/
        │   └── localstack/             # plugin (if enabled)
        └── storefront/
            └── ...
```

## Trade-offs

The client model isn't free. Each client adds ~12 containers (infra +
service variants), so a laptop comfortably runs 1–2 clients but starts to
strain at 3+. For lightweight experimentation use
[`blissful-infra start`](/commands/start) instead.

| Model | When |
|---|---|
| Flat (`start`) | One project, fastest spin-up, lowest RAM |
| Client (`client create`) | Multiple isolated projects, real per-tenant isolation |

## Limitations / open work

- **`blissful-infra dev`** (template hot-reload) is still flat-model only
  the client model uses production-style Dockerfiles. Hot reload via
  Spring DevTools volume mounts is queued as a `--dev` flag.
- **Client-aware dashboard**: the dashboard has been partially taught the
  client model (URLs, port discovery via `/api/v1/links`, service listing
  via `CLIENT_NAME` env). A multi-client selector is not yet shipped, you
  see one client per dashboard instance.
- **Multi-environment per client** (e.g. `acme/staging` vs `acme/prod`): not
  built yet. Today, run them as separate clients (`acme-staging`,
  `acme-prod`) for full isolation.

## Related

- [ADR-0002, Per-client isolation model](https://github.com/cavanpage/blissful-infra/blob/main/docs/adr/0002-per-client-isolation-model.md)
- [ADR-0003, Unified Compose project per client](https://github.com/cavanpage/blissful-infra/blob/main/docs/adr/0003-unified-compose-project-per-client.md)
- [Spec. Client model](https://github.com/cavanpage/blissful-infra/blob/main/specs/client-model.md)
- [Command reference, `client`](/commands/client)
- [Command reference, `service`](/commands/service)
