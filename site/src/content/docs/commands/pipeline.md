---
title: blissful-infra pipeline
description: Run a service's CI/CD pipeline locally, or view its status in Jenkins.
---

`pipeline` either runs the build stages locally on your machine, or shows you what Jenkins last did.

```bash
blissful-infra pipeline orders --local
```

## Usage

```bash
blissful-infra pipeline [service] [options]
```

`[service]` resolves through your [`use`](/commands/use) context when omitted.

## Options

| Flag | What it does |
|---|---|
| `--tenant <tenant>` | Tenant (defaults to context) |
| `--project <project>` | Project (defaults to context, falls back to a registry scan) |
| `--local` | Run the pipeline locally: build, test, containerize |
| `--push` | Push the image to the registry after building (requires `--local`) |
| `--skip-tests` | Skip the test stage |
| `--skip-scan` | Skip the security scan stage |

Without `--local`, the command reports the service's pipeline status from Jenkins instead of running anything.

## Running locally

```bash
blissful-infra pipeline orders --local
```

Runs the same stages Jenkins would, on your machine, without going through the CI server. This is the fast way to find out whether a change builds and passes tests before you commit.

```bash
# Skip the slow parts while iterating
blissful-infra pipeline orders --local --skip-tests --skip-scan

# Build and push a real image
blissful-infra pipeline orders --local --push
```

## Checking status

```bash
blissful-infra pipeline orders
```

Reports the last Jenkins run for the service: overall result, per-stage status and duration. The dashboard's Pipeline tab shows the same thing with a stage diagram, and can trigger runs.

## Relationship to deploy

On the **compose** runtime, the pipeline's Deploy stage restarts the service through the API server.

On the **kubernetes** runtime, the pipeline stops at build and push. Deploys are driven by [`deploy`](/commands/deploy), which pushes manifests to Gitea for ArgoCD to sync. That keeps CI off the deploy critical path, so a broken pipeline cannot take down a running rollout.

## See also

- [`jenkins`](/commands/jenkins): the CI server itself
- [`deploy`](/commands/deploy): the Kubernetes deploy path
- [`dashboard`](/commands/dashboard): the Pipeline tab
