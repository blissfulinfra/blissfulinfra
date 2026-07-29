---
title: Learn path
description: A guided course that takes you from zero to a production-grade service with Kafka, Postgres, GitOps and observability. Understand each layer before reaching for a managed equivalent.
---

Not sure if this is the right path for you? Read [Start here](/paths/start-here) first. It routes you based on your background and what you want to do.

This path is for students, new grads and anyone who wants to understand how production systems actually work, without paying for cloud while they learn.

The job market expects "experience with distributed systems" but very few entry-level roles will pay you to get it. blissful-infra exists so you can build that experience on a laptop, in your own time, without a credit card.

By the time you finish this path you'll have run the same stack a 50-person engineering team would run. You'll understand why each piece exists, what it costs to operate at scale and what the managed equivalent does for you. That mental model is the part that transfers to any job.

## What you'll build

By the end of this path you will have:

- A running full-stack service: Spring Boot API, React frontend, Postgres, Kafka, Redis cache
- Production-shaped observability: Prometheus metrics, Grafana dashboards, Loki logs, Tempo distributed tracing (click-through correlation between all three)
- A real CI/CD pipeline: Jenkins, multi-stage build, deploy on green
- An identity layer: Keycloak with realms, JWTs, role-based access
- AWS-shaped services running locally: LocalStack for S3, Lambda, SQS
- Kubernetes deploy (planned): your service on a real local cluster with kind (coming in a later module)

You will understand what each piece does, why it exists and what tradeoffs the managed equivalent makes for you.

## Course modules

The course is being written. Modules below link to existing reference material where it covers the topic. Treat the order as the recommended reading path even before every module is fully written.

### Module 1: Your first stack

What `blissful-infra init` actually creates. The tenant / project / service hierarchy, a walkthrough of every container in the generated compose files, why each is there and how the pieces talk.

[Getting started](/getting-started) · [The tenant model](/guides/tenant-model) · [Templates overview](/templates/overview)

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

### Module 5: Isolation and the hierarchy

Why there are three levels rather than two, and how the model enforces domain boundaries structurally: a Postgres schema per service, a Docker network per project, a port block per tenant. What a distributed monolith looks like and how the constraints make it harder to build one by accident.

[The tenant model](/guides/tenant-model)

### Module 6: Kubernetes and GitOps

Take the same service and run it on a real local Kubernetes cluster. kind, provisioned by Terraform. ArgoCD reconciling the cluster against a git repo. Why GitOps means a rollback is a revert, and what ArgoCD's selfHeal does to an imperative `kubectl` change.

[The golden path](/guides/golden-path) · [`cluster`](/commands/cluster) · [`deploy`](/commands/deploy)

### Module 7: Progressive delivery

Argo Rollouts. Why a rolling update is not a canary, what a traffic weight actually does at the Service level, and how a pause turns a deploy into a decision point. Canary analysis, and what you need in place before it can be automated.

[`canary` command](/commands/canary) · [`rollback` command](/commands/rollback)

*Course module: coming soon.*

### Module 8: Identity and AWS-shaped services (not currently available)

Keycloak for realms, clients and JWTs; LocalStack for S3, Lambda and SQS. These plugins were removed in 2.0 along with the client model, so there is no working local setup to teach against right now.

The background reading still stands on its own: [A Developer's Guide to IAM](/blog/iam-guide) and [Learn AWS for free with LocalStack](/blog/localstack-aws-locally). Both were written against the pre-2.0 CLI, so treat their commands as historical.

## Why hands-on, not managed

Many of the technologies in this course have excellent managed equivalents. The course teaches the open-source originals on purpose. Once you understand Keycloak you understand what Auth0 abstracts; once you understand Kafka you understand what SQS trades away for simplicity; once you understand Postgres you understand what RDS does for you.

That mental model is the part that transfers. You can replace any component with a managed version in a day. Understanding why it exists and what it's doing. That takes hands-on time.

[More on the philosophy](/philosophy)
