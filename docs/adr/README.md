# Architectural Decision Records

This directory captures the **why** behind significant architectural choices in
blissful-infra. The code shows what we did; an ADR explains what we considered
and why we rejected the alternatives.

## When to write one

Write an ADR when a decision satisfies any of these:

- **Hard to reverse.** Schema changes, public API contracts, file layouts on
  disk under `~/.blissful-infra/`, things that ship to npm.
- **Cross-cutting.** Touches CLI + dashboard + templates simultaneously.
- **Surprising.** A reasonable engineer would expect a different choice.
- **Costly to revisit.** "Why isn't this Zod?" "Why isn't this a single
  monolithic compose file?", questions that come up repeatedly.

Do **not** write one for routine bug fixes, naming choices inside a single
file, or implementation details that can be refactored without a contract
change.

## Convention

- Files: `NNNN-kebab-case-title.md` where NNNN is a zero-padded serial
- Status:
  - `Proposed`, design under discussion, not yet implemented
  - `Accepted`, implemented and load-bearing
  - `Deferred`, design agreed, implementation queued (revive later)
  - `Superseded by NNNN`, overturned by a later ADR
  - `Deprecated`, no longer applies; see Consequences for migration notes
- Date: ISO 8601 (`YYYY-MM-DD`)
- Length: 1-2 pages. If it's longer than 2 pages, you're writing a spec, put
  it in `specs/` and link to it from the ADR

Use `_template.md` as a starting point.

## Workflow

1. Copy `_template.md` to `NNNN-your-decision.md` (next free serial)
2. Status starts at `Proposed`
3. After the decision is implemented and you're confident it's load-bearing,
   flip the status to `Accepted`
4. If a later decision overturns it, leave the file in place but mark
   `Superseded by NNNN` and explain in the new ADR

## Index

| # | Title | Status | Date |
|---|---|---|---|
| [0001](./0001-caddy-edge-proxy.md) | Caddy edge proxy for browser-friendly local URLs | Deferred | 2026-04-30 |
| [0002](./0002-per-client-isolation-model.md) | Each client environment is fully isolated | Accepted | 2026-04-18 |
| [0003](./0003-unified-compose-project-per-client.md) | One Compose project per client, services attached via `include:` | Accepted | 2026-04-28 |
| [0004](./0004-api-versioning-v1-strict-404.md) | The HTTP API is versioned at `/api/v1/` and unversioned paths return 404 | Accepted | 2026-04-29 |
| [0005](./0005-three-layer-testing-strategy.md) | Test in three layers: schema/logic, compose validation, real Docker | Accepted | 2026-04-30 |
| [0006](./0006-keep-zod-for-runtime-validation.md) | Keep Zod as the runtime-validation layer at trust boundaries | Accepted | 2026-04-30 |
| [0007](./0007-aws-lambda-local-via-localstack.md) | AWS Lambda backend template runs locally on LocalStack; cloud deploy deferred | Proposed | 2026-05-02 |
| [0008](./0008-clickhouse-as-client-level-warehouse.md) | ClickHouse and LocalStack are client-level shared resources | Proposed | 2026-05-02 |
| [0009](./0009-keycloak-as-client-level-iam.md) | Keycloak is the client-level identity provider | Proposed | 2026-05-02 |
| [0010](./0010-decompose-ai-pipeline-plugin.md) | Decompose the ai-pipeline plugin into client-level platform services | Proposed | 2026-05-02 |
| [0011](./0011-compliance-grade-audit-logging.md) | Compliance-grade audit logging via immudb + Kafka + ClickHouse | Proposed | 2026-05-04 |
| [0012](./0012-data-governance-and-dsar-enforcement.md) | Data governance and DSAR enforcement via a per-service classification manifest | Proposed | 2026-05-04 |

When you add an ADR, append a row to this index in the same PR.

## Why ADRs

The conversation history of this project contains hundreds of design choices
made in chat. Most are forgotten in a week. The ones that matter, the ones
that future Claude or future you needs to understand to make consistent
choices, deserve a permanent home outside the chat. ADRs are that home.

Sibling docs:
- `specs/`, full feature specs and design docs (longer than ADRs)
- `CLAUDE.md`, onboarding for AI assistants and humans new to the repo
- Code-adjacent `CLAUDE.md` files, package- and folder-level conventions
