# blissful-infra. Monorepo Root

## TODOs
- **Current state (2026-07-27):** the tenant/project/service hierarchy (ADR-0017) is the only model — the flat and client models were purged in the 2.0 cleanup (see CHANGELOG). The **local Kubernetes golden path shipped** ([ADR-0020](docs/adr/0020-local-kubernetes-runtime.md)): `cluster up` Terraform-provisions a per-tenant kind cluster with ArgoCD + Argo Rollouts + Gitea; `project create --runtime kubernetes` + `deploy` runs build → kind load → gitops push → ArgoCD sync → pause-based canary, drivable from the CLI and the dashboard's Canary card.
- **Re-key `perf` / `chaos` / `compare` to tenant coordinates.** They still compile against the deprecated `utils/config.ts` flat-model reader and error politely at runtime. Same one-import-swap pattern used for deploy/rollback/canary/pipeline.
- **ADR-0020 follow-ups:** in-cluster project infra (Postgres/Kafka) so kubernetes-runtime services can keep their DB binding (currently stripped at scaffold time), and in-cluster Prometheus to bring back metric-driven canary analysis (the analysis steps were removed from the Rollout template).
- **Port the `lambda-python` template to the tenant model.** The `lambda` command was removed with the client model; the template stays on disk. Needs a tenant-era serverless compose shape + command surface.
- **Gateway route generation (ADR-0018, proposed):** every project ships a Caddy gateway with a placeholder Caddyfile; the registry-generated path-prefix routing model awaits review/implementation.
- User session analytics (ClickHouse + Kafka pipeline + frontend SDK + dashboard Sessions tab), designed in [specs/analytics.md](specs/analytics.md) — spec predates the tenant model and needs a re-read before building.
- **Compliance-grade audit logging (ADR-0011)** and **data governance / DSAR (ADR-0012)** remain proposed; both were written in client-model vocabulary and should be re-scoped to tenant/project levels before implementation.
- **L3 integration coverage:** the client-model L3 suite went with the purge. A `k8s-golden-path` integration test (gated on kind+terraform being installed) is the intended replacement; until then the golden path is verified manually per the README quickstart. The dashboard half of the golden path (canary card, environments, deploy actions) is now covered by the Playwright suite against a stubbed API.

## What this repo is

blissful-infra is a CLI tool that spins up a production-grade local sandbox in one command: backend, frontend, databases, message bus, tracing, metrics, CI/CD pipeline, and a web dashboard, all running in Docker on the developer's laptop. No cloud required.

Published as `@blissful-infra/cli` on npm. Homepage: https://blissful-infra.com

---

## Repository layout

```
blissful-infra/
├── packages/
│   ├── cli/          # @blissful-infra/cli: the published npm package (Node.js CLI + API server)
│   └── dashboard/    # React web dashboard (served by the CLI's API server)
├── site/             # Astro + Starlight docs site → blissful-infra.com (Cloudflare Pages)
├── docs/             # Learning guides and internal documentation
├── specs/            # Product vision, agent architecture, timeline specs
└── package.json      # Root workspace: workspaces: ["packages/*"]
```

---

## npm workspaces

The root `package.json` declares `"workspaces": ["packages/*"]`. Three packages:
- `packages/shared`, Private TypeScript schema library. The contract layer between all other packages.
- `packages/cli`, TypeScript, compiled to `dist/`, published to npm. Depends on `@blissful-infra/shared`.
- `packages/dashboard`, Vite/React, compiled to `dist/`, bundled into CLI's served static assets. Depends on `@blissful-infra/shared`.

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

## Key specs, read before working on these areas

| You want to work on… | Read |
|---|---|
| Tenant / project / service hierarchy, DDD enforcement, port allocation | [docs/adr/0017-tenant-project-service-hierarchy.md](docs/adr/0017-tenant-project-service-hierarchy.md) |
| Client environment model (legacy, superseded by ADR-0017) | [specs/client-model.md](specs/client-model.md) |
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

## Domain map, which CLAUDE.md to consult

| You want to work on… | Read |
|---|---|
| Shared schemas / type contracts between packages | [packages/shared/CLAUDE.md](packages/shared/CLAUDE.md) |
| CLI commands, scaffolding, server API, MCP, utils | [packages/cli/CLAUDE.md](packages/cli/CLAUDE.md) |
| Scaffold templates (Jenkinsfile, terraform, gitops manifests, Spring Boot, etc.) | [packages/cli/templates/CLAUDE.md](packages/cli/templates/CLAUDE.md) |
| Dashboard UI (React tabs, charts, log viewer) | [packages/dashboard/CLAUDE.md](packages/dashboard/CLAUDE.md) |
| Docs website (content, SEO, Cloudflare Pages deploy) | [site/CLAUDE.md](site/CLAUDE.md) |
| Example applications (content-recommender, etc.) | [packages/cli/examples/CLAUDE.md](packages/cli/examples/CLAUDE.md) |

---

## Preferences

- **Self-documenting code**: write code that reads clearly without comments. Only add a comment when the logic is genuinely non-obvious and cannot be made clearer by renaming or restructuring.
- **Error handling**: use typed exceptions (custom exception classes) rather than throwing generic `Error`. Catch at boundaries, not throughout.
- **Commits and PRs**: semantic commit messages (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`). PR titles follow the same convention.
- **Naming**: camelCase for variables and functions throughout. Match whatever convention the surrounding file uses for everything else.
- **Unit tests**: preferred style is unit tests with mocks. Test one thing at a time, mock all dependencies.
- **Test plans**: for any non-trivial feature, produce a test plan covering: functional, integration, benchmarking, performance, FMEA (failure mode and effects analysis) and penetration testing. FMEA should identify failure modes, their causes, effects and mitigations. Penetration testing should cover relevant OWASP top 10 attack surfaces.
- **Documentation** - make sure to keep documentation up to date with each feature added
- **Code Quality** - Codex will review your output once you are done
---

## Shared conventions

- **Language:** TypeScript throughout (`"type": "module"` ESM everywhere). No CommonJS.
- **Node version:** `>=20.0.0` (root engines field). Cloudflare Pages uses Node 22.
- **Testing:** Vitest, three layers, see [Testing convention](#testing-convention) below.
- **No backwards-compat shims**: delete unused code rather than commenting it out.
- **Formatting:** No formatter configured. Match surrounding style.
- **Secrets:** Never commit `.env` files or API keys. The CLI reads `ANTHROPIC_API_KEY` from the user's environment.
- **Diagrams:** Use Mermaid.js for all diagrams in specs and documentation.

---

## Shared infrastructure patterns

These patterns appear across multiple packages and should stay consistent:

**Two runtimes** under the tenant model (ADR-0017 + ADR-0020):
- **Compose (default):** the tenant compose (`docker-compose.tenant.yaml`) runs Jenkins and the observability stack; each project compose (`docker-compose.project.yaml`) runs Kafka, Postgres and the API gateway on an isolated Docker network; each service has its own `docker-compose.yaml` joining the project network. The dashboard is host-level (one control plane for all tenants). Config and data live under `~/.blissful-infra/tenants/`.
- **Kubernetes (`project create --runtime kubernetes`):** the tenant owns a kind cluster (`blissful-<tenant>`, Terraform workspace at `tenants/<t>/cluster/`) running ArgoCD, Argo Rollouts and Gitea. Projects are namespaces; services are Argo Rollouts synced by ArgoCD from the tenant's gitops repo (checkout at `tenants/<t>/gitops/`). `deploy` drives the loop.

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
| **L2.5** | Dashboard in a real browser, API stubbed at the network boundary | `packages/dashboard/e2e/*.spec.ts` | ~seconds | `npm run test:e2e` |
| **L3** | End-to-end (real Docker, real client/service lifecycle) | `src/__tests__/integration/**/*.test.ts` | ~minutes | `npm run test:integration` |

**Root scripts:**
```bash
npm test              # L1 + L2: fast, run on every save / before commit
npm run test:watch    # vitest watch mode in packages/cli
npm run test:e2e      # L2.5: Playwright against the built dashboard, no Docker
npm run test:integration   # L3: real Docker, slow, before push
npm run test:all      # everything
```

**Conventions:**
- Tests colocate with the code: `src/utils/foo.ts` → `src/utils/__tests__/foo.test.ts`
- Integration tests live under `src/__tests__/integration/`, excluded from default `npm test` and from the production build via tsconfig
- Each integration test gets a unique `BLISSFUL_HOME` (via `mkdtemp`) so it doesn't pollute the user's real registry. The CLI honors this env var when set
- Each integration test uses a unique client name (timestamp + random suffix) so parallel CI runs don't collide
- No mocks, tests hit real services (Vitest runs in node, `execa` invokes real `docker`)
- Cleanup is `afterAll` and best-effort, even on failure, do `tenant remove`

**When to add what:**
- Changed a schema or pure function → add an L1 test
- Changed a compose generator → add an L2 assertion (parse the YAML, assert structure)
- Changed a dashboard tab, panel or API call → add an L2.5 spec (see [packages/dashboard/CLAUDE.md](packages/dashboard/CLAUDE.md))
- Changed `client create` / `service add` flow → existing L3 covers; add a new L3 only for new flows

---

## Git workflow

- Current branch: `dev`
- Main/production branch: `main`
- PRs go from `dev` → `main`
- The docs site deploys automatically via GitHub Actions on push to `main` (`.github/workflows/deploy-docs.yml`)
