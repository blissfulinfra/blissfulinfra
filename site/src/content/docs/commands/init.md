---
title: blissful-infra init
description: Walk through setting up your first tenant, project and service, and bring it all up. The fastest path from install to a running stack.
---

`init` is the guided wizard. It creates a tenant, a project and your first service, then starts everything.

```bash
blissful-infra init
```

## Options

| Flag | What it does |
|---|---|
| `-y`, `--skip-prompts` | Accept all defaults: creates tenant `dev`, project `main` and a `spring-boot` backend service called `api`, then starts everything |
| `--no-start` | Scaffold only; skip the `tenant up` at the end |

## What it does

1. Creates a tenant, which owns Jenkins and the observability stack (Prometheus, Grafana, Tempo, Loki)
2. Creates a project inside it, which owns Kafka, Postgres and the API gateway on an isolated Docker network
3. Adds a service to the project, with its own Postgres schema
4. Runs `tenant up` to bring the infrastructure online, unless you passed `--no-start`

## Non-interactive

```bash
blissful-infra init -y
```

Equivalent to:

```bash
blissful-infra tenant create dev
blissful-infra project create main
blissful-infra service add api --type backend --template spring-boot
blissful-infra tenant up
```

Use this in scripts or when you just want something running to poke at.

## Scaffolding without starting

```bash
blissful-infra init --no-start
```

Useful when you want to read the generated compose files, or edit the service source, before anything boots.

## After init

```bash
blissful-infra status          # what exists and whether it is healthy
blissful-infra dashboard up    # the web UI at localhost:3002
```

## See also

- [`use`](/commands/use): set a persistent tenant/project context
- [`tenant`](/commands/tenant): manage tenants directly
- [`project`](/commands/project): manage projects directly
- [`service`](/commands/service): add and run services
