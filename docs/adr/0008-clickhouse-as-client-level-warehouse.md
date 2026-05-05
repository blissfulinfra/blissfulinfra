# 0008. ClickHouse and LocalStack are client-level shared resources

- **Status:** Accepted (template wiring landed 2026-05-04)
- **Date:** 2026-05-02
- **Deciders:** @cavanpage

## Context

Plugins that produce derived/analytical data (`ai-pipeline` today;
forecasting, anomaly detection, analytics events tomorrow) currently
re-invent their own data substrate. `ai-pipeline` runs its own ClickHouse
instance scoped to one plugin invocation. The planned analytics pipeline
(see [specs/analytics.md](../../specs/analytics.md)) wants its own
ClickHouse. The proposed forecasting work would want yet another store.

Without a canonical analytical store at the client level:

- Each plugin pays the infra cost of its own warehouse
- Cross-plugin queries are impossible (forecasting can't read analytics' sessions table)
- Schema conventions, retention, and namespacing have to be designed per-plugin
- Migration path to cloud (each plugin would need a separate managed warehouse) is multi-front

The pattern in the rest of the platform is clear: shared infrastructure
lives at client level (Kafka, Postgres, Jenkins, observability). The
warehouse should match.

The user feedback that triggered this: *"where do you plan to store the
forecasts ? we should establish maybe a common data in and out contract
for these plugins, i would like it to go to another plugin like
datawarehouse or something."*

## Decision

**ClickHouse and LocalStack are promoted to first-class client-level
infrastructure**, alongside Kafka, Postgres, and Jenkins. Every client
gets a single ClickHouse and a single LocalStack instance, both available
to all services and plugins on the shared `<client>_infra` Docker network.

The two together form the analytical-data substrate of a client:
LocalStack provides S3-compatible object storage (cold/raw data),
ClickHouse provides the columnar query layer, and ClickHouse's `s3()`
table function can read directly from LocalStack S3 — a real lakehouse
pattern locally.

### What changes today

1. `ClientInfrastructure.observability.clickhouse` already exists as an
   opt-in flag. **Default flips to `true`** — ClickHouse is on by default
   for new clients.
2. **New flag `ClientInfrastructure.localstack: boolean`**, defaulting to
   `true`. LocalStack runs on the client `infra` network, available to
   every service.
3. `PortBlockSchema` gains `clickhouse: number` and `localstack: number`
   — formalizes what was previously hardcoded (8123, 4566).
4. Init scripts at client level (`<client>/clickhouse/init/*.sql` and
   `<client>/localstack/init/*.sh`) create a default `warehouse` database
   in ClickHouse and a small set of shared resources in LocalStack.
   Service-specific resources (per-service buckets, DynamoDB tables) are
   created by the service's own scaffolding.
5. The `ai-pipeline` plugin and any future analytical plugin uses the
   client-level ClickHouse instead of standing up their own — referenced
   via env vars `WAREHOUSE_HOST` / `WAREHOUSE_PORT` injected into service
   compose.
6. The `lambda-python` backend (ADR-0007) drops its **per-service**
   LocalStack and references the **client-level** one. Container name
   `<client>-localstack` instead of `<client>-<service>-localstack`.

### LocalStack: client-level vs per-service trade-off

This was discussed at length. Honest picture:

**Pro client-level (decision):**
- One LocalStack per client (300 MB RAM saved per service that previously had its own)
- Real AWS pattern: one account, multiple services share buckets/tables
- ClickHouse can read directly from LocalStack S3 over the shared network
- Cross-service S3 sharing for free (one service uploads, another reads)

**Pro per-service (rejected for default):**
- Test isolation between services (one service's bucket changes don't affect another's tests)
- Different `SERVICES=` configurations per service
- Mirrors per-service IAM-role isolation patterns

The `localstack` plugin remains available as an **opt-in service-level
LocalStack** for users who want strong test isolation. The default is
the client-level shared one.

### What is intentionally NOT in this ADR

- **Plugin data contract** (declarative inputs/outputs in `plugin.yaml`,
  schema namespacing rules, table-claim conventions). This is the
  meaningful follow-up but adds significant scope. Punted to a separate
  ADR once we have one or two plugins using the warehouse and we can
  design the contract from real usage.
- **Migration of `ai-pipeline`** off its own ClickHouse onto the
  client-level one. Requires re-scaffolding existing instances; will
  ship in a follow-up PR with the plugin-contract work.
- **Cloud deploy adapter** for managed ClickHouse (ClickHouse Cloud,
  Tinybird, BigQuery as the warehouse). Future ADR.
- **Backup, retention, schema migration tooling**. None of this is in
  v1. Users who care can `clickhouse-client` directly. Defer until pain.

### Why ClickHouse and not DuckDB / Iceberg / TimescaleDB

The full discussion is in the conversation log; the short version:

- **ClickHouse** is already in the `ai-pipeline` plugin. Promoting it is
  mechanical, not new infrastructure. Mature, fast, columnar, great for
  time-series and event data. Cloud migration: ClickHouse Cloud,
  Tinybird, or self-hosted.
- **DuckDB** is more architecturally elegant (no service, embedded) but
  introduces a new mental model alongside the existing service-based
  infra. Defer.
- **Iceberg + S3** is the most production-modern but heaviest to set up
  locally. Out of scope.
- **TimescaleDB** is Postgres-native but less powerful for ad-hoc
  analytics. Postgres is already client-level for transactional data;
  mixing analytics in there ruins both workloads.

## Consequences

### Positive

- **Single warehouse per client.** `ai-pipeline`, future analytics,
  forecasting, anomaly detection — all read/write the same store. Cross-cutting queries become trivial.
- **Less infra cost per plugin.** Plugins drop their own ClickHouse
  containers (one shared instance instead of N).
- **Mirrors real data stacks.** Warehouse + multiple readers + multiple
  writers is the standard pattern at every shop with serious analytics.
- **Cloud migration is one-front.** Replace local ClickHouse with managed
  ClickHouse, every plugin's connection string changes via env var, done.
- **POC is small.** The infrastructure piece is just promoting a flag.
  The interesting work (plugin contract) is deferred — we'll learn what
  it should look like by using the warehouse first.

### Negative

- **Always-on cost.** ClickHouse uses ~200-400 MB RAM idle. Adds to the
  per-client laptop footprint. Users with `--no-warehouse` are unaffected.
- **Single-warehouse means single failure domain.** If ClickHouse dies,
  every plugin reading from it loses access. Acceptable for local dev;
  worth flagging for cloud where managed ClickHouse + multiple replicas
  are appropriate.
- **No schema enforcement at platform level (yet).** Plugins write what
  they want. The plugin contract ADR will fix this.
- **Existing `ai-pipeline` plugin instances run their own ClickHouse**
  until migrated. Two ClickHouses on a laptop until that work lands.

### Risks / follow-ups

- **The plugin contract ADR is the real architectural work.** This ADR
  is just the foundation. The contract — who owns which tables, how
  migrations work, how schemas are namespaced, how readers know what's
  available — is what makes this useful at scale. Do not let "we have a
  warehouse now" stop short of "plugins use it cleanly."
- **Migration tooling is missing.** Without a plugin contract, every
  plugin's tables are a free-for-all. As we add plugins, conflicts will
  emerge (two plugins both want a `predictions` table).
- **Backup story.** ClickHouse data lives in a Docker volume. Lost
  if the volume is pruned. Document for users; address properly when
  cloud-deploy lands.

## Alternatives considered

- **Keep ClickHouse plugin-scoped.** Each plugin owns its own. **Rejected**
  because it makes cross-plugin queries impossible and triples infra cost
  on a laptop running 3+ analytical plugins.
- **Use Postgres for analytics.** Postgres is already client-level.
  **Rejected** — Postgres is fine for small analytical queries but
  degrades on large fact tables; mixing OLTP and OLAP workloads on one
  database hurts both.
- **DuckDB embedded in each service.** No shared service to run.
  **Rejected** for now (interesting; defer until users need cross-process
  zero-ops). Mentioned in the conversation as an option for a future ADR.
- **Build the full plugin contract first, then promote.** **Rejected**
  for scoping reasons — the user wants a POC. Promote first, design the
  contract from real usage.

## References

- [specs/analytics.md](../../specs/analytics.md) — the analytics pipeline
  was the first place we noted this gap
- ADR-0002 (per-client isolation) — the boundary the warehouse fits inside
- ADR-0003 (unified compose project) — ClickHouse rides the same shape
- Conversation log 2026-05-02 (warehouse + plugin contract discussion)
