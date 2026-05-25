---
title: Why I built this
description: The story behind blissful-infra. Why an enterprise engineer wanted a local sandbox to iterate on architecture patterns fast.
---

I spent a few years at Intuit on the Identity / Auth team. Most of the infrastructure you work with at a company that size is already provided for you. Auth, observability, deploy pipelines, message buses, datastores: someone wrote the wrapper, someone else maintains the wrapper, and you ship features on top of it.

That model is productive. It is also, in many cases, the right one. Internal platforms exist for good reasons. They cap resource usage, standardize on a handful of patterns and limit the blast radius of any one team's mistakes. The trade off is that several layers of abstraction sit between you and the technology your service actually runs on. You can dig into them, but the deeper you go the more "you're holding it wrong" responses you get back. Sometimes that is correct. Sometimes the abstraction is hiding something the underlying technology was designed to let you do.

I wanted to go deeper on the enterprise patterns I used every day. I wanted to wire Kafka up by hand and see what consumer group rebalancing actually looks like. I wanted to put Keycloak in front of a service, watch the JWT round trip, and decide for myself what part of that Auth0 would have done for me. I wanted to swap Redis for a Postgres read replica and benchmark the difference. The frustrating part was that none of the interesting work started with the experiment. It started with two hours of `docker-compose.yaml`, an evening of "why is Kafka not reachable from the JVM container" and a slow drift away from what I actually wanted to learn.

blissful-infra is the tool I wanted. One command and the boilerplate is gone. Postgres is running, Kafka is reachable, Grafana already has dashboards pointed at the right metrics and Jenkins is wired up to a fresh git repository. The interesting part of the problem (the architecture choice, the schema, the failure mode you want to reproduce) is the first thing you touch, not the last.

## Who it is for

**Enterprise engineers** who want a sandbox that mirrors what real teams run. Not toy infra. Real Kafka, real Postgres, real Prometheus, real Jenkins. Rip out the parts you do not need, swap in the parts you want to evaluate, break it on purpose, rebuild it. The same patterns you fight at work are sitting in your home directory, in plain code, on a network you own.

**Solo developers and small studios** who want enterprise-shape infrastructure without the enterprise bill. A managed Kafka, a managed Postgres, a managed observability stack and a CI runner across two or three client projects adds up to real money every month. Running the open source originals on your own laptop costs nothing. When a project is ready to ship, the same config drives the deploy.

**Students and engineers between roles** who want to build the mental model. The job listings ask for experience with distributed systems and few entry level roles will pay you to learn it. The full stack is in your hands here, free, with no cloud account in the way.

## What I optimized for

Speed of iteration on architecture, not speed of feature development. The point is that you can try a pattern, throw it away and try the next one in the time it usually takes to read the docs for one of them. Templates exist so you do not start from a blank repository. Real services run underneath so the lessons transfer. Nothing is mocked when a real OSS equivalent exists. When you graduate to a managed version you will know what it does and what it costs you in flexibility.

The [philosophy page](/philosophy) goes deeper on the OSS-first, no paid tier stance. The [Build path](/paths/build) is the fastest way in if you already know what you want to try.
