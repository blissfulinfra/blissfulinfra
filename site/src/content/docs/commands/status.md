---
title: blissful-infra status
description: Context-aware status across tenants, projects and services, with live health.
---

`status` shows what exists and whether it is running. What it prints depends on your [`use`](/commands/use) context.

```bash
blissful-infra status
```

## Usage

```bash
blissful-infra status [name]
```

| Argument | Effect |
|---|---|
| *(omitted)* | Scoped to your current context |
| `<name>` | Show that tenant, one-shot — your context is not changed |

## What it shows

| With no context set | With a tenant set | With tenant/project set |
|---|---|---|
| All tenants and whether they are up | That tenant's projects, services and port block | That project's services with live health |

Live health means the CLI actually probes each service, so a container that is running but failing its health check shows as unhealthy rather than up.

## Examples

```bash
blissful-infra status                # whatever your context covers
blissful-infra status acme           # one-shot look at another tenant
```

Because `[name]` does not change your context, you can check on another tenant mid-task without having to `use` your way back.

## Finding your ports

Ports are allocated deterministically per tenant and project index, so they are predictable but not memorable. `status` is the fastest way to see what a given tenant actually got — Grafana, Jenkins, Kafka, Postgres, the gateway, and each service's HTTP port.

## See also

- [`use`](/commands/use) — set the context this command reads
- [`tenant`](/commands/tenant) — `tenant status` for tenant detail
- [`project`](/commands/project) — `project status` for project detail
- [`dashboard`](/commands/dashboard) — the same information, live, in a browser
