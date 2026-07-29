---
title: Build path
description: One command chain to a production-grade local stack. Skip the theory, prototype now, dig deeper later.
---

This path is for engineers who already know what they're doing and just want a working stack now. You have an idea. You want to validate it before committing a weekend to it. You don't want to spend three hours wiring Postgres to a backend before writing a line of business logic.

## The fast loop

```bash
npm install -g @blissful-infra/cli
blissful-infra init -y
```

That's the whole setup. `init -y` creates a tenant, a project and a Spring Boot backend service, then brings everything up.

You now have:

- A backend service with REST, Kafka and its own Postgres schema wired in
- Grafana, Prometheus, Loki and Tempo running and pre-provisioned, with click-through correlation between metrics, logs and traces
- A Jenkins pipeline ready to build the service
- A management dashboard at `http://localhost:3002`

Run `blissful-infra status` to see the ports everything landed on.

[Quickstart](/getting-started) · [`init` command](/commands/init)

## Doing it deliberately

`init -y` is fine for a first look, but you will want to name things:

```bash
blissful-infra tenant create acme && blissful-infra tenant up
blissful-infra project create shop
blissful-infra use acme/shop

blissful-infra service add orders --type backend
blissful-infra service add web --type frontend
```

`use` sets a persistent context so you stop retyping coordinates.

## Pick your stack

| Backend | Best for |
|---|---|
| [`spring-boot`](/templates/spring-boot) | Long-running HTTP API, JPA + Postgres, Kafka producer and consumer, mature JVM observability |

Frontend is [React + Vite](/templates/react-vite). Workers come in Python, Node and Go. Other frameworks are deliberately out of scope until they're real — see [Philosophy](/philosophy).

```bash
blissful-infra service add orders --type backend --template spring-boot
blissful-infra service add web --type frontend --template react-vite
blissful-infra service add mailer --type worker --runtime python
```

## More than one thing at once

The hierarchy handles this by construction. A second project gets its own Kafka, Postgres, gateway and Docker network; a second tenant gets its own everything, including CI and observability.

```bash
blissful-infra project create billing      # separate domain, same tenant
blissful-infra tenant create other-co      # fully separate stack
```

Ports are derived from tenant and project index, so nothing collides no matter how many you run.

[The tenant model](/guides/tenant-model)

## Trimming what you don't need

The full stack is a lot to run if you only care about the app:

```bash
blissful-infra tenant create acme --no-jenkins --no-tempo --no-loki
blissful-infra project create shop --no-kafka --no-redis
```

## When you want to explore deployment

If the thing you're actually prototyping is the *delivery* pipeline — GitOps, canary rollouts, rollback semantics — switch a project to the Kubernetes runtime:

```bash
brew install kind kubectl hashicorp/tap/terraform argoproj/tap/kubectl-argo-rollouts
blissful-infra cluster up
blissful-infra project create shop --runtime kubernetes
blissful-infra deploy orders
```

[The golden path](/guides/golden-path)

## When to read the theory

If you hit something you don't understand — a Kafka consumer-group rebalance, a JPA cascade, a Prometheus histogram quantile — that's when the [Learn path](/paths/learn) becomes useful. The build path gets you running; the learn path explains why each piece looks the way it does.
