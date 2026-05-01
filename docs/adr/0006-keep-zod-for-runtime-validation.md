# 0006. Keep Zod as the runtime-validation layer at trust boundaries

- **Status:** Accepted
- **Date:** 2026-04-30
- **Deciders:** @cavanpage

## Context

`packages/shared` was built around Zod. Schemas are defined once,
TypeScript types are inferred via `z.infer`, and the same schema validates
inputs at runtime where data crosses a trust boundary (YAML files, HTTP
request bodies, on-disk JSON registries, env vars).

While reviewing the code in preparation for adding tests, we asked:
*does this need to be Zod, or are TypeScript interfaces enough?*

The honest answer is nuanced:

- **For purely internal types** (passing already-validated objects between
  TypeScript functions), TypeScript is enough. Zod adds nothing — the
  compiler already enforces shapes.
- **At trust boundaries**, TypeScript types are erased at runtime.
  `as ClientConfig` is a lie when the input is a parsed YAML file the
  user could have hand-edited; the cast crashes far from the source if
  the data is malformed.

The trust boundaries we have:

1. `blissful-infra.yaml` files (user-editable)
2. HTTP request bodies received by the API server (port 3002)
3. `~/.blissful-infra/registry.json` (could be from an older CLI version)
4. Env vars (technically — but rarely structured)

We considered four shapes:

- **A. Drop Zod entirely.** Convert all `z.object(...)` to `interface`.
  At trust boundaries, hand-roll `if (typeof x.name !== "string") throw ...`
  validators. Or YOLO and trust the data.
- **B. Keep Zod only at trust boundaries.** Most types become plain
  interfaces; ~5 schemas stay as Zod for the actual `parse()` call sites.
- **C. Plain object literals + tiny custom validator.** Schemas defined
  as plain TS object literals (`{ kind: "string", pattern: /.../ }`); a
  ~60-line generic `validate(schema, raw)` function. Interfaces alongside.
- **D. OpenAPI-first.** Single `openapi.yaml` defines HTTP contracts and
  config schemas; TypeScript types and JSON Schema validators are
  generated. Zod replaced by `ajv`.

The conversation went A → reconsider → B → reconsider → C → reconsider → D
→ reconsider → land on this ADR.

## Decision

**Keep Zod as it is today.** All current Zod schemas remain Zod schemas.
Future schemas at trust boundaries should also be Zod.

The pragmatic case for keeping Zod:

- It works. There are ~30 schemas in `packages/shared`, ~10 `.parse()`
  call sites that catch real bugs. Removing it costs ~½ day for no
  user-visible benefit.
- The "two mental models" (interface + schema) cost is overstated —
  in practice both come from the same source (`z.object(...) → z.infer`),
  so contributors only think in one direction.
- TypeScript-only would require either YOLO casts (loses runtime safety)
  or hand-rolled validators (~5x more code per validator vs. declarative
  Zod).
- OpenAPI-first is appealing long-term but is a multi-day refactor with
  no immediate user-facing payoff. Re-evaluate if/when we add a third
  external API consumer.

We keep an open door:

- If a future schema is *only* used internally (constructed and consumed
  in one module, never parsed from external input), it can be a plain
  TypeScript interface. We already do this (e.g. `ServicePorts` inside
  `service.ts`).
- If we add many more API consumers and contract drift becomes a real
  pain, OpenAPI-first (option D) is the right pivot at that point. Don't
  preempt it.

## Consequences

### Positive

- **No refactor cost today.** Zero migration risk, zero user-facing
  changes.
- **Runtime validation at trust boundaries stays.** A user-typo'd
  `blissful-infra.yaml` produces a clear "field X expected string, got
  number" error at parse time, not a confusing crash 10 stack frames
  later.
- **Single source of truth across packages.** `packages/shared` exports
  schema + inferred type; both CLI and dashboard import from one place.
  Drift between client/server is structurally impossible.
- **Tests stay simple.** L1 schema tests assert that schemas accept and
  reject the right things. The test pattern is unchanged.

### Negative

- **One library dependency.** Zod is well-maintained but it's still a
  dep. Adds ~10 KB to the published CLI bundle.
- **Two mental models in theory.** Contributors see both `interface Foo`
  and `const FooSchema = z.object(...) → type Foo = z.infer<...>` and
  may wonder when to use which. Mitigated by the rule below.
- **Slight runtime cost** at parse points (tens of microseconds). Invisible.

### Risks / follow-ups

- **Doesn't solve cross-API-consumer drift** at scale. If we add a third
  HTTP API consumer (beyond dashboard, MCP, Jenkinsfile), the lack of a
  generated client may bite. The watch-this-and-revisit trigger is
  *"adding a new API consumer felt painful and required hand-syncing
  shapes."*
- **Templates use `{{VAR}}` not Zod.** Templates are pre-compiled string
  files, not validated structures. That's fine for what they are, but
  means template-substitution bugs (unsubstituted `{{PROJECT_NAME}}`)
  can ship. A template-validation step is a separate concern, not a Zod
  concern.

## Rule of thumb (the one mental model)

> Zod when data crosses a trust boundary. Plain `interface` for everything
> internal.

Trust boundaries in this repo: YAML files on disk, HTTP request bodies,
JSON registries on disk. Everything else: interfaces.

## Alternatives considered

- **Option A: Drop Zod entirely.** ~½ day to migrate, hand-rolled
  validators at every parse point, ~5x more code per validator. Loses
  the auto-inferred-type ergonomics. Rejected — costs more than it
  saves.
- **Option B: Zod only at trust boundaries (~5 schemas), interfaces
  elsewhere.** This is essentially what we already have functionally.
  The non-trust-boundary Zod schemas are doing nothing harmful. Extra
  refactor for marginal benefit. Rejected as not worth the churn.
- **Option C: Custom mini-validator + plain object schemas.** Reinvents
  Zod with fewer features and zero deps. Saves 10 KB. Costs the
  user-extensibility, error-message quality, and ecosystem (Zod schemas
  feed into many other libs). Rejected.
- **Option D: OpenAPI-first.** Strongest long-term option. Single source
  of truth across HTTP API + config. Tooling explosion (Swagger UI, mock
  servers, generated clients). Multi-day refactor with no immediate
  payoff. Deferred — not rejected. Trigger: third external API consumer
  or breaking-change pain.

## References

- [packages/shared/CLAUDE.md](../../packages/shared/CLAUDE.md) — schema
  conventions
- [packages/shared/src/schemas/config.ts](../../packages/shared/src/schemas/config.ts) — current schemas
- [packages/shared/src/schemas/__tests__/config.test.ts](../../packages/shared/src/schemas/__tests__/config.test.ts) — Layer 1 schema tests
- ADR-0005 (testing strategy) — schema tests are Layer 1
