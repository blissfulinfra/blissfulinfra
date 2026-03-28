# Blissful Infra Cloud — Hosted Tier Specification

## Vision

The same app you sandbox locally ships to real infrastructure with one command. No Terraform, no DevOps team, no cloud account required. blissful-infra Cloud is the natural next step after `blissful-infra start` — when you're ready to share your project with the world, you run `blissful-infra deploy` and it's live at `yourproject.blissful-infra.com` in under two minutes.

---

## Pricing

| Tier | Price | Target |
|---|---|---|
| **Local** | Free forever | Developers who want a local sandbox |
| **Hosted** | $5/month | Solo developers ready to ship |
| **Team** | Contact us | Small teams, custom domains, priority support |

The $5 tier is intentionally low — impulse-buy pricing that keeps the barrier to first deployment as close to zero as possible. The team tier is negotiated case-by-case.

**Billing provider:** Polar.sh (merchant of record — handles global tax/VAT automatically)

---

## What the $5 Tier Includes

| Feature | Detail |
|---|---|
| Subdomain | `yourproject.blissful-infra.com` |
| Custom domain | Bring your own (CNAME to Cloudflare) |
| Frontend hosting | Cloudflare Pages (unlimited bandwidth) |
| Backend | Cloudflare Workers (100k requests/day free tier) |
| Database | Cloudflare D1 — 5GB SQLite (maps from local Postgres) |
| Cache | Cloudflare KV — 1GB (maps from local Redis) |
| Queue | Cloudflare Queues — async messaging (maps from local Kafka) |
| SSL | Automatic via Cloudflare |
| Auto-deploy | `blissful-infra deploy` from CLI |
| Project dashboard | Manage hosted projects at blissful-infra.com |

**Hard limits at $5/tier:**
- 1 hosted project per subscription
- 100k Worker requests/day (soft — overage notified, not cut off)
- 5GB D1 storage
- Builds: 500/month

---

## Module Mapping — Local → Cloud

The `blissful-infra.yaml` config schema already captures this via the `modules` block. At deploy time, each local service maps to its Cloudflare equivalent:

| Local service | Cloud equivalent | Notes |
|---|---|---|
| React + Vite frontend | Cloudflare Pages | Static build, CDN-distributed |
| Express / Go Chi backend | Cloudflare Worker | Native JS/Go Workers support |
| Spring Boot backend | Cloudflare Worker (via adapter) | JVM → lightweight JS proxy; full container support via Cloudflare Containers (beta) |
| Postgres | Cloudflare D1 | SQLite dialect — Flyway migrations auto-converted |
| Redis | Cloudflare KV | Key-value, TTL supported |
| Kafka | Cloudflare Queues | Producer/consumer pattern, async |
| nginx | Cloudflare routing | Worker routes replace nginx reverse proxy rules |

**Spring Boot note:** Full JVM on Workers is not supported today. The adapter approach wraps the Spring Boot app in a lightweight Worker proxy that forwards requests to a container. Cloudflare Containers (currently in beta) will resolve this cleanly. Until then, Express and Go Chi backends are the smoothest path to a $5 cloud deploy.

---

## Deploy Flow

### CLI experience

```bash
# First deploy — interactive setup
blissful-infra deploy

? Project name: my-app
? Deploy target: Cloudflare
? Subdomain: my-app (→ my-app.blissful-infra.com)
? Custom domain? (optional): myapp.com

Logging in with Polar.sh...
✓ Subscription active ($5/month)

Provisioning infrastructure...
✓ Cloudflare Pages project created
✓ Cloudflare Worker deployed
✓ D1 database provisioned (my-app-db)
✓ KV namespace created
✓ Subdomain my-app.blissful-infra.com configured
✓ SSL certificate issued

Building and deploying...
✓ Frontend built (React + Vite)
✓ Frontend deployed to Cloudflare Pages
✓ Backend deployed to Cloudflare Worker
✓ Database migrations applied (3 migrations)

Live at: https://my-app.blissful-infra.com
Dashboard: https://blissful-infra.com/dashboard

# Subsequent deploys — one command
blissful-infra deploy
✓ Deployed in 38s → https://my-app.blissful-infra.com
```

### What happens under the hood

```
blissful-infra deploy
  │
  ├─ Read blissful-infra.yaml → determine modules
  ├─ Authenticate with control plane API (JWT from Polar.sh session)
  ├─ Check subscription status via Polar.sh API
  │
  ├─ Provision (idempotent — safe to re-run):
  │   ├─ Cloudflare API: create/update Pages project
  │   ├─ Cloudflare API: create/update Worker
  │   ├─ Cloudflare API: create D1 database (if not exists)
  │   ├─ Cloudflare API: create KV namespace (if not exists)
  │   └─ Cloudflare API: create DNS CNAME for subdomain
  │
  ├─ Build:
  │   ├─ Frontend: npm run build → dist/
  │   └─ Backend: compile/bundle for Worker target
  │
  ├─ Deploy:
  │   ├─ wrangler pages deploy dist/ --project-name {name}
  │   ├─ wrangler deploy (Worker)
  │   └─ wrangler d1 migrations apply {db-name}
  │
  └─ Return live URL + deployment ID → update local deployment tracking
```

---

## Control Plane API

A hosted service (separate from the CLI's local API server) that sits between the CLI and Cloudflare's API. Handles provisioning, auth, and billing checks.

**Base URL:** `https://api.blissful-infra.com`

**Key endpoints:**

```
POST /auth/login              → OAuth flow (GitHub), returns JWT
GET  /auth/me                 → current user + subscription status

POST /projects                → provision a new hosted project
GET  /projects                → list user's hosted projects
GET  /projects/:id            → project status, URLs, resource usage
DELETE /projects/:id          → deprovision (cancel hosting)

POST /projects/:id/deploy     → trigger deploy (builds + pushes via Cloudflare API)
GET  /projects/:id/deployments → deployment history

POST /billing/subscribe       → initiate Polar.sh checkout ($5/month)
GET  /billing/status          → subscription status, next billing date
POST /billing/cancel          → cancel subscription (project stays live until period end)
```

**Tech stack for control plane:**
- Cloudflare Worker (the control plane itself runs on Cloudflare — dogfoods the product)
- Cloudflare D1 for user/project/deployment records
- Cloudflare KV for session tokens
- Polar.sh webhooks for subscription lifecycle events

---

## Authentication

**GitHub OAuth** — developers live on GitHub. No new account to create.

Flow:
1. `blissful-infra deploy` detects no auth token → opens browser to `https://blissful-infra.com/auth/github`
2. User authorizes GitHub OAuth app
3. Control plane creates/updates user record, issues JWT
4. JWT stored in `~/.blissful-infra/auth.json`
5. Subsequent deploys use stored JWT (refreshed automatically)

---

## Custom Domain Support

For users who want `myapp.com` instead of `myapp.blissful-infra.com`:

1. User runs `blissful-infra deploy --domain myapp.com`
2. CLI outputs the required DNS record: `CNAME myapp.com → myapp.blissful-infra.com`
3. User adds the CNAME at their domain registrar
4. Cloudflare detects the CNAME and issues an SSL certificate automatically
5. Both `myapp.com` and `myapp.blissful-infra.com` serve the project

Custom domain is included in the $5 tier — no upsell needed.

---

## Project Dashboard (blissful-infra.com/dashboard)

A web UI at `blissful-infra.com/dashboard` for managing hosted projects. Mirrors the local dashboard experience but for cloud-deployed projects.

**Features:**
- List of hosted projects with live/offline status
- One-click redeploy
- Deployment history (commit SHA, deploy time, duration)
- Resource usage (D1 storage, KV reads, Worker requests vs daily limit)
- Custom domain management
- Subscription status + billing management (via Polar.sh portal)
- Delete project (with confirmation)

**Tech:** Astro page within the existing `site/` package, authenticates against the control plane API via GitHub OAuth session.

---

## blissful-infra.com Site Updates

### Pricing page (`/pricing`)
New page at `site/src/content/docs/pricing.md`:
- Free tier (local sandbox)
- $5/month hosted tier (feature table)
- Team tier (contact us)
- FAQ: "What happens if I cancel?", "Can I use a custom domain?", "Which backends work?", "What are the limits?"

### Landing page (`/`)
Update the "Coming soon: Deploy to the cloud" section to:
- Name the $5 price point
- Show the two-command flow (`blissful-infra start` → `blissful-infra deploy`)
- Link to `/pricing`

### Deploy docs (`/deploy/cloudflare`)
New page documenting the full deploy flow, module mapping, and custom domain setup.

---

## Limitations and Constraints

**What works well on Cloudflare:**
- React/Vite frontends (Cloudflare Pages is excellent)
- Express and Go Chi backends (native Worker support)
- Stateless APIs with D1/KV backing

**What requires workarounds:**
- Spring Boot: needs adapter layer until Cloudflare Containers GA
- WebSockets: Cloudflare Workers support WebSockets but with limitations (Durable Objects required for stateful WS)
- Kafka consumer groups: Cloudflare Queues doesn't support consumer groups — single consumer only

**What won't work at $5:**
- Long-running background jobs (Workers have CPU time limits)
- Large file storage (use Cloudflare R2, not included in base tier)
- High-traffic sites that exceed 100k requests/day without notifying (soft limit)

---

## Implementation Phases

### Phase 6a — Foundation
- [ ] Control plane API (Cloudflare Worker + D1)
- [ ] GitHub OAuth flow
- [ ] Polar.sh billing integration (subscribe, webhook, status check)
- [ ] `blissful-infra deploy --target cloudflare` CLI command (provisions + deploys)
- [ ] Subdomain provisioning via Cloudflare API
- [ ] React + Vite frontend deploy (Pages)
- [ ] Express backend deploy (Worker)

### Phase 6b — Database + Storage
- [ ] D1 provisioning + Flyway migration conversion
- [ ] KV namespace provisioning
- [ ] Cloudflare Queues provisioning
- [ ] Module mapping validated end-to-end

### Phase 6c — Dashboard + Custom Domains
- [ ] `/dashboard` page on blissful-infra.com
- [ ] Custom domain CNAME flow
- [ ] Deployment history in dashboard
- [ ] Resource usage display

### Phase 6d — Spring Boot Support
- [ ] Worker adapter for Spring Boot (proxy approach)
- [ ] Cloudflare Containers integration (when GA)

### Phase 6e — Vercel + AWS
- [ ] `blissful-infra deploy --target vercel`
- [ ] `blissful-infra deploy --target aws` (ECS Fargate + RDS)
- [ ] Unified deploy command that reads `deploy.target` from `blissful-infra.yaml`
