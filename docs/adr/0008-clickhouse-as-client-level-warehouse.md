# 0008. ClickHouse is the client-level analytical warehouse

- **Status:** Proposed
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

**ClickHouse is promoted from a per-plugin opt-in to a first-class
client-level infrastructure component**, alongside Kafka, Postgres, and
Jenkins. Every client gets a single ClickHouse instance available to all
its services and plugins.

### What changes today

1. `ClientInfrastructure.observability.clickhouse` already exists as an
   opt-in flag. **Default flips to `true`** — ClickHouse is on by default
   for new clients. Users who want to skip it pass `--no-warehouse` (or
   uncheck "Warehouse (ClickHouse)" in the interactive prompt).
2. ClickHouse gets its own host port allocation in `PortBlockSchema`
   (`clickhouse: number`) — the existing `8123 + blockIndex` math is
   formalized.
3. An init script creates a default `warehouse` database when ClickHouse
   first starts. Tables get created by plugins/services as they need
   them (no central schema for now).
4. The `ai-pipeline` plugin and any future analytical plugin uses the
   client-level ClickHouse instead of standing up their own — referenced
   via the standard env vars `WAREHOUSE_HOST` / `WAREHOUSE_PORT` /
   `WAREHOUSE_DATABASE` injected into service compose.

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
