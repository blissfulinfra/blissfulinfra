---
title: blissful-infra deploy
description: Deploy your local project to Cloudflare, Vercel, or AWS with one command.
---

`blissful-infra deploy` takes the app you built locally and ships it to a real cloud environment. Set `deploy.target` in your `blissful-infra.yaml` to choose the platform — then run the same command every time.

## Usage

```bash
blissful-infra deploy [name] [options]
```

`[name]` is optional. If omitted, the CLI reads `blissful-infra.yaml` from the current directory.

## Options

| Flag | Description |
|------|-------------|
| `--dry-run` | Print what would be deployed without making any changes |

## Configuration

Set `deploy.target` in `blissful-infra.yaml` before running deploy:

```yaml
name: my-app
backend: express
frontend: react-vite
database: postgres
deploy:
  target: cloudflare   # cloudflare | vercel | aws
```

You can set the target at scaffold time so the project is ready from the start:

```bash
blissful-infra start my-app --deploy-target cloudflare
```

## Deploy targets

### Cloudflare

**Prerequisites:** `wrangler` CLI installed and authenticated.

```bash
npm install -g wrangler
wrangler login
```

**What deploys:**

| Local | Cloudflare |
|-------|-----------|
| React + Vite frontend | Cloudflare Pages |
| Express / Hono backend | Cloudflare Worker |
| Postgres database | Cloudflare D1 (SQLite) |
| Redis cache | Cloudflare KV |

The CLI calls `wrangler` for each step — you don't need to know the wrangler commands yourself. A `wrangler.toml` is generated in `frontend/` and `backend/` at scaffold time if you used `--deploy-target cloudflare`. If you're deploying an existing project, the CLI generates them on first deploy.

**Config block (optional):**

```yaml
deploy:
  target: cloudflare
  cloudflare:
    accountId: your-cf-account-id
    workerName: my-app-api
    pagesProject: my-app-frontend
```

If `accountId` is omitted, wrangler uses your default account from `wrangler login`.

### Vercel

**Prerequisites:** `vercel` CLI installed and authenticated.

```bash
npm install -g vercel
vercel login
```

**What deploys:** frontend via `vercel build` + `vercel deploy --prebuilt --prod`, backend via `vercel deploy --prod`.

Vercel uses real Postgres (not SQLite), so no DDL translation is needed. Configure `DATABASE_URL`, Redis (Upstash), and queue (QStash) environment variables in your Vercel project dashboard.

**Config block (optional):**

```yaml
deploy:
  target: vercel
  vercel:
    orgId: your-org-id
    projectId: your-project-id
```

### AWS

**Prerequisites:** AWS CLI and CDK installed and configured.

```bash
brew install awscli
npm install -g aws-cdk
aws configure
```

**What deploys:** CDK stacks via `cdk deploy --all`. The scaffold generates CDK stacks for ECS Fargate (backend), S3 + CloudFront (frontend), and RDS Postgres (database).

**Config block (optional):**

```yaml
deploy:
  target: aws
  aws:
    region: us-east-1
    cluster: my-app-cluster
```

## Examples

```bash
# Deploy from the project directory
cd my-app
blissful-infra deploy

# Deploy by project name from parent directory
blissful-infra deploy my-app

# Preview without making any changes
blissful-infra deploy --dry-run
```

## Module portability

The local modules map to platform-native equivalents so your application code doesn't change when you switch targets:

| Module | Local | Cloudflare | Vercel | AWS |
|--------|-------|------------|--------|-----|
| Frontend | nginx | CF Pages | Vercel | S3 + CloudFront |
| Backend | Docker | CF Worker | Vercel Functions | ECS Fargate |
| Database | Postgres | D1 (SQLite) | Vercel Postgres | RDS |
| Cache | Redis | CF KV | Upstash Redis | ElastiCache |
| Queue | Kafka | CF Queues | Upstash QStash | SQS |

To switch platforms, change `deploy.target` in `blissful-infra.yaml` and run `blissful-infra deploy` again.

## Error handling

**Missing target:** If `deploy.target` is `local-only` or not set, the CLI prints the config block you need to add and exits.

**Missing prerequisite:** If `wrangler`, `vercel`, or `aws` is not installed, the CLI prints the exact install command and exits.

**Deploy failure:** The CLI surfaces the underlying error output and exits with the same code as the failing tool.
