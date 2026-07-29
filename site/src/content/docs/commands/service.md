---
title: blissful-infra service
description: Manage services. atomic processes inside a project. Add backends, frontends and workers, then start, stop and tail them.
---

A **service** is one process inside a project: one container family, one bounded context, its own database schema.

```bash
blissful-infra service add orders --type backend
```

## Subcommands

| Command | What it does |
|---|---|
| `service add <name>` | Add a service to a project |
| `service up <name>` | Start a service |
| `service down <name>` | Stop a service |
| `service logs <name>` | Tail service logs |
| `service remove <name>` | Remove a service from a project |

Every subcommand accepts optional leading tenant and project arguments, so all three of these work:

```bash
blissful-infra service up orders               # tenant + project from context
blissful-infra service up shop orders          # project explicit
blissful-infra service up acme shop orders     # both explicit
```

## service add

| Flag | What it does |
|---|---|
| `-t`, `--type <type>` | `backend`, `frontend` or `worker` |
| `--template <name>` | Backend: `spring-boot`, `hono` or `lambda-python`. Frontend: `react-vite` |
| `--runtime <runtime>` | Worker language: `python`, `node` or `go` |
| `--no-database` | Skip the auto-allocated Postgres schema (backends and workers only) |
| `-y`, `--skip-prompts` | Skip prompts, accept defaults |

### Service types

| `--type` | Gets an HTTP port | Gets a DB schema | Notes |
|---|---|---|---|
| `backend` | yes | yes, unless `--no-database` | Also gets a metrics port |
| `frontend` | yes | no | |
| `worker` | no | yes, unless `--no-database` | Headless; pick a language with `--runtime` |

### Examples

```bash
# Spring Boot backend with its own Postgres schema
blissful-infra service add orders --type backend --template spring-boot

# React frontend
blissful-infra service add web --type frontend --template react-vite

# Python worker, no database
blissful-infra service add mailer --type worker --runtime python --no-database
```

## Database isolation

Every backend and worker gets its **own schema** on the project's shared Postgres instance, not a shared one. This is deliberate: it makes the DDD boundary structural rather than a convention people remember to follow. A service reaching into another service's tables has to work at it.

Pass `--no-database` when a service genuinely has no persistence.

On the kubernetes runtime, the database binding is currently stripped at scaffold time. There is no in-cluster Postgres yet.

## Lifecycle

```bash
blissful-infra service up orders
blissful-infra service logs orders
blissful-infra service down orders
```

On a `--runtime kubernetes` project, `service up` delegates to [`deploy`](/commands/deploy), which runs the full GitOps loop rather than starting a container directly.

## Ports

Services are allocated from a high range so they never collide with infrastructure: HTTP from 30000, metrics from 34000, offset by tenant, project and service index. `blissful-infra project status` prints what each service actually got.

## See also

- [`project`](/commands/project): the level above
- [`deploy`](/commands/deploy): ship a service to the kubernetes runtime
- [Templates overview](/templates/overview): what is inside each template
