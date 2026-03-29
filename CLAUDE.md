# blissful-infra — Monorepo Root

## What this repo is

blissful-infra is a CLI tool that spins up a production-grade local sandbox in one command: backend, frontend, databases, message bus, tracing, metrics, CI/CD pipeline, and a web dashboard — all running in Docker on the developer's laptop. No cloud required.

Published as `@blissful-infra/cli` on npm. Homepage: https://blissful-infra.com

---

## Repository layout

```
blissful-infra/
├── packages/
│   ├── cli/          # @blissful-infra/cli — the published npm package (Node.js CLI + API server)
│   └── dashboard/    # React web dashboard (served by the CLI's API server)
├── examples/         # Example apps scaffolded by the CLI (copied into CLI dist at build)
├── site/             # Astro + Starlight docs site → blissful-infra.com (Cloudflare Pages)
├── dev-app/          # Reference full-stack app used during local development
├── docs/             # Learning guides and internal documentation
├── specs/            # Product vision, agent architecture, timeline specs
├── package.json      # Root workspace — workspaces: ["packages/*"]
└── wrangler.toml     # Cloudflare config (root-level, mostly unused — site/ has its own)
```

---

## npm workspaces

The root `package.json` declares `"workspaces": ["packages/*"]`. Three packages:
- `packages/shared` — Private TypeScript schema library. The contract layer between all other packages.
- `packages/cli` — TypeScript, compiled to `dist/`, published to npm. Depends on `@blissful-infra/shared`.
- `packages/dashboard` — Vite/React, compiled to `dist/`, bundled into CLI's served static assets. Depends on `@blissful-infra/shared`.

**Always run `npm install` from the repo root.** Do not run it inside a package directory unless you have a specific reason.

---

## Key build commands (run from repo root)

```bash
npm run build             # Build both packages (cli then dashboard)
npm run build:cli         # Build CLI only  →  packages/cli: tsc + copy examples
npm run build:dashboard   # Build dashboard only  →  packages/dashboard: tsc + vite build
```

Individual package dev:
```bash
# In packages/cli:
npm run dev               # tsc --watch
npm run typecheck         # tsc --noEmit

# In packages/dashboard:
npm run dev               # vite dev server
npm run build             # tsc -b && vite build
```

Site (docs):
```bash
cd site && npm run build  # Astro static build → site/dist/
cd site && npm run dev    # Astro dev server
```

---

## Key specs — read before working on these areas

| You want to work on… | Read |
|---|---|
| Cloud hosting / `blissful-infra deploy` / $5 tier | [specs/cloud-hosting.md](specs/cloud-hosting.md) |
| Cloud deploy Cloudflare architecture | [specs/cloud-deploy.md](specs/cloud-deploy.md) |
| Agentic workflows (Feature, Template, Test, Monitor agents) | [specs/agentic-workflows.md](specs/agentic-workflows.md) |
| Test strategy (Vitest, integration, smoke tests) | [specs/testing-strategy.md](specs/testing-strategy.md) |
| Phase timeline and prioritization | [specs/timeline.md](specs/timeline.md) |
| Product vision and positioning | [specs/product.md](specs/product.md) |

---

## Domain map — which CLAUDE.md to consult

| You want to work on… | Read |
|---|---|
| Shared schemas / type contracts between packages | [packages/shared/CLAUDE.md](packages/shared/CLAUDE.md) |
| CLI commands, scaffolding, server API, MCP, utils | [packages/cli/CLAUDE.md](packages/cli/CLAUDE.md) |
| Scaffold templates (Jenkinsfile, docker-compose, Spring Boot, etc.) | [packages/cli/src/templates/CLAUDE.md](packages/cli/src/templates/CLAUDE.md) |
| Dashboard UI (React tabs, charts, log viewer) | [packages/dashboard/CLAUDE.md](packages/dashboard/CLAUDE.md) |
| Docs website (content, SEO, Cloudflare Pages deploy) | [site/CLAUDE.md](site/CLAUDE.md) |
| Example applications (content-recommender, etc.) | [examples/CLAUDE.md](examples/CLAUDE.md) |

---

## Shared conventions

- **Language:** TypeScript throughout (`"type": "module"` ESM everywhere). No CommonJS.
- **Node version:** `>=20.0.0` (root engines field). Cloudflare Pages uses Node 22.
- **No test suite yet** — `npm test` echoes a placeholder. Do not add mocks; integration tests should hit real services.
- **No backwards-compat shims** — delete unused code rather than commenting it out.
- **Formatting:** No formatter configured. Match surrounding style.
- **Secrets:** Never commit `.env` files or API keys. The CLI reads `ANTHROPIC_API_KEY` from the user's environment.

---

## Shared infrastructure patterns

These patterns appear across multiple packages and should stay consistent:

**Docker Compose** is the runtime unit. Each project the CLI creates gets a `docker-compose.yaml`. Services talk over the default Compose network using service names as hostnames.

**API server** (`packages/cli/src/server/api.ts`) runs on **port 3002** and is the single integration point between the CLI, the dashboard, and Jenkins pipelines. The dashboard talks to it over `http://localhost:3002`. Jenkins pipelines reach it via `http://host.docker.internal:3002`.

**MCP server** (`packages/cli/src/server/mcp.ts`) exposes CLI capabilities as tools for Claude via the Model Context Protocol. Run with `blissful-infra mcp`.

**Template variable substitution** uses `{{VAR_NAME}}` (replaced at scaffold time) and `{{#IF_FEATURE}} … {{/IF_FEATURE}}` for conditional blocks. See [packages/cli/src/templates/CLAUDE.md](packages/cli/src/templates/CLAUDE.md).

---

## Git workflow

- Current branch: `dev`
- Main/production branch: `main`
- PRs go from `dev` → `main`
- The docs site deploys automatically via GitHub Actions on push to `main` (`.github/workflows/deploy-docs.yml`)
