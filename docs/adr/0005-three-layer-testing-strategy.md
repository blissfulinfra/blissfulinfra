# 0005. Test in three layers: schema/logic, compose validation, real Docker

- **Status:** Accepted
- **Date:** 2026-04-30
- **Deciders:** @cavanpage

## Context

The repo had zero tests for months. Every iteration on the client model
introduced bugs we'd already fixed in slightly different forms — the
"include external:true bleed" (ADR-0003), the LocalStack init script
permission bit, the `AWS_PUBLIC_ENDPOINT_URL` missing env var, the
DATABASE_URL pointing at a nonexistent DB. Each one was caught only by
a user reporting a runtime failure.

The user's pain was direct: *"I am getting in this cycle where I am
regressing the features. I want a foolproof method to test every time
I change something."*

We considered three rough strategies:

1. **Pure unit tests with mocks.** Fast but barely test the real risk
   surface — the bugs we kept hitting were YAML-quoting, network wiring,
   and integration-with-real-Docker bugs. Mocking Docker would mock
   away the bugs we needed to catch.
2. **All-integration, all-the-time.** Slow (each test ~30s+ for real
   Docker spin-up), flaky on CI, painful to run during inner loop.
3. **Layered.** Fast tests where possible, real tests where necessary.

The non-negotiable from the project rules was: *"integration tests should
hit real services."* Mocks were off the table for the integration layer.

## Decision

Three layers, each catching a different class of bug. Run them in increasing
order of cost.

### Layer 1 — Schema + pure logic (~ms each)

- Vitest, Node environment, no I/O
- Tests Zod schemas (accept/reject for representative valid + invalid
  shapes), pure functions (port allocation math), parsers, helpers
- Lives at `src/**/__tests__/*.test.ts` colocated with code
- Run on every save during development (`npm run test:watch`)

### Layer 2 — Compose validation (~hundreds of ms each)

- Vitest, generates real YAML to a temp dir, runs
  `docker compose config --quiet` to validate
- Tests YAML correctness — quoting, structure, network names, includes —
  without ever starting a container
- This layer would have caught most of the bugs we hit this week
  (notably the `external: true` bleed in ADR-0003)
- Lives in the same `__tests__/` dirs as Layer 1
- `docker compose config` only validates parsing — Docker daemon does
  not need to be running for most cases. Skips cleanly when daemon is
  unreachable

### Layer 3 — Integration (~minutes each)

- Vitest, spawns the actual `node packages/cli/dist/index.js` binary
- Real `docker compose up`, real containers, real
  Docker network creation, real health checks
- Each test gets a unique `BLISSFUL_HOME` via `mkdtemp` so it never
  pollutes the user's real `~/.blissful-infra/`
- Each test gets a unique client name (timestamp + random suffix) so
  parallel runs don't collide
- Best-effort cleanup in `afterAll` even on failure (`client remove`
  + temp-dir rm)
- Lives at `src/__tests__/integration/**/*.test.ts` (the `integration`
  segment is the marker)
- Excluded from default `npm test` (run via `npm run test:integration`)
- Excluded from production build via `tsconfig.json`

### npm scripts

```bash
npm test                  # L1 + L2 (~400ms total, run before every commit)
npm run test:watch        # vitest watch
npm run test:integration  # L3 — real Docker, run before push
npm run test:all          # everything
```

### Production-code change required for testability

`packages/cli/src/utils/client-registry.ts` reads `BLISSFUL_HOME` from
the environment on every call (defaulting to
`os.homedir() + ".blissful-infra"`). One-line change. Lets tests
redirect the registry path without monkey-patching `os.homedir()`.

## Consequences

### Positive

- **Inner loop stays fast.** L1+L2 run in ~400ms. Vitest watch mode
  reruns on save. No friction to running tests constantly.
- **Bugs we hit get permanent regression coverage.** ADR-0003's
  `external: true` bleed got an L2 test the same hour. Future code
  changes that re-introduce the bug fail in milliseconds.
- **No mocks.** Tests exercise real schemas, real generators, real
  Compose, real Docker. False positives are minimal.
- **Each layer's failure tells you where the bug is.** L1 fails →
  schema/logic. L2 fails → YAML/compose. L3 fails → Docker/runtime.
- **CI-friendly.** L1+L2 run on every PR cheaply. L3 runs on merge to
  main or on a slower cadence.

### Negative

- **L3 tests are slow.** First run pulls images (~2 min); subsequent runs
  are ~30-60s per test depending on healthcheck stability.
- **L3 tests need Docker locally.** Devs without Docker can run L1+L2 but
  not L3. Acceptable — blissful-infra is a Docker-first product.
- **Three test "modes" to understand.** Slightly more cognitive overhead
  than one-flat-test-suite. Mitigated by clear docs in CLAUDE.md and
  by the speed difference (you'll always know which mode you're in).
- **L2 depends on Docker daemon for the `compose config` calls.** Tests
  skip cleanly when Docker is down, but in CI without Docker they
  silently no-op. Visible in test counts.

### Risks / follow-ups

- **L3 coverage is sparse.** Today there's one integration test
  (client lifecycle, `--no-jenkins --no-observability` for speed).
  Need broader coverage of: service add with localstack, port-conflict
  bumping, multi-client isolation, `client clean -f`, `service down/up`
  cycle.
- **Snapshot testing not adopted.** L2 tests assert specific structural
  things (network names, service keys, port mappings) but don't snapshot
  the entire generated YAML. Snapshots would catch unintended changes
  but pay the maintenance cost of "diff approval." Defer.
- **No CI yet.** Tests run locally only. GitHub Actions setup is queued
  separately.

## Alternatives considered

- **Mocked Docker layer** (replace `execa("docker", ...)` calls with
  fakes). Faster, but the bugs we need to catch are *in the interaction
  with Docker*. Mocks would test our test-doubles, not Docker. Rejected
  per project rules.
- **End-to-end only** (skip L1+L2, do everything in L3). Each test is
  ~30s+ — run-test-on-save becomes impossible. Rejected for inner-loop
  experience.
- **Schema-only tests** (skip L2+L3). Cheap but barely tests the real
  surface. Rejected — schema tests catch maybe 10% of the bugs we've
  been hitting.
- **Snapshot testing for L2** (snapshot full compose output, diff on
  change). Adds maintenance cost for marginal coverage gain. Targeted
  structural assertions are usually enough. Defer.

## References

- [packages/cli/src/utils/__tests__/client-registry.test.ts](../../packages/cli/src/utils/__tests__/client-registry.test.ts) — Layer 1 example
- [packages/cli/src/utils/__tests__/infra-compose.test.ts](../../packages/cli/src/utils/__tests__/infra-compose.test.ts) — Layer 1 + 2 example
- [packages/cli/src/__tests__/integration/client-lifecycle.test.ts](../../packages/cli/src/__tests__/integration/client-lifecycle.test.ts) — Layer 3 example
- [CLAUDE.md](../../CLAUDE.md) — Testing convention section
- ADR-0003 (unified Compose project) — the bug whose regression lives in
  the L2 suite
