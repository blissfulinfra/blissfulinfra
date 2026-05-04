---
title: blissful-infra service
description: Add and manage services within a client environment.
---

`blissful-infra service` manages **services** inside a [client
environment](/commands/client). A service is your application (backend,
optional frontend, optional plugins like LocalStack) attached to the
client's shared infrastructure (Kafka, Postgres, Jenkins, observability).

A client typically holds one to a handful of related services that share
the same infra and Docker network.

## Subcommands

| Subcommand | Purpose |
|---|---|
| `service add <client> <service>` | Scaffold a new service inside a client |
| `service up <client> <service>` | Start the service (within the client's unified Compose project) |
| `service down <client> <service>` | Stop and remove the service's containers |
| `service logs <client> <service>` | Tail logs for the service |

## `service add`

```bash
blissful-infra service add <client> <service> [options]
```

Scaffolds the service from templates, regenerates the client's infra Compose
to include it via the unified-project pattern (see
[ADR-0003](https://github.com/cavanpage/blissful-infra/blob/main/docs/adr/0003-unified-compose-project-per-client.md)),
and brings the service up.

### Options

| Flag | Description |
|---|---|
| `-b, --backend <name>` | Backend framework. Choices: `spring-boot`, `lambda-python`, `none`. Default: `spring-boot`. |
| `-f, --frontend <name>` | Frontend framework. Choices: `react-vite`, `none`. Default: prompted (no default). |
| `-p, --plugins <list>` | Comma-separated **service-scoped** plugins. Default-prompt choices: `gatling`, `ai-pipeline`, `scraper`, `agent-service`. |

:::caution[localstack/keycloak/clickhouse/mlflow/mage are now client-level]
These were per-service plugins originally. They've been promoted to
**client-level infrastructure** (ADRs [0008](https://github.com/cavanpage/blissful-infra/blob/main/docs/adr/0008-clickhouse-as-client-level-warehouse.md),
[0009](https://github.com/cavanpage/blissful-infra/blob/main/docs/adr/0009-keycloak-as-client-level-iam.md),
[0010](https://github.com/cavanpage/blissful-infra/blob/main/docs/adr/0010-decompose-ai-pipeline-plugin.md)). Enable them on
`client create` (interactive checkbox or `infrastructure.<name>: true` in
the client config). They no longer appear in the `service add` prompt.

You *can* still pass them as `--plugins <name>` for a service-scoped
instance (backward compat for advanced users who want strong test
isolation between services), but the recommended path is client-level.
:::

If a flag is omitted in interactive mode, you'll be prompted for it. Pass
all three flags to skip prompts entirely.

### Interactive mode

```bash
blissful-infra service add dev app
```

```text
? Backend framework  (Use arrow keys)
> spring-boot
  lambda-python
  none

? Frontend framework
> react-vite
  none

  Tip: localstack, keycloak, clickhouse, mlflow, mage are now client-level — enable on `client create`, not here.

? Service-scoped plugins (space to toggle)
> ◯ ai-pipeline
  ◯ scraper
  ◯ agent-service
  ◯ gatling
```

### Non-interactive mode (CI / scripts)

```bash
blissful-infra service add dev app \
  --backend spring-boot \
  --frontend react-vite \
  --plugins localstack
```

### Per-service host ports

Each service in a client gets a deterministic port block, allocated from
`13000 + (clientBlockIndex × 100) + (serviceIndex × 4)`. For the first
service of the first client (block 0):

| Container | Host port |
|---|---|
| `<client>-<service>-backend` | 13000 |
| `<client>-<service>-frontend` | 13001 |
| `<client>-<service>-localstack` (if plugin enabled) | 13002 |

The CLI prints the URLs after a successful `service add`.

## `service up`

```bash
blissful-infra service up <client> <service>
```

Starts only the named service's containers within the client's unified
Compose project. Useful when a single service has crashed or you want to
restart just one component without affecting the rest.

## `service down`

```bash
blissful-infra service down <client> <service>
```

Stops and removes the service's containers (backend, frontend, localstack
if any). Other services in the client and the client's infra continue
running. The service config and source files stay on disk — you can re-up
with `service up`.

## `service logs`

```bash
blissful-infra service logs <client> <service>
```

Tails the last 100 log lines from all of the service's containers and
follows new output. `Ctrl+C` exits.

## Container naming

Services prefix their container names with `<client>-<service>-` so multiple
services in the same client (or across clients) never collide:

```text
dev-app-backend
dev-app-frontend
dev-app-localstack
acme-payment-backend
acme-payment-frontend
```

This naming is what `service logs` and `service up`/`down` filter on.

## Where things live

| Resource | Location |
|---|---|
| Service directory | `~/.blissful-infra/clients/<client>/<service>/` |
| Service config | `~/.blissful-infra/clients/<client>/<service>/blissful-infra.yaml` |
| Service Compose (included by parent) | `~/.blissful-infra/clients/<client>/<service>/docker-compose.yaml` |
| Backend source | `~/.blissful-infra/clients/<client>/<service>/backend/` |
| Frontend source | `~/.blissful-infra/clients/<client>/<service>/frontend/` |
