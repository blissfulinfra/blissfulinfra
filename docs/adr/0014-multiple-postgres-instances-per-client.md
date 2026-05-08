# 0014. Multiple Postgres instances per client

- **Status:** Proposed
- **Date:** 2026-05-05
- **Deciders:** @cavanpage

## Context

The client model currently provisions exactly one Postgres instance per client ([infra-compose.ts:131-153](../../packages/cli/src/utils/infra-compose.ts#L131-L153)) with a single database named after the client. This is fine when every service in a client shares one logical database, but it forecloses several legitimate scenarios:

- **Version skew:** a service still on Postgres 14 alongside services on Postgres 16
- **Hard isolation:** a regulated dataset (e.g., the identity vault from [ADR-0012](./0012-data-governance-and-dsar-enforcement.md)) on its own Postgres process with separate creds and backups
- **Tuning divergence:** an OLAP-shaped workload that wants different `shared_buffers` / `max_connections` than the default OLTP service

The idiomatic answer for "service A and service B want different databases" is multiple databases inside a single Postgres process — which is also worth supporting and is genuinely cheaper. But "service A and service B want different Postgres processes" is a separate, equally legitimate need that the current schema doesn't express.

## Decision

The client config's `infrastructure.postgres` field becomes a **list of named instances**. Each instance gets its own container, port, volume, and credentials.

```yaml
# Shorthand — back-compat, equivalent to a single instance named "default".
infrastructure:
  postgres: true

# Canonical form — N instances. No instance is privileged in the schema.
infrastructure:
  postgres:
    - name: default
      version: "16"
    - name: legacy
      version: "14"
    - name: analytics
      version: "16"
      tuning:
        sharedBuffers: "512MB"
        maxConnections: "200"
```

### Schema (in `packages/shared/src/schemas/config.ts`)

```ts
export const PostgresInstanceSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  version: z.string().default("16"),
  tuning: z.record(z.string(), z.string()).optional(),
});

postgres: z.union([
  z.boolean(),                                  // shorthand
  z.array(PostgresInstanceSchema).min(1),       // canonical
]).default(true),
```

A pure helper `normalizePostgresInstances(value)` converts either shape to a canonical `PostgresInstance[]` for downstream code. `true` expands to `[{ name: "default", version: "16" }]`. `false` expands to `[]`.

### Compose generation

The single `postgres` block in `infra-compose.ts` becomes a loop over normalized instances. Per-instance naming:

| Property | Default instance (back-compat) | Other instances |
|---|---|---|
| Service key | `postgres` | `postgres-<name>` |
| Container name | `${clientName}-postgres` | `${clientName}-postgres-<name>` |
| Volume | `postgres-data` | `postgres-data-<name>` |
| Host port | `ports.postgres` | from expansion range |
| In-network hostname | `postgres` | `postgres-<name>` |

The "default" instance keeps its existing names so existing clients continue to work without migration.

### Port allocation

Add `postgresInstances?: Record<string, number>` to `PortBlockSchema`. The default instance keeps `ports.postgres`. Non-default instances are allocated from an expansion range starting at base `5600`, computed deterministically as `5600 + blockIndex * 10 + extraIndex` where `extraIndex` is the instance's position among non-default entries (0-based). This caps each block at 10 extra Postgres instances, which is well above realistic need.

### Service binding

The service infra-deps manifest gains a `postgres` shape that names the instance and the databases the service needs:

```yaml
# In a service's infra-deps declaration
postgres:
  instance: legacy            # omit = "default"
  databases: [orders, audit]  # CREATE DATABASE … run idempotently at service add
```

`service add` wires `DATABASE_URL` to point at the named instance via its in-network hostname. Service templates that hardcoded `postgres:5432` continue to work for the default instance but must qualify when targeting a non-default instance.

### Data-classification manifest qualifier ([ADR-0012](./0012-data-governance-and-dsar-enforcement.md))

The `storage` qualifier becomes `postgres:<instance>:<database>`:

```yaml
- field: identity_vault.users.email
  storage: postgres:default:identity_vault       # vault stays on the default instance
- field: orders.line_items
  storage: postgres:legacy:orders                # legacy on its own instance
```

DSAR/erase adapters route each operation to the right instance.

### CLI surface

```bash
blissful-infra client infra add <client> postgres <name> [--version 16]
blissful-infra client infra remove <client> postgres <name>
```

Both edit `client.yaml`, prompt for confirmation, and re-run `regenerateInfraCompose`. Removing an instance does **not** delete its volume — the volume must be deleted manually (or via a separate `--purge-data` flag, deferred).

## Consequences

- **Positive:**
  - Real version-skew, isolation, and tuning use cases become expressible without escape hatches
  - `default` instance keeps existing names — zero migration burden for current clients
  - Schema generalizes to other multi-instance services (`redis`, `clickhouse`) without inventing new "-extra" suffixes
  - Data-classification manifest qualifier (`postgres:<instance>:<database>`) cleanly carries the instance dimension into ADR-0012 erasure paths
- **Negative:**
  - More infra to operate per client (each extra instance is a real Postgres process eating RAM/disk)
  - Port pressure: each extra instance burns one host port from the expansion range
  - Service templates have to know which instance they target — adds a small amount of wiring complexity
- **Risks / follow-ups:**
  - **Backups:** the existing client backup story (such as it is) doesn't yet account for per-instance volumes. When backups are formalized, they must walk all instances.
  - **Migration tooling:** the legacy field `database: postgres` in `ProjectConfig` is single-instance by definition. Flat-model projects don't gain multi-instance support; only the client model does.
  - **Identity vault placement:** [ADR-0012](./0012-data-governance-and-dsar-enforcement.md) currently says the vault lives in "the per-client Postgres" — clarify that this means the instance named `default`, with a future option to point at a dedicated instance via config.
  - **`parseClientConfigYaml` parser:** the existing regex-based parser can't express the array form. Switch to `js-yaml` (currently a devDep) for the client config read path.

## Alternatives considered

- **Keep one Postgres, add multiple databases** — accepted as a complement, not a substitute. Service infra-deps already gain a `databases` field. But this doesn't address version skew, hard isolation, or process-level tuning, which require multiple instances.
- **`postgresExtra: [...]` with a privileged default** — rejected: implies a hierarchy that doesn't exist and doesn't generalize. "Why is one called 'default' and the others 'extra'?" is exactly the kind of question we're trying to avoid.
- **`postgres: { instances: [...] }` (object with nested list)** — rejected: more verbose for the common case; the discriminated union (`true | Instance[]`) keeps the shorthand readable while supporting the rich form.
- **Dynamic port allocation (allocate-on-add, store in registry)** — rejected: deterministic computation from `blockIndex + extraIndex` is simpler and reproducible across machines. Reconsider if 10-instance cap becomes a real limit.
- **Each instance gets its own Compose project** — rejected: would defeat [ADR-0003](./0003-unified-compose-project-per-client.md). All instances stay in the unified per-client compose project.

## References

- [ADR-0002](./0002-per-client-isolation-model.md) — per-client isolation defines the boundary
- [ADR-0003](./0003-unified-compose-project-per-client.md) — unified Compose project (instances live inside it)
- [ADR-0012](./0012-data-governance-and-dsar-enforcement.md) — `storage:<instance>:<database>` qualifier originates here
- [packages/cli/src/utils/infra-compose.ts](../../packages/cli/src/utils/infra-compose.ts) — generator updated by this ADR
- [packages/cli/src/utils/client-registry.ts](../../packages/cli/src/utils/client-registry.ts) — port allocator updated by this ADR
- [packages/cli/src/utils/infra-deps.ts](../../packages/cli/src/utils/infra-deps.ts) — service binding updated by this ADR
