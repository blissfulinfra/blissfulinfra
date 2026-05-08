---
title: Learn path
description: A guided course that takes you from zero to a running Kubernetes service with Kafka, Postgres, and Keycloak. Understand each layer before reaching for a managed equivalent.
---

Not sure if this is the right path for you? Read [Start here](/paths/start-here) first — it routes you based on your background and what you want to do.

This path is for students, new grads, and anyone who wants enterprise-pattern fluency without paying for cloud while they learn.

The job market expects "experience with distributed systems" but very few entry-level roles will pay you to get it. blissful-infra exists so you can build that experience on a laptop, in your own time, without a credit card.

## What you'll build

By the end of this path you will have:

- A running full-stack service: Spring Boot API, React frontend, Postgres, Kafka, Redis cache
- Production-shaped observability: Prometheus metrics, Grafana dashboards, Loki logs, Tempo distributed tracing (click-through correlation between all three)
- A real CI/CD pipeline: Jenkins, multi-stage build, deploy on green
- An identity layer: Keycloak with realms, JWTs, role-based access
- AWS-shaped services running locally: LocalStack for S3, Lambda, SQS
- A Kubernetes deployment: your service running on a real cluster (kind), not just Compose

You will understand what each piece does, why it exists, and what tradeoffs the managed equivalent makes for you.

## Course modules

The course is being written. Modules below link to existing reference material where it covers the topic. Treat the order as the recommended reading path even before every module is fully written.

### Module 1: Your first stack

What `blissful-infra start` actually creates. A walkthrough of every container in the generated `docker-compose.yaml`, why it's there, and how the pieces talk.

[Getting started](/getting-started) · [`start` command](/commands/start) · [Templates overview](/templates/overview)

### Module 2: Anatomy of a service

How the generated backend is structured. REST endpoints, Kafka producer and consumer, Postgres repository layer, JPA entities, request lifecycle from HTTP in to event out.

[Spring Boot template](/templates/spring-boot) · [React + Vite template](/templates/react-vite)

*Course module: coming soon.*

### Module 3: Observability

Prometheus scrapes metrics. Loki collects logs. Tempo traces requests across services. Grafana visualizes all three in one UI, with click-through correlation. Why each is a separate tool, and what to use which one for.

*Course module: coming soon.*

### Module 4: CI/CD with Jenkins

The generated `Jenkinsfile`, what each stage does, how the pipeline tests and deploys. How blissful-infra wires Jenkins to your local Docker registry so deploys actually run.

[`jenkins` command](/commands/jenkins)

*Course module: coming soon.*

### Module 5: Identity with Keycloak

Realms, clients, users, roles. How a JWT gets issued, how your backend verifies it, and what changes if you swap Keycloak for Auth0 in production.

*Course module: coming soon.*

### Module 6: AWS-shaped services

LocalStack for S3, Lambda, and SQS. What the AWS API contract looks like, and why the same code runs against LocalStack and real AWS.

[Learn AWS for free with LocalStack](/blog/localstack-aws-locally) · [Lambda template](/templates/lambda-python) · [`lambda` command](/commands/lambda)

*Course module: coming soon.*

### Module 7: Kubernetes deploy

Take the same service and run it on a real Kubernetes cluster locally with [kind](https://kind.sigs.k8s.io/). Manifests, Services, Deployments, Ingress. The vocabulary and the mental model.

*Course module: coming soon.*

### Module 8: Multi-tenancy

Once you've built one service, the [client model](/guides/client-model) shows how to host many isolated environments side by side. Useful for multi-tenant apps, per-customer staging, or just keeping personal projects separate.

[Client model guide](/guides/client-model)

## Why hands-on, not managed

Many of the technologies in this course have excellent managed equivalents. The course teaches the open-source originals on purpose. Once you understand Keycloak you understand what Auth0 abstracts; once you understand Postgres you understand what RDS does for you. That mental model is the part that transfers.

[More on the philosophy](/philosophy)
