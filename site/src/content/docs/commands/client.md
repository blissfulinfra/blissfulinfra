---
title: blissful-infra client
description: Manage isolated client environments, each one its own Kafka, Postgres, Jenkins, and observability stack.
---

`blissful-infra client` manages isolated **client environments**. Each
client is a fully self-contained stack, its own Kafka, Postgres, Jenkins,
Prometheus, Grafana, Tempo, Loki, and dashboard, running on its own
Docker network with its own port block.

This is the path to take when you need multiple environments isolated from
each other (multiple real client projects, separate dev/staging/prod
sandboxes, or just keeping experiments out of your main work). For a
single-project quickstart, see
[`blissful-infra start`](/commands/start) instead.

For the architectural rationale see [Client model](/guides/client-model).

## Subcommands

| Subcommand | Purpose |
|---|---|
| `client create <name>` | Provision a new client environment + bring infra up |
| `client list` | List all client environments and their status |
| `client up <name>` | Start a stopped client (infra + all its services) |
| `client down <name>` | Stop a client (containers stay, can be re-upped) |
| `client status <name>` | Show all containers + their state |
| `client infra add <client> <component>` | Enable an infra component on an existing client |
| `client infra remove <client> <component>` | Disable an infra component on an existing client |
| `client remove <name>` | Tear down completely (containers, networks, volumes, dirs, registry entry) |
| `client clean` | Remove **all** client environments (with confirmation) |

## `client create`

```bash
blissful-infra client create <name> [options]
```

Creates a new client at `~/.blissful-infra/clients/<name>/`, allocates a
deterministic port block from `~/.blissful-infra/registry.json`, generates
the infra Compose file, and brings everything up.

### Options

| Flag | Description |
|---|---|
| `-y, --yes` | Skip the interactive infrastructure-components prompt and use defaults |
| `--no-jenkins` | Skip Jenkins (faster create, first Jenkins build takes ~2 min) |
| `--no-kafka` | Skip Kafka |
| `--no-observability` | Skip Prometheus, Grafana, Tempo, Loki |

### Interactive mode

Run without `--yes` to be walked through the choice of infra components:

```bash
blissful-infra client create acme-corp
```

```text
? Infrastructure components (space to toggle, enter to confirm)
> ◉ Kafka
  ◉ Postgres
  ◉ Jenkins (CI/CD)
  ◉ Prometheus + Grafana (metrics)
  ◉ Tempo (tracing, ADR-0016)
  ◉ Loki + Promtail (logs)
  ◯ ClickHouse warehouse (ADR-0008)
```

After the infra is up, you'll be asked if you want to add a service
immediately. Pick "yes" for the common single-service-per-client case;
pick "no" if you want to add multiple services manually.

### Example URLs after `client create acme-corp`

The exact ports depend on which port block is allocated (each client gets
the next free block). For block 0 you'd see:

| Service | URL |
|---|---|
| Jenkins | <http://localhost:8090> (admin / admin) |
| Grafana | <http://localhost:3010> (metrics, logs, traces all in one UI) |
| Prometheus | <http://localhost:9090> |
| Tempo | <http://localhost:3200> (or use Grafana's trace explorer) |
| Dashboard | <http://localhost:3002> |
| Kafka | localhost:9094 |
| Postgres | localhost:5432 |

Subsequent clients get block 1 (`+1` to every port), block 2 (`+2`), and so on.

## `client list`

```bash
blissful-infra client list
```

```text
Client environments:

  acme-corp  running  (ports: 8090+)
  globex-inc stopped  (ports: 8091+)
```

The "ports: NNNN+" indicates the start of the client's port block, every
service in the client uses ports offset from this base.

## `client up` / `client down` / `client status`

Standard lifecycle:

```bash
blissful-infra client up acme-corp     # start everything
blissful-infra client down acme-corp   # stop everything
blissful-infra client status acme-corp # one `docker compose ps` view
```

Because all services in a client share one Docker Compose project (see
[ADR-0003](https://github.com/cavanpage/blissful-infra/blob/main/docs/adr/0003-unified-compose-project-per-client.md)),
these commands operate on the unified project, no per-service iteration.

## `client infra add` / `client infra remove`

Toggle a client-level infrastructure component on a client that already
exists, without recreating it. Useful when a service you add later (or a
plugin you wire up) needs an infra component you didn't enable up front.

```bash
blissful-infra client infra add acme-corp localstack
blissful-infra client infra add acme-corp keycloak
blissful-infra client infra remove acme-corp mage
```

Components: `kafka`, `postgres`, `jenkins`, `clickhouse`, `localstack`,
`keycloak`, `mlflow`, `mage`, `prometheus`, `grafana`, `tempo`, `loki`.
(`jaeger` is also accepted as a deprecated alias for `tempo`; see [ADR-0016](https://github.com/cavanpage/blissful-infra/blob/main/docs/adr/0016-tempo-replaces-jaeger.md).)

The command edits `~/.blissful-infra/clients/<client>/blissful-infra.yaml`
in place. It does **not** restart anything, run
`blissful-infra client up <client>` afterwards to regenerate the Compose
file and bring the new container(s) online.

`service add` will offer to enable any required components automatically
when scaffolding a service that needs them, see
[`service add`](/commands/service) for the prompt-driven flow.

## `client remove`

```bash
blissful-infra client remove acme-corp
```

Stops containers, removes the Docker network and volumes, deletes
`~/.blissful-infra/clients/acme-corp/`, and removes the registry entry.
Destructive, make sure you've backed up anything from the postgres or
localstack volumes you want to keep.

## `client clean`

```bash
blissful-infra client clean       # interactive: lists all clients, asks to confirm
blissful-infra client clean -f    # skip confirmation
```

Calls `client remove` on every registered client. Useful for resetting your
machine to a clean state.

## Where things live

| Resource | Location |
|---|---|
| Client directories | `~/.blissful-infra/clients/<client>/` |
| Port allocation registry | `~/.blissful-infra/registry.json` |
| Per-client infra Compose | `~/.blissful-infra/clients/<client>/docker-compose.infra.yaml` |
| Service directories | `~/.blissful-infra/clients/<client>/<service>/` |

The location is overridable for testing via the `BLISSFUL_HOME` environment
variable.

## Adding services

Once a client is up, add services to it with
[`blissful-infra service add`](/commands/service).
