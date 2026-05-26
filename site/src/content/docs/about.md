---
title: Why I built this
description: The story behind blissful-infra. I wanted to go deeper on enterprise architecture without growing the cloud bill.
---

I spent a few years at Intuit on the Identity / Auth team. At that scale most of the infrastructure is already wired up for you. That is productive, but it also puts a few layers between you and the technology underneath.

I wanted to go deeper. Wire Kafka up by hand, put Keycloak in front of a service, swap Redis for a Postgres read replica and see what actually changes. I also wanted to just spin it up. No two hour `docker-compose.yaml` detour, no cloud bill creeping up while I learn.

blissful-infra is the tool I wanted. One command, real infrastructure, all local. Try a pattern, throw it away, try the next one.
