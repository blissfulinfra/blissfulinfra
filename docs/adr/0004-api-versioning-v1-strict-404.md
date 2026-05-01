# 0004. The HTTP API is versioned at `/api/v1/` and unversioned paths return 404

- **Status:** Accepted
- **Date:** 2026-04-29
- **Deciders:** @cavanpage

## Context

The CLI's API server (port 3002) is the single integration point between
the dashboard, the MCP server, Jenkins pipelines, and any future
external client. Initially every endpoint was at `/api/<resource>` —
unversioned. As the platform stabilized we faced the question that every
HTTP API eventually faces: *what happens when we need to break a contract?*

Three failure modes were visible already:

- **Drift between dashboard and api.ts.** The dashboard's `fetch` calls
  and the server's response shapes drifted — mitigated by `packages/shared`
  schemas, but the drift would re-emerge when one side bumped a contract
  and the other didn't.
- **No way to ship breaking changes.** A field rename in
  `ProjectStatus` would silently break the dashboard, MCP, and Jenkins
  simultaneously with no fallback.
- **Two API consumers in addition to the dashboard** (MCP server and
  Jenkinsfile) made it impossible to atomically migrate everything in
  one commit.

The ad-hoc options were "always be backwards-compatible forever" (which
reality has shown is unworkable) or "version it now, before there's a
real prod surface to migrate."

## Decision

All HTTP API endpoints are exposed at `/api/v1/<resource>`. The server
**only** accepts `/api/v1/...` paths; any other `/api/...` request
returns:

```json
HTTP 404
{
  "error": "Unsupported API version",
  "hint": "Use /api/v1/... — the unversioned /api/ form has been removed."
}
```

To bump to v2, add v2 route handlers alongside the v1 ones. Both versions
run in parallel until consumers migrate, then v1 is deprecated and removed.

### Implementation

- A single guard at the top of the request handler in
  [api.ts](../../packages/cli/src/server/api.ts) intercepts any path
  starting with `/api/` that isn't `/api/v1/...` and returns the 404.
- All 44+ route matchers were rewritten to `/api/v1/<resource>` (no
  internal canonicalization to a different form — what the matcher matches
  is what the public contract is).
- `packages/dashboard/src/App.tsx` defines a single `API_BASE = '/api/v1'`
  constant. All `fetch` calls use `` `${API_BASE}/...` `` template literals.
  Future bumps are a single-line change.
- `packages/cli/src/server/mcp.ts` updated to call `/api/v1/...`.
- `packages/cli/templates/spring-boot/Jenkinsfile` updated to call
  `/api/v1/...` for deployment tracking.
- **External APIs we consume** (`${jenkins}/api/json`,
  `${grafana}/api/health`) intentionally stay as-is — they aren't ours.
  Documented in the API CLAUDE.md to prevent drive-by "fixes."

## Consequences

### Positive

- **Breaking changes are safely shippable.** Add v2 alongside v1, migrate
  consumers one at a time, eventually remove v1.
- **Single API_BASE in dashboard** makes future bumps a one-line change
  instead of a 41-call-site refactor.
- **Server is loud about deprecated paths.** A user (or a future
  integration we forgot about) hitting `/api/projects` gets an actionable
  error message immediately, not a confusing "no such route."
- **Self-documenting.** The version is in every URL. Everyone reading
  logs, traces, or fetch calls sees what version is in use.

### Negative

- **One-time migration cost.** All existing internal callers had to be
  updated in a single PR. Done once; doesn't recur.
- **Slight verbosity.** `/api/v1/projects/foo/logs` is longer than
  `/api/projects/foo/logs`. Acceptable.
- **Strict 404 instead of accepting both.** We considered accepting the
  unversioned form too (silent canonicalization). Rejected because it
  hides bugs — a forgotten `/api/...` call should fail loudly, not
  silently work and then break in a subtle way at v2.

### Risks / follow-ups

- **External integrations we don't know about.** If someone has a script
  hitting `/api/projects` directly, this breaks them. Mitigated by the
  helpful error message body. The CLI is pre-1.0 and we own all known
  callers.
- **No deprecation policy for v1 itself yet.** We haven't said "v1 will
  be supported until X." Worth establishing when we ship v2 — likely
  "support v1 for one minor version after v2 ships."
- **`API_BASE` is in the dashboard only.** MCP and Jenkinsfile have the
  paths inlined. If we wanted a single source of truth across all
  consumers, we'd need a generated client (see future ADR if we go
  OpenAPI-first).

## Alternatives considered

- **Header-based versioning** (`Accept: application/vnd.blissful-infra.v1+json`).
  More flexible (the URL doesn't change with version), but invisible —
  hard to test by clicking a link, hard to spot in logs. Rejected;
  visibility wins.
- **Accept both `/api/...` and `/api/v1/...`** (canonicalize the
  unversioned form). Easier migration, but hides forgotten-to-migrate
  calls. Rejected (see Consequences > Negative).
- **No versioning, just promise non-breaking changes.** Works at small
  scale until it doesn't. We have multiple consumers we don't always
  ship together (MCP, Jenkins). Rejected.
- **Major version in subdomain** (`v1.api.blissful-infra.com`). Doesn't
  apply locally; we serve everything off port 3002. Rejected for not
  fitting the deployment shape.
- **Generate clients from OpenAPI** (single source of truth). Considered
  during this discussion. Higher leverage but bigger refactor (~1 day).
  Worth doing if/when we add a third API consumer or external users.
  Deferred — not rejected.

## References

- [packages/cli/src/server/api.ts](../../packages/cli/src/server/api.ts) —
  guard logic + all v1 route matchers
- [packages/cli/CLAUDE.md](../../packages/cli/CLAUDE.md) — API versioning
  section explains the strict-404 behavior to future contributors
- [packages/dashboard/src/App.tsx](../../packages/dashboard/src/App.tsx) —
  `API_BASE` constant
