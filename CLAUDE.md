# blissful-infra — Monorepo Root

## TODOs
- Client model (Phase 6A) is implemented — `blissful-infra client create/list/up/down/status/remove` and `blissful-infra service add/up/down/logs`. Both Jenkins and observability are per-client (fully isolated). Phase 6B (dynamic Prometheus scrape updates, Jenkins job scoping) is next.
- User session analytics (ClickHouse + Kafka pipeline + frontend SDK + dashboard Sessions tab) — designed in [specs/analytics.md](specs/analytics.md). Slice A (plumbing) is the next build chunk.
- **dev-app is now a client-model service** — lives at `~/.blissful-infra/clients/dev/app/` (client `dev`, service `app`). The old `dev-app/` directory at the repo root has been removed. `dev.sh` rebuilt to use `blissful-infra client up dev`. Eat-your-own-dogfood is now the client model. The legacy `blissful-infra start` flat-model path still works for users who want it, but is no longer used internally.
- **Template hot-reload (`blissful-infra dev --templates <project>`) needs porting** to client-model paths — currently expects a project dir under cwd, would need to accept a client-model service path like `~/.blissful-infra/clients/dev/app`. Niche template-developer feature; defer until needed.
- **AWS Lambda backend template (`lambda-python`)** is shipped — runs on LocalStack locally, has its own `blissful-infra lambda deploy/invoke/logs` CLI. Cloud deploy adapter for real AWS Lambda is intentionally deferred (see [docs/adr/0007-aws-lambda-local-via-localstack.md](docs/adr/0007-aws-lambda-local-via-localstack.md)). Future runtimes (`lambda-node`, `lambda-go`) follow the same pattern.
- **Client-level platform services (ADR-0008/0009/0010)** — ClickHouse, LocalStack, Keycloak, MLflow, Mage are all promotable to client-level infrastructure. All opt-in (default off) via `infrastructure.{name}: true` in the client config. Lambda services now use the **client-level** LocalStack instead of running their own. The `ai-pipeline` plugin still runs its old per-plugin ClickHouse/MLflow/Mage stack — refactor to consume the client-level versions is queued (ADR-0010 implementation).
- **Local Kubernetes story (future)** — bring k8s back as a *local* runtime option (kind/minikube) with **ArgoCD as the GitOps layer**, bootstrapped via **Terraform** (cluster provisioning + Helm-based ArgoCD install). Distinct from cloud deploy: cloud stays Cloudflare/Vercel/AWS-first per [specs/cloud-deploy.md](specs/cloud-deploy.md), and ArgoCD does **not** return to the cloud path. Terraform is **scoped to this work only** — not the lambda template, not the AWS cloud-deploy target. Deferred until the cloud-deploy dispatcher rewrite (which removes the legacy ArgoCD/kubectl code from `deploy.ts`) lands.

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

## Architectural decisions

ADRs capturing the **why** behind significant choices live in
[docs/adr/](docs/adr/). Read [docs/adr/README.md](docs/adr/README.md) for the
convention. Write a new ADR whenever a decision is hard to reverse,
cross-cutting, surprising, or comes up repeatedly. Skip them for routine
implementation details.

## Key specs — read before working on these areas

| You want to work on… | Read |
|---|---|
| Client environment model / `blissful-infra client create` / per-client isolation | [specs/client-model.md](specs/client-model.md) |
| User session analytics (ClickHouse + Kafka pipeline + SDK) | [specs/analytics.md](specs/analytics.md) |
| Browser-friendly URLs / Caddy edge proxy / local TLS | [docs/adr/0001-caddy-edge-proxy.md](docs/adr/0001-caddy-edge-proxy.md) |
| Cloud hosting / `blissful-infra deploy` / $5 tier | [specs/cloud-hosting.md](specs/cloud-hosting.md) |
| Cloud deploy Cloudflare architecture | [specs/cloud-deploy.md](specs/cloud-deploy.md) |
| Agentic workflows (Feature, Template, Test, Monitor agents) | [specs/agentic-workflows.md](specs/agentic-workflows.md) |
| Observability, metric regression tracking, pluggable APM backends | [specs/observability.md](specs/observability.md) |
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

## Preferences

- **Self-documenting code** — write code that reads clearly without comments. Only add a comment when the logic is genuinely non-obvious and cannot be made clearer by renaming or restructuring.
- **Error handling** — use typed exceptions (custom exception classes) rather than throwing generic `Error`. Catch at boundaries, not throughout.
- **Commits and PRs** — semantic commit messages (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`). PR titles follow the same convention.
- **Naming** — camelCase for variables and functions throughout. Match whatever convention the surrounding file uses for everything else.
- **Unit tests** — preferred style is unit tests with mocks. Test one thing at a time, mock all dependencies.
- **Test plans** — for any non-trivial feature, produce a test plan covering: functional, integration, benchmarking, performance, FMEA (failure mode and effects analysis) and penetration testing. FMEA should identify failure modes, their causes, effects and mitigations. Penetration testing should cover relevant OWASP top 10 attack surfaces.
- **Documentation** - make sure to keep documentation up to date with each feature added
- **Code Quality** - Codex will review your output once you are done
---

## Shared conventions

- **Language:** TypeScript throughout (`"type": "module"` ESM everywhere). No CommonJS.
- **Node version:** `>=20.0.0` (root engines field). Cloudflare Pages uses Node 22.
- **Testing:** Vitest, three layers — see [Testing convention](#testing-convention) below.
- **No backwards-compat shims** — delete unused code rather than commenting it out.
- **Formatting:** No formatter configured. Match surrounding style.
- **Secrets:** Never commit `.env` files or API keys. The CLI reads `ANTHROPIC_API_KEY` from the user's environment.
- **Diagrams:** Use Mermaid.js for all diagrams in specs and documentation.

---

## Shared infrastructure patterns

These patterns appear across multiple packages and should stay consistent:

**Docker Compose** is the runtime unit. Two models coexist:
- **Flat model** (legacy): `blissful-infra start <name>` creates a single `docker-compose.yaml` with all services and infra in one file.
- **Client model** (Phase 6): Each client gets `docker-compose.infra.yaml` (shared Kafka, Postgres, Jenkins, observability) plus per-service `docker-compose.yaml` files that join the client's `{name}_infra` Docker network as an external network. Clients are fully isolated — no shared resources between them. Config and data live under `~/.blissful-infra/clients/`.

**API server** (`packages/cli/src/server/api.ts`) runs on **port 3002** and is the single integration point between the CLI, the dashboard, and Jenkins pipelines. The dashboard talks to it over `http://localhost:3002`. Jenkins pipelines reach it via `http://host.docker.internal:3002`.

**MCP server** (`packages/cli/src/server/mcp.ts`) exposes CLI capabilities as tools for Claude via the Model Context Protocol. Run with `blissful-infra mcp`.

**Template variable substitution** uses `{{VAR_NAME}}` (replaced at scaffold time) and `{{#IF_FEATURE}} … {{/IF_FEATURE}}` for conditional blocks. See [packages/cli/src/templates/CLAUDE.md](packages/cli/src/templates/CLAUDE.md).

---

## Testing convention

Three-layer strategy. Run **L1+L2 before every commit** (under 1s, no Docker
needed). Run L3 before pushing or when changing code that touches Docker.

| Layer | What | Where | Speed | Run with |
|---|---|---|---|---|
| **L1** | Schema validation + pure logic | `src/**/__tests__/*.test.ts` | ~ms | `npm test` |
| **L2** | Compose YAML correctness (real `docker compose config`) | `src/utils/__tests__/*.test.ts` | ~hundreds of ms | `npm test` |
| **L3** | End-to-end (real Docker, real client/service lifecycle) | `src/__tests__/integration/**/*.test.ts` | ~minutes | `npm run test:integration` |

**Root scripts:**
```bash
npm test              # L1 + L2 — fast, run on every save / before commit
npm run test:watch    # vitest watch mode in packages/cli
npm run test:integration   # L3 — real Docker, slow, before push
npm run test:all      # everything
```

**Conventions:**
- Tests colocate with the code: `src/utils/foo.ts` → `src/utils/__tests__/foo.test.ts`
- Integration tests live under `src/__tests__/integration/` — excluded from default `npm test` and from the production build via tsconfig
- Each integration test gets a unique `BLISSFUL_HOME` (via `mkdtemp`) so it doesn't pollute the user's real registry. The CLI honors this env var when set
- Each integration test uses a unique client name (timestamp + random suffix) so parallel CI runs don't collide
- No mocks — tests hit real services (Vitest runs in node, `execa` invokes real `docker`)
- Cleanup is `afterAll` and best-effort — even on failure, do `client remove`

**When to add what:**
- Changed a schema or pure function → add an L1 test
- Changed a compose generator → add an L2 assertion (parse the YAML, assert structure)
- Changed `client create` / `service add` flow → existing L3 covers; add a new L3 only for new flows

---

## Git workflow

- Current branch: `dev`
- Main/production branch: `main`
- PRs go from `dev` → `main`
- The docs site deploys automatically via GitHub Actions on push to `main` (`.github/workflows/deploy-docs.yml`)
