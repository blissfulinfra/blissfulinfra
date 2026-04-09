# API Schema-First Code Generation

## Overview

blissful-infra can generate typed API clients, server controller stubs, and Zod schemas from an OpenAPI 3.x spec. Define the `api:` block in `blissful-infra.yaml`, point it at your spec file, and declare what to generate. The CLI handles the rest.

```bash
blissful-infra generate          # run all configured generators
blissful-infra generate --watch  # re-run on spec changes
blissful-infra generate --dry-run  # preview without writing files
```

---

## Configuration

Add an `api:` block to `blissful-infra.yaml`:

```yaml
name: my-app
backend: spring-boot
frontend: react-vite
database: postgres

api:
  spec: ./openapi.yaml            # relative to project root
  generate:
    client:
      language: typescript        # typescript (default) | python | kotlin
      output: ./frontend/src/api
    server:
      framework: spring-boot      # spring-boot | fastapi | express
      output: ./backend/src/generated
      package: com.example.api    # Java/Kotlin — sets apiPackage and modelPackage
    types:
      output: ./frontend/src/api/types.ts
      runtime: zod                # zod | none
```

All `generate:` sub-keys are optional — only configured generators run.

---

## Generators

### `client: typescript`

**Tool:** [`openapi-typescript`](https://openapi-ts.dev) + [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/)

Generates:
- `{output}/index.ts` — TypeScript path/operation types derived directly from the spec
- `{output}/client.ts` — Typed fetch wrapper using `openapi-fetch`

```typescript
// Before — raw fetch, no types
const res = await fetch(`/api/items/${id}`)
const item = await res.json()  // typed as `any`

// After — fully typed, throws on non-2xx
import { client } from "@/api/client"
const { data } = await client.GET("/api/items/{id}", { params: { path: { id } } })
// data is typed as components["schemas"]["Item"]
```

The client constructor accepts a `baseUrl` for pointing at different environments.

### `server: spring-boot`

**Tool:** [`@openapitools/openapi-generator-cli`](https://openapi-generator.tech) via `npx`

Generates Spring Boot controller interfaces with `interfaceOnly=true` — engineer implements the `@Service` layer, the generated interface defines the contract:

```kotlin
// Generated — do not edit
@Api(tags = ["items"])
interface ItemsApi {
    @GetMapping("/api/items")
    fun listItems(@RequestParam limit: Int?): ResponseEntity<ItemListResponse>

    @PostMapping("/api/items")
    fun createItem(@RequestBody body: CreateItemRequest): ResponseEntity<Item>
}
```

The `package` config maps to `apiPackage` and `modelPackage`:
- `com.example.api` → interfaces at `com.example.api.api`, models at `com.example.api.model`

**Prerequisite:** Java 11+ on PATH (required by openapi-generator-cli's jar).

### `types: { runtime: zod }`

**Tool:** [`openapi-zod-client`](https://github.com/astahmer/openapi-zod-client)

Generates Zod schemas for every OpenAPI component and path, enabling runtime validation in addition to compile-time types:

```typescript
import { ItemSchema, CreateItemRequestSchema } from "@/api/types"

const item = ItemSchema.parse(rawResponse)  // validates at runtime
```

When `runtime: none`, generates plain TypeScript interfaces only (no runtime validation).

---

## First-run scaffold

When `blissful-infra start` creates a new project and the config includes an `api:` block, the CLI:
1. Copies `templates/openapi/openapi.yaml` to the `spec` path if it doesn't exist — a starter spec with health check, list, get, and create endpoints
2. Runs all configured generators automatically

```bash
blissful-infra start my-app --deploy-target local-only
# → creates openapi.yaml
# → generates frontend/src/api/index.ts + client.ts
```

---

## Watch mode

`--watch` uses chokidar to monitor the spec file. On every save:

```bash
$ blissful-infra generate --watch
✓ TypeScript client → ./frontend/src/api
✓ Zod schemas → ./frontend/src/api/types.ts

Watching openapi.yaml for changes...
↺ Spec changed — regenerating...
✓ TypeScript client → ./frontend/src/api
✓ Zod schemas → ./frontend/src/api/types.ts
```

---

## Adding a new generator

1. Create `packages/cli/src/codegen/<name>.ts` exporting:
   ```typescript
   export async function generate<Name>(
     specPath: string,
     config: ApiGenerate<Name>,
     projectDir: string,
     dryRun = false
   ): Promise<void>
   ```
2. Add the config schema to `ApiGenerateSchema` in `packages/shared/src/schemas/config.ts`
3. Import and call from the orchestrator in `packages/cli/src/codegen/index.ts`

---

## Generated file ownership

Files under `generate.client.output`, `generate.server.output`, and `generate.types.output` are **owned by the generator**. Do not edit them manually — changes will be overwritten on the next `blissful-infra generate` run. Add the output directories to `.gitignore` or commit them as read-only artifacts, depending on your team's preference.
