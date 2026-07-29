---
title: blissful-infra jenkins
description: Manage the Jenkins CI/CD server and register services with pipelines.
---

Jenkins runs the CI pipeline for your services: compile, lint, test, containerize, scan, push.

```bash
blissful-infra jenkins status
```

## Two Jenkins paths

Worth knowing before you start, because it explains a port clash you might hit.

**The tenant's Jenkins** is the one you normally want. Each tenant runs its own Jenkins container (`<tenant>-jenkins`) as part of its compose stack, started by `blissful-infra tenant up` and stopped by `tenant down`. Its port comes from the tenant's block — the first tenant gets 8081, the second 8082, and so on. This is what the dashboard's Pipeline tab reads, and it is fully isolated per tenant.

**The standalone `jenkins` command** predates the tenant model and manages a single separate `blissful-jenkins` container on a hardcoded `localhost:8081`. It has not been re-keyed to tenant coordinates yet.

For your first tenant both want port 8081, so run one or the other, not both. If you are working inside the tenant model, prefer `tenant up` and use the dashboard or `pipeline` to drive builds.

## Subcommands

| Subcommand | What it does |
|---|---|
| `jenkins start` | Start the standalone Jenkins server |
| `jenkins stop` | Stop it |
| `jenkins status` | Show status |
| `jenkins add-project <name>` | Register a project with Jenkins |
| `jenkins build <name>` | Trigger a build |
| `jenkins list` | List registered projects and their build status |

## jenkins start

```bash
blissful-infra jenkins start
```

Jenkins is a custom image (`blissful-jenkins:latest`) with the required plugins pre-installed. The first run builds it, which takes a couple of minutes and happens once. It is configured with Jenkins Configuration as Code, so there is no setup wizard.

Data persists in a Docker volume, so jobs and build history survive restarts.

## jenkins add-project

```bash
blissful-infra jenkins add-project <name>
```

Creates a pipeline job pointing at the project directory as its SCM source. Requires Jenkins to be running and the project to have a `Jenkinsfile`.

The job is idempotent — registering an already-registered project is a no-op.

## jenkins build

```bash
blissful-infra jenkins build <name>
```

Triggers a build and returns immediately. It does not wait for completion; use [`pipeline`](/commands/pipeline) or the dashboard's Pipeline tab to watch progress.

## The Jenkinsfile

The Spring Boot template generates a `Jenkinsfile` with these stages:

1. **Initialize** — resolve build metadata
2. **Build** — Compile and Lint, in parallel
3. **Test** — Unit and Integration tests, publishing JUnit results
4. **Containerize** — build the service image
5. **Security Scan** — scan the built image
6. **Push** — push to the local registry
7. **Deploy** — call the API server to restart the service, then poll its health endpoint

Note that the Deploy stage is the **compose-runtime** deploy. On the kubernetes runtime, deploys go through [`deploy`](/commands/deploy) and ArgoCD instead — CI is deliberately off the deploy critical path there, so the pipeline builds and pushes but does not sync the cluster.

## Credentials

| Field | Value |
|---|---|
| URL | `http://localhost:8081` (first tenant; add 1 per extra tenant) |
| Username | `admin` |
| Password | `admin` |

Run `blissful-infra tenant status` to see the port your tenant's Jenkins actually got.

## See also

- [`pipeline`](/commands/pipeline) — run or inspect a pipeline from the CLI
- [`dashboard`](/commands/dashboard) — the Pipeline tab
- [`deploy`](/commands/deploy) — the Kubernetes deploy path
