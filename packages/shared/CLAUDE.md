# packages/shared — @blissful-infra/shared

The schema contract layer for the blissful-infra monorepo. Private (never published to npm). Both `packages/cli` and `packages/dashboard` import from here.

**Single source of truth** for all types that cross a domain boundary. No type should be defined twice. If it lives here, it does not live in the consumer.

See root [CLAUDE.md](../../CLAUDE.md) for monorepo conventions.

---

## Why this package exists

The CLI API server and the dashboard were previously out of sync — 25 interface definitions in `App.tsx` shadowed types in `api.ts` with subtle field differences. This package eliminates that class of bug by making the schema the contract.

**Rule:** If data crosses a boundary (HTTP, JSONL storage, YAML config), its shape belongs here.

---

## Package structure

```
src/
├── index.ts          # Re-exports everything — the only import path consumers use
└── schemas/
    ├── api.ts        # HTTP request/response shapes (ProjectStatus, Service, HealthResponse, etc.)
    ├── alerts.ts     # AlertThreshold, TriggeredAlert, AlertsConfig
    ├── config.ts     # blissful-infra.yaml config schemas (ProjectConfig, ClientConfig, ServiceConfig, PortBlock, ClientRegistry)
    ├── deployments.ts # DeploymentRecord, CreateDeploymentRequest, UpdateDeploymentRequest
    ├── logs.ts       # StoredLogEntry, LogRetentionConfig
    ├── metrics.ts    # ContainerMetrics, HttpMetrics, StoredMetrics
    └── plugins.ts    # PluginDef, PluginCategory, PluginStatus
```

---

## Schema conventions

All schemas use **Zod** as the definition layer. TypeScript types are always **inferred** from schemas — never written by hand.

```ts
// Define the schema
export const FooSchema = z.object({ id: z.string(), value: z.number() });

// Infer the type — never write `interface Foo { id: string; value: number }`
export type Foo = z.infer<typeof FooSchema>;
```

Both the schema and the inferred type are exported from the same file. Consumers import whichever they need:

```ts
// For runtime validation (API server, storage layers):
import { FooSchema } from "@blissful-infra/shared";
const result = FooSchema.safeParse(rawInput);

// For type annotations only (dashboard, command handlers):
import { type Foo } from "@blissful-infra/shared";
```

---

## Build

```bash
# From packages/shared/:
npm run build     # tsc → dist/
npm run dev       # tsc --watch

# From repo root:
npm run build:shared
```

**Must build before the CLI or dashboard.** The root `npm run build` handles this ordering automatically (shared → cli → dashboard).

---

## Adding a new schema

1. Add it to the appropriate file in `src/schemas/` (or create a new file if it's a new domain).
2. Export the schema and its inferred type.
3. Re-export from `src/index.ts` if you created a new file.
4. Run `npm run build:shared` to compile.
5. Import in the consumer — no other setup needed.

Do not add schemas for types that are only used internally within one package. Those stay local.

---

## Consumer import pattern

```ts
// Always import from the package name, never from a relative path:
import { DeploymentRecordSchema, type DeploymentRecord } from "@blissful-infra/shared";

// NOT: import { ... } from "../../shared/src/schemas/deployments.js";
```
