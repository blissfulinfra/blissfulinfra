---
title: Deliver path
description: For small studios and indie teams running several projects at once. Isolated per-tenant stacks with their own Kafka, Postgres, observability and CI, all on one laptop.
---

This path is for small software studios, freelance engineers and indie teams shipping work for several customers in parallel. Every engagement deserves its own stack, but stacking up SaaS subscriptions per customer (Vercel + Supabase + Auth0 + Datadog × N) gets expensive and messy fast.

blissful-infra runs a fully isolated, production-shaped stack for each one on a single laptop, free, with the same tooling everywhere.

## The model

Each **tenant** is a fully isolated environment with its own:

- Jenkins server
- Prometheus, Grafana, Tempo and Loki, with one Grafana UI over all of them
- Port block, so nothing collides with any other tenant
- Optionally, its own Kubernetes cluster

Inside a tenant you create **projects**, one per domain, each owning its own Kafka, Postgres, API gateway and Docker network. Inside those you add **services**.

```bash
blissful-infra tenant create acme-corp
blissful-infra tenant up

blissful-infra use acme-corp
blissful-infra project create storefront
blissful-infra service add api --type backend
blissful-infra service add web --type frontend

blissful-infra status
```

[The tenant model](/guides/tenant-model) · [`tenant`](/commands/tenant) · [`project`](/commands/project) · [`service`](/commands/service)

## Why this beats SaaS-per-customer

| Concern | Per-customer SaaS | blissful-infra |
|---|---|---|
| Cost per customer | Stacks of subscriptions × N | $0 locally |
| Onboarding a new one | Provision N services by hand | One command |
| Tearing down a finished engagement | Cancel N subscriptions and hope you got them all | `tenant remove` |
| Reproducibility for the next dev | "Hope you have the same plan tier" | Recreate from the same commands |
| Vendor lock-in | High | None, open source underneath |

## Practical workflow

**Isolation is structural, not conventional.** Two tenants can both have a project called `main` with a service called `api`. Separate Docker networks, separate volumes, separate port blocks derived from the tenant index. Nothing collides and nothing leaks.

**Per-tenant observability.** Each tenant has its own Grafana, its own dashboards and its own retention. Useful when one customer wants 30 days of logs and another wants 7.

**One dashboard over all of them.** The dashboard is host-level: a single UI at `localhost:3002` with a tenant switcher, so you get the cross-tenant view without running N dashboards.

```bash
blissful-infra dashboard up
```

**Slim down per tenant.** Not every engagement needs the full stack:

```bash
blissful-infra tenant create small-job --no-jenkins --no-tempo
blissful-infra project create main --no-kafka --no-redis
```

## Capacity

A tenant holds up to 10 projects, and a project up to 20 services. Ports are derived rather than assigned, so the limits exist to keep the port blocks non-overlapping rather than because of any runtime constraint.

The practical limit is your laptop's RAM. The full stack for one tenant runs around 2-3 GB, so plan on running a couple of tenants at a time rather than ten.

## Where this goes next

The deliver path gets more powerful with:

- **Per-tenant resource visibility**: which tenant's stack is consuming what
- **Templated tenant onboarding**: a standard starter you scaffold per engagement
- **The studio layer**: a level above tenants for the organisation running them

These are on the roadmap and not yet built. If your studio depends on one, [open an issue](https://github.com/cavanpage/blissful-infra/issues) and it moves up.
