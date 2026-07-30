---
title: Philosophy
description: Why blissful-infra runs real open-source services locally instead of bundling managed-service emulators or pushing you toward a paid tier.
---

blissful-infra is opinionated about a few things. Those opinions shape what gets built and what gets left out.

## Real services, not vendor emulation

Whenever a real open-source equivalent exists, blissful-infra runs the real thing. Keycloak for IAM, not a mock. Postgres for persistence, not an emulator. Kafka for events, not a shim. Prometheus for metrics, Grafana for visualization, ArgoCD for GitOps. The point is operational reality, not API surface memorization.

This matters because real services teach you what actually breaks at scale. Running Postgres locally exposes you to connection pooling, vacuum behavior and index bloat. The things you actually need to know. An emulator that mimics the wire protocol only teaches you what queries to write. You graduate to the managed equivalent later knowing what it's hiding from you.

**Note on AWS:** LocalStack used to be bundled to emulate AWS Lambda and S3 shapes locally, but the plugin system and client model that scaffolded it were removed in 2.0. AWS services are out of scope for the current architecture. If you're learning AWS patterns, using real AWS with a free-tier account and tight spend limits is the way to go.

## No paid tiers, no upsells

blissful-infra never bundles or recommends a paid tier. Not Datadog, not Confluent Cloud, not Auth0. The aim is "production-grade local infrastructure with zero ongoing cost." Anything that requires a license either has an open-source equivalent that ships instead, or stays out of scope until one exists.

This is a deliberate choice, not an ideological one. The audiences blissful-infra serves (students, working engineers experimenting with patterns, small studios) are the ones for whom paid tiers create friction. The free tier of an OSS tool you run yourself is more powerful for learning than the paid tier of a managed service you can't take apart.

## Managed services are great. Just not for learning.

This is the disclaimer that matters most.

Managed equivalents exist for almost everything blissful-infra runs locally:

| Local (OSS) | Managed equivalent |
|---|---|
| Keycloak | [Auth0](https://auth0.com/), [Okta](https://www.okta.com/), [Clerk](https://clerk.com/) |
| Postgres | [RDS](https://aws.amazon.com/rds/), [Cloud SQL](https://cloud.google.com/sql), [Supabase](https://supabase.com/) |
| Kafka | [Confluent Cloud](https://www.confluent.io/), [MSK](https://aws.amazon.com/msk/), [Redpanda Cloud](https://redpanda.com/) |
| Prometheus + Grafana + Loki | [Datadog](https://www.datadoghq.com/), [New Relic](https://newrelic.com/), [Honeycomb](https://www.honeycomb.io/) |
| ArgoCD (GitOps) | [Cloud CI/CD](https://aws.amazon.com/codepipeline/), [GitHub Actions](https://github.com/features/actions), [GitLab CI](https://about.gitlab.com/) |
| Jenkins | [GitHub Actions](https://github.com/features/actions), [CircleCI](https://circleci.com/), [GitLab CI](https://about.gitlab.com/) |

Those services are excellent. They're faster to start with, ship with built-in compliance and remove most of the operational burden. When you're a small team shipping a real product, reaching for one is often the right call. blissful-infra does not exist to argue against that.

What blissful-infra exists for is what comes *before* that decision. Most enterprise development happens on top of managed services that already exist when you arrive. You write business logic against a Cognito instance someone else provisioned, push to an EKS cluster someone else maintains. That setup is productive, but it hides the layers, and starting from a blank slate becomes intimidating. Where does authentication actually live? What is a service mesh actually doing? Why is Kafka different from a queue?

Running every layer yourself, even just locally, even just once, makes those questions concrete. When you do graduate to Auth0 you'll know what Keycloak does and what Auth0 charges you for instead. When you do graduate to RDS you'll know what Postgres operations the managed plane is hiding. That mental model is the part that transfers, and the part nobody can give you in a tutorial.

## Implications for what gets built

A few practical consequences of this stance:

- **No "free trial" hooks.** Features that require signing up for a third-party service to get the full experience aren't built.
- **OSS-first integration order.** When picking what to integrate next, the question is "is there a great OSS version?", not "is there a great hosted version?"
- **Managed-equivalent docs.** Each major component's documentation will eventually call out the common managed equivalents and what changes when you switch.
- **No emulating what we can't run for real.** If the real OSS service doesn't run on a laptop, neither does blissful-infra's version of it. Nothing pretends to be something it isn't.

If you're already past the "learning" phase and shipping real products, blissful-infra still works for you. It just gets out of your way faster. The [Build path](/paths/build) is for that mode.
