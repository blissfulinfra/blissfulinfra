---
name: Cloud deploy direction
description: Product pivot to Cloudflare-first cloud deploy for solo devs; ArgoCD removed from cloud path but planned for future local Kubernetes
type: project
---

Blissful Infra is pivoting from an enterprise/Kubernetes-first tool to a solo-developer focused product. Cloud deploy ships Cloudflare Workers + Pages first, then Vercel, then AWS.

**Why:** User is a solo dev deploying apps of various sizes. Wants to prototype locally and ship via common platforms. Cloudflare Workers is the most accessible entry point.

**How to apply:** When suggesting cloud deploy or scaffold features, default to Cloudflare Workers path first. ArgoCD/Kubernetes are being removed from the **cloud** deploy path (legacy `deploy.ts` rewrite tracked in specs/cloud-deploy.md). However, ArgoCD is **on the future roadmap** as the GitOps layer for a local Kubernetes runtime (kind/minikube) — see the "Local Kubernetes story" entry in CLAUDE.md TODOs. So: don't propose ArgoCD for cloud deploy, but don't treat it as dead either — it returns for the local k8s path once that work starts.

Key decisions made:
- DeployTarget enum: local-only | cloudflare | vercel | aws (in packages/shared/src/schemas/config.ts) — note: no `kubernetes` target; local k8s is a *runtime* option, not a deploy target
- deploy.ts will become a target dispatcher (not yet implemented)
- packages/shared is the schema contract layer — all cross-boundary types live there
- specs/cloud-deploy.md has the full implementation plan (7 ordered steps)
