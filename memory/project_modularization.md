---
name: Modularization direction
description: Module system design — named capabilities with local Docker impls and per-platform cloud adapters
type: project
---

The product is being modularized so each capability (database, cache, queue, backend, frontend) has a local Docker implementation and per-platform cloud adapters.

**Why:** Modularization enables flexible release of sub-elements to different platforms. A database module maps to Postgres locally, D1 on Cloudflare, Vercel Postgres on Vercel, RDS on AWS.

**How to apply:** When touching config schema or scaffold templates, think in terms of modules with adapters rather than hardcoded service lists. The ModulesSchema in packages/shared/src/schemas/config.ts is the starting point. cache and queue modules are not yet in the schema — add when relevant.
