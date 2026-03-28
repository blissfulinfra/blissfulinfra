---
title: Pricing
description: blissful-infra is free to use locally. Deploy to blissful-infra.com for $5/month — Cloudflare edge hosting, custom domain, database, cache, and queue included.
---

## Simple pricing

Build locally for free. Pay $5/month when you're ready to ship.

### Local — Free*

Everything you need to build and experiment:

- Full Docker Compose stack — backend, frontend, database, message bus, tracing, metrics, CI/CD
- Unlimited local projects
- AI debugging agent via MCP
- Local web dashboard
- All templates and examples

No credit card required. *Free tier subject to terms and conditions.

```bash
npm install -g @blissful-infra/cli
blissful-infra start my-app
```

---

### Hosted — $5/month

Your project live on the internet, deployed with one command:

- Live subdomain at `yourproject.blissful-infra.com`
- Custom domain support — bring your own, we handle the SSL
- Cloudflare edge deployment (frontend on Pages, backend as a Worker)
- Cloudflare D1 database (5GB, maps from local Postgres)
- Cloudflare KV cache (maps from local Redis)
- Cloudflare Queues (maps from local Kafka)
- 100k Worker requests/day
- Deployment history and live status in the web dashboard
- 500 builds/month

```bash
blissful-infra deploy
# → Live at https://my-app.blissful-infra.com in under 2 minutes
```

---

### Team — Contact us

For small teams who need more than one hosted project:

- Unlimited hosted projects
- Custom domains for all projects
- Priority support
- Team access to the dashboard

Email [contact@studiocavan.com](mailto:contact@studiocavan.com) or reach out on [X @studiocavan](https://x.com/studiocavan) to discuss.

---

## FAQ

**What happens if I cancel?**
Your project stays live until the end of the billing period. After that it goes offline — your local project files are unaffected and you can redeploy any time.

**Can I use a custom domain?**
Yes, included in the $5 tier. Point a CNAME at your subdomain, we handle the SSL certificate automatically.

**Which backends work with cloud deploy?**
Express (Node.js) and Go Chi backends deploy natively as Cloudflare Workers. Spring Boot support is in progress — a lightweight adapter is available now, and full container support is coming when Cloudflare Containers reaches GA.

**What are the request limits?**
100k Worker requests/day on the $5 tier. If your project gets traffic beyond that we'll notify you — we won't cut it off without warning.

**Is Postgres fully supported?**
Cloudflare D1 is SQLite, not Postgres. Your Flyway migrations are automatically converted at deploy time. Most standard SQL works. Complex Postgres-specific queries (window functions, JSONB operators) may need minor adjustments.

**Do I need a Cloudflare account?**
No. blissful-infra manages the Cloudflare infrastructure on your behalf. You don't need to touch Cloudflare's dashboard.

**How is billing handled?**
Through [Polar.sh](https://polar.sh) — they handle payment processing and global tax/VAT automatically.
