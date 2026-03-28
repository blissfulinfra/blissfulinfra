---
name: Cloud deploy direction
description: Product pivot to Cloudflare-first cloud deploy for solo devs; modular architecture direction
type: project
---

Blissful Infra is pivoting from an enterprise/Kubernetes-first tool to a solo-developer focused product. Cloud deploy ships Cloudflare Workers + Pages first, then Vercel, then AWS.

**Why:** User is a solo dev deploying apps of various sizes. Wants to prototype locally and ship via common platforms. Cloudflare Workers is the most accessible entry point.

**How to apply:** When suggesting deploy or scaffold features, default to Cloudflare Workers path first. Don't assume Kubernetes or ArgoCD — those are legacy and being phased out. The implementation order is tracked in specs/cloud-deploy.md.

Key decisions made:
- DeployTarget enum: local-only | cloudflare | vercel | aws (in packages/shared/src/schemas/config.ts)
- deploy.ts will become a target dispatcher (not yet implemented)
- packages/shared is the schema contract layer — all cross-boundary types live there
- specs/cloud-deploy.md has the full implementation plan (7 ordered steps)
