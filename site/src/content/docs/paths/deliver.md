---
title: Deliver path
description: For small studios and indie teams running multiple client projects. Per-client isolated stacks with their own Kafka, Postgres, observability and CI — all on one laptop.
---

This path is for small software studios, freelance engineers and indie teams who ship work for several clients in parallel. Every client deserves their own stack, but spinning up SaaS subscriptions per client (Vercel + Supabase + Auth0 + Datadog × N clients) gets expensive and messy fast.

blissful-infra lets you run a fully isolated production-shaped stack for each client on one laptop, free, with the same tooling and workflows everywhere.

## The model

Each **client** is a fully isolated environment with its own:

- Kafka cluster
- Postgres + Redis
- Jenkins server
- Prometheus + Grafana + Loki + Jaeger
- Docker network — clients cannot see each other's data or services

Inside a client you add **services** — backend + frontend pairs, Lambda functions, ML pipelines. Services in the same client share infrastructure but each gets its own ports and own deploy lifecycle.

```bash
blissful-infra client create acme-corp
blissful-infra service add acme-corp api --backend spring-boot --frontend react-vite
blissful-infra service add acme-corp jobs --backend lambda-python

blissful-infra client up acme-corp
blissful-infra client status acme-corp
```

→ [Client model guide](/guides/client-model) · [`client` command](/commands/client) · [`service` command](/commands/service)

## Why this beats SaaS-per-client

| Concern | Per-client SaaS | blissful-infra client model |
|---|---|---|
| Cost per client | Stacks of subscriptions × N | $0 locally, deploys to your own cloud target |
| Onboarding new client | Provision N services manually | One command |
| Tearing down a finished engagement | Cancel N subscriptions, hope you got them all | `client remove` |
| Reproducibility for the next dev | "Hope you have the same plan tier" | `git clone && client up` |
| Vendor lock-in per client | High | None — all OSS underneath |

## Practical workflow

**One client, one git repository.** Each client's `blissful-infra.yaml` lives in their own repo. Commits include the config so the stack is reproducible. New devs run `client up` and get the exact same environment.

**Per-client deploy targets.** Different clients, different cloud preferences? `deploy.target: cloudflare` for one, `deploy.target: aws` for another. The CLI adapts; your workflow doesn't.

**Per-client observability.** Each client has its own Grafana with its own dashboards and its own retention policy. Useful when one client wants 30 days of logs and another wants 7.

**Shared dev machine, isolated state.** Two clients can both run a service called `api` without colliding — they're on separate Docker networks and the [client registry](/guides/client-model) allocates non-overlapping ports.

## Adding optional infrastructure per client

When a client opts into a particular stack component:

```yaml
# ~/.blissful-infra/clients/acme-corp/blissful-infra.yaml
infrastructure:
  keycloak: true       # client wants their own IdP
  localstack: true     # client uses S3 / SQS
  clickhouse: true     # client has analytics needs
  mlflow: true         # client trains ML models
```

`client up` brings up only what's enabled. Other clients on the same machine are unaffected.

## When you ship

```bash
cd ~/.blissful-infra/clients/acme-corp
blissful-infra deploy
```

The deploy adapter for the configured target (Cloudflare, Vercel, AWS) ships the services to the client's actual cloud. The local stack stays as your dev mirror.

→ [`deploy` command](/commands/deploy)

## Where this goes next

The deliver path gets a lot more powerful once you have:

- **Per-client billing visibility** — track which client's stack is using which resources locally
- **Templated client onboarding** — a `studio.yaml` that scaffolds your standard client starter
- **Cross-client dashboard** — one view across every client you run

These are on the roadmap. If your studio depends on any of them, [open an issue](https://github.com/cavanpage/blissful-infra/issues) and they will move up.
