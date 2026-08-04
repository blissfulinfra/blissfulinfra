# 0023. Gitea Actions replaces Jenkins as the CI engine

- **Status:** Accepted
- **Date:** 2026-08-04
- **Deciders:** @cavanpage

## Context

Jenkins has been in the stack since Phase 2, but after the 2.0 purge it does nothing: job registration only ever fired from the removed flat-model `start` command, so per-tenant Jenkins boots with an empty job list forever. ADR-0020 then made deploys CLI-driven and stripped the Jenkinsfile's kubectl/argocd stages, removing Jenkins from the deploy path conceptually as well. What remains is a ~500MB container that shows a dashboard link and runs nothing — on laptops where memory pressure is already the top cause of demo failures.

Meanwhile the product's stated audience is students and working engineers learning enterprise patterns. Jenkinsfile Groovy DSL is a declining skill; GitHub-Actions-shaped YAML is what they will actually meet at work.

Critically, **every tenant already runs Gitea in-cluster** (ADR-0020, as the GitOps origin), and Gitea ships an Actions engine that is GitHub Actions-compatible: the same `.gitea/workflows/*.yml` syntax, `runs-on`/`uses`/`steps` shape, and most marketplace actions.

## Decision

**Gitea Actions is the CI engine. Jenkins defaults off.**

- **Enabled in the existing Gitea**: `actions.ENABLED = true` in the chart values — no new platform, no new credentials, no new port.
- **One runner per tenant**: an `act_runner` Deployment in the `gitea` namespace with a `docker:dind` sidecar (kind nodes run containerd, so the runner brings its own Docker daemon). Registration needs a token from a running Gitea, which pure Terraform can't order — the CLI fetches it via the Gitea admin API and applies the manifest, the same pattern already used for org/repo creation and the ArgoCD Application.
- **Service source gets a Gitea repo**: `blissful/<tenant>-<project>-<service>`. CI runs on the code, so the code has to be somewhere Gitea can see it. `blissful-infra ci push <service>` mirrors the service directory (including its scaffolded workflow) and the push triggers the run. This also makes the local git experience real rather than simulated.
- **Workflows ship in the templates**: each service template carries `.gitea/workflows/ci.yml` doing what that stack actually needs (hono: `npm ci` → test → build; spring-boot: `gradlew test build`; react-vite: `npm ci` → build).
- **Jenkins is retained but off by default** (`infrastructure.jenkins: false`): the image, template and `jenkins` command stay for anyone who wants the incumbent-enterprise lesson, and existing tenants keep whatever they configured.

CI stays **decoupled from deploy**: Actions builds and tests, `blissful-infra deploy` still owns the GitOps loop. Wiring a green pipeline to trigger a deploy is a later decision, deliberately not taken here.

## Consequences

- **Positive:**
  - The workflow file a user writes locally is the file they would write on GitHub — the skill transfers, which is the whole educational premise.
  - No new platform: Gitea, its credentials and its NodePort already exist.
  - The GitOps repo stops being a write-only side-effect; Gitea becomes the center of gravity for both source and manifests.
  - Dropping default Jenkins frees ~500MB on a memory-constrained demo.
- **Negative:**
  - Service source now lives in two places (working dir + Gitea mirror) until/unless the working dir becomes a real clone.
  - The runner needs a privileged `dind` sidecar — acceptable for a local dev cluster, would need rethinking anywhere else.
  - Gitea Actions is less mature than GitHub Actions; exotic marketplace actions may not work.
- **Risks / follow-ups:**
  - `perf` / `chaos` / `compare` remain orphaned by the 2.0 purge — same class of problem Jenkins had. Track them together.
  - Runner registration tokens are per-Gitea-instance; recreating the cluster requires re-running the setup (handled by `ci setup` being idempotent).
  - If CI should ever gate deploys, that is a new decision (and probably means the deploy commit comes *from* the pipeline).

## Alternatives considered

- **Fix Jenkins instead** (register a job per service, repoint the Jenkinsfile): a half-day of work that yields a working but legacy-shaped CI, teaching a fading skill and keeping the memory cost.
- **GitHub Actions + `act`**: identical syntax, but `act` is an emulator with real fidelity gaps and true GH Actions needs the cloud, contradicting "no cloud required".
- **Woodpecker CI** (Drone fork): genuinely light and pleasant, but a whole separate platform to provision and a syntax nobody encounters at work.
- **Argo Workflows/Events**: fits the Argo ecosystem already installed, but it is k8s-native pipeline plumbing rather than developer-facing CI, and would only work on the kubernetes runtime.
- **Tekton**: heavy, verbose, declining adoption.
- **Dagger**: the most interesting modern take (pipelines as code, portable), but a paradigm shift with less overlap with what users meet at work. Worth revisiting if the audience skews senior.

## References

- [ADR-0020: Local Kubernetes runtime](./0020-local-kubernetes-runtime.md) — where Gitea came from
- [ADR-0017: Tenant / Project / Service hierarchy](./0017-tenant-project-service-hierarchy.md)
- `packages/cli/src/commands/ci.ts`, `src/utils/actions.ts`, `templates/*/.gitea/workflows/ci.yml`
