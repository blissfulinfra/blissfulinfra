# Cloud Deploy — Design Spec

Local prototype → cloud deploy in one command. No Terraform, no DevOps team required.

---

## Goals

- Solo developer deploys an app to real infrastructure as easily as they ran it locally
- Cloudflare Workers + Pages ships first; Vercel and AWS follow
- Each platform maps local modules to its native equivalents automatically
- The config schema is the contract — platform differences are adapter concerns, not user concerns

---

## Deploy targets

```
local-only   default, no deploy capability
cloudflare   CF Workers (backend) + CF Pages (frontend) + D1 + KV + Queues
vercel       Vercel Functions + Vercel frontend + Vercel Postgres
aws          ECS Fargate + RDS + SQS + S3/CloudFront
```

Defined in `packages/shared/src/schemas/config.ts` as `DeployTargetSchema`.

---

## `blissful-infra.yaml` shape

```yaml
name: my-app
backend: express        # express and hono work natively on CF Workers
frontend: react-vite
modules:
  database:
    engine: postgres    # maps to D1 on cloudflare, Vercel Postgres on vercel, RDS on aws
deploy:
  target: cloudflare
  cloudflare:
    accountId: abc123
    workerName: my-app-api
    pagesProject: my-app-frontend
```

The `deploy.target` field drives all deployment behaviour. Platform-specific blocks
(`cloudflare`, `vercel`, `aws`) are optional — the CLI can prompt for missing values
on first deploy and write them back to the file.

---

## Module → platform mapping

Each module type has a local Docker implementation and a cloud adapter per platform.

| Module     | Local              | Cloudflare     | Vercel              | AWS            |
|------------|--------------------|----------------|---------------------|----------------|
| `database` | Postgres container | D1 (SQLite)    | Vercel Postgres      | RDS Postgres   |
| `cache`    | Redis container    | CF KV          | Upstash Redis        | ElastiCache    |
| `queue`    | Kafka container    | CF Queues      | Upstash QStash       | SQS            |
| Backend    | Docker container   | CF Worker      | Vercel Functions     | ECS Fargate    |
| Frontend   | nginx container    | CF Pages       | Vercel               | S3+CloudFront  |

The module system is defined in `ModulesSchema` in `config.ts`. `cache` and `queue`
modules are not yet in the schema — add them as they become relevant.

---

## `deploy.ts` — dispatcher design

The current `deploy.ts` is Kubernetes/ArgoCD only. Replace it with a target dispatcher:

```
deployAction(name, opts)
  → load config
  → switch config.deploy.target
      'cloudflare' → deployCloudflare(config, opts)
      'vercel'     → deployVercel(config, opts)
      'aws'        → deployAws(config, opts)
      'local-only' → error: set a deploy target in blissful-infra.yaml
```

Each platform function lives in its own file under `src/deploy/`:

```
src/deploy/
  index.ts        ← dispatcher (deployProject)
  errors.ts       ← DeployTargetError, PrereqMissingError, DeployFailedError
  cloudflare.ts   ← wrangler wrapper
  vercel.ts       ← vercel CLI wrapper
  aws.ts          ← CDK wrapper
```

---

## Cloudflare adapter — `deploy-cloudflare.ts`

### Prerequisites check
- `wrangler` CLI is installed (`wrangler --version`)
- User is authenticated (`wrangler whoami`)
- `config.deploy.cloudflare.accountId` is present (prompt if missing)

### Worker deploy (backend)

Only `express` and `hono` backends are compatible with CF Workers. Warn and exit if
the project uses `spring-boot`, `fastapi`, or `go-chi` — those runtimes cannot run
on the Workers edge.

```
1. Run wrangler deploy from the backend directory
2. Output the deployed worker URL
```

A `wrangler.toml` is generated at scaffold time for CF-targeted projects (or on first
deploy if the project was created without a target). Variables:

```toml
name        = config.name + "-api"
main        = "src/index.ts"
compatibility_date = <current date>

[[d1_databases]]           # if modules.database.engine != "none"
binding = "DB"
database_name = config.name
database_id   = <created on first deploy>
```

### D1 database (if database module is enabled)

```
1. wrangler d1 create <name>  (skip if database_id already in config)
2. Write database_id back to blissful-infra.yaml
3. wrangler d1 migrations apply <name>  (runs any pending SQL migrations)
```

Migration files live in `backend/migrations/*.sql`. The scaffold generates a
`0001_init.sql` from the Postgres schema, translated to SQLite-compatible DDL.

### CF Pages deploy (frontend)

```
1. npm run build  in the frontend directory
2. wrangler pages deploy dist --project-name <pagesProject>
3. Output the pages URL
```

Create the Pages project on first deploy if it doesn't exist:
```
wrangler pages project create <pagesProject>
```

### Summary output

```
✓ Worker deployed   https://my-app-api.<account>.workers.dev
✓ D1 migrations     3 applied
✓ Pages deployed    https://my-app-frontend.pages.dev
```

---

## `registry.ts` — guard for non-Docker targets

`getRegistryUrl`, `loginToRegistry`, and `pushImage` are Docker-image operations that
have no meaning for Cloudflare or Vercel deploys. Add an early return:

```ts
if (config.deploy?.target === 'cloudflare' || config.deploy?.target === 'vercel') {
  return; // no image registry for edge/serverless targets
}
```

`getImageName` should also reflect this — return `null` or throw for non-Docker targets
rather than defaulting to the local registry URL.

---

## `config.ts` util — migration

The CLI config util reads/writes `blissful-infra.yaml`. It needs to handle:

1. **Old flat field** — `deployTarget: "local-only"` was the previous shape. On read,
   migrate to `deploy: { target: "local-only" }` transparently.
2. **New nested shape** — `deploy.target` + optional platform block.

Do this migration at parse time in `loadConfig()` so the rest of the codebase only
sees the new shape.

---

## Scaffold changes for CF-targeted projects

When `blissful-infra start my-app --target cloudflare` (or `deploy.target` is set at
creation time):

- Generate `backend/wrangler.toml` with bindings stubbed out
- Generate `backend/migrations/0001_init.sql` (SQLite DDL)
- Skip: `docker-compose.yaml` entries for the database (use D1 locally via wrangler dev)
- Skip: Kafka/Redis containers (CF Queues/KV are accessed via wrangler bindings locally)

Local dev for CF projects uses `wrangler dev` rather than `docker compose up` for the
backend. The `blissful-infra dev` command should detect `deploy.target === 'cloudflare'`
and start wrangler dev instead of the Docker container.

---

## Implementation order

### Phase A — shipped

1. ✅ **`src/deploy/errors.ts`** — `DeployTargetError`, `PrereqMissingError`, `DeployFailedError`
2. ✅ **`src/deploy/index.ts`** — target dispatcher (`deployProject` function)
3. ✅ **`src/deploy/cloudflare.ts`** — wrangler wrapper: worker + D1 + Pages + KV
4. ✅ **`src/deploy/vercel.ts`** — vercel CLI wrapper (build + deploy --prebuilt)
5. ✅ **`src/deploy/aws.ts`** — CDK deploy wrapper
6. ✅ **`src/commands/deploy.ts`** — rewritten to use dispatcher; ArgoCD/kubectl removed
7. ✅ **`src/commands/start.ts`** — `--deploy-target` flag; generates `wrangler.toml` for CF projects
8. ✅ **`packages/shared/src/schemas/config.ts`** — added `"gcp"` to `DeployTargetSchema`

### Phase B — next

1. **`registry.ts` guard** — CF/Vercel targets skip Docker image operations
2. **`config.ts` migration** — old flat `deploy_target` field → new nested `deploy.target` at read time
3. **Scaffold: SQLite migration template** — `backend/migrations/0001_init.sql` for D1
4. **`dev` command CF mode** — detect CF target, run `wrangler dev` instead of Docker

Vercel and AWS adapters follow the same pattern. The Vercel adapter is already stubbed — it needs
`vercel env` provisioning for Postgres/Upstash once the basic deploy flow is validated.

---

## Open questions

- **CF Workers runtime compatibility**: Express can run on Workers via the `nodejs_compat`
  flag. Validate this works end-to-end with the existing Express template before committing
  to it as the CF backend default. Hono may be a cleaner fit as a dedicated CF template.

- **Local D1 in dev**: `wrangler dev` runs a local SQLite instance that mirrors D1.
  Confirm migration files apply correctly in local mode before shipping.

- **Mixed targets**: A project may want CF Pages for the frontend but keep a Docker
  backend (e.g. FastAPI). The module system supports this in principle — the frontend
  module could have a different target than the backend. Defer this until the single-target
  path is solid.
