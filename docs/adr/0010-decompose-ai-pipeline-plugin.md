# 0010. Decompose the `ai-pipeline` plugin into client-level platform services

- **Status:** Accepted — implemented in client-model `service add` 2026-05-04
- **Date:** 2026-05-02
- **Deciders:** @cavanpage

> **Implementation note (2026-05-04):** the client-model
> `generateServiceCompose` now emits a single ai-pipeline FastAPI container
> that connects to the client-level `clickhouse` and `mlflow` services on the
> shared infra network. Co-deployed ClickHouse / MLflow inside the plugin
> compose are gone for the client model. The legacy flat-model
> `blissful-infra start --plugins ai-pipeline` still bundles them for
> backwards compat — flat model is deprecated and will be removed in a
> future ADR.

## Context

The current `ai-pipeline` plugin is a kitchen-sink bundle. When a service
opts into `--plugins ai-pipeline`, blissful-infra scaffolds:

1. **A Python FastAPI service** (the actual pipeline — Kafka consumer,
   scikit-learn classifier, REST API)
2. **ClickHouse** (per-plugin instance for prediction storage)
3. **MLflow** (per-plugin model registry + experiment tracking)
4. **Mage** (per-plugin visual workflow orchestrator)

Four things, one plugin. As we built out forecasting, analytics, anomaly
detection, etc., the same problems kept appearing:

- Every analytical plugin wants ClickHouse — should be shared (ADR-0008)
- Every plugin that produces models wants a model registry — should be
  shared (this ADR)
- Workflow orchestration is a "jobs" concern, not an "ai-pipeline"
  concern (the discussion that led to first-class jobs)
- The FastAPI service itself is *one specific application* — not platform infra

After ADR-0008 promoted ClickHouse to client-level, the `ai-pipeline`
plugin's bundling becomes actively misleading. A future analytics plugin
shouldn't need to opt into `ai-pipeline` to get MLflow.

## Decision

**Decompose `ai-pipeline` into one client-level infrastructure component
(MLflow + Mage) and one service-level plugin (the Python FastAPI
classifier).**

### What changes

1. **MLflow → client-level infra.** New flag
   `ClientInfrastructure.mlflow: boolean`, defaulting to `false` (opt-in,
   ~150 MB idle). Container `<client>-mlflow` on the infra network.
   Services and plugins access it via `MLFLOW_TRACKING_URI=http://mlflow:5000`.
2. **Mage → client-level infra.** New flag
   `ClientInfrastructure.mage: boolean`, defaulting to `false` (opt-in,
   ~300 MB idle). Container `<client>-mage` on the infra network.
   Workflow definitions live at `<client>/mage/pipelines/`. Mage replaces
   per-plugin orchestration with a shared "data jobs" runner.
3. **`ai-pipeline` plugin shrinks** to just the FastAPI classifier
   service. It connects to the client-level ClickHouse, MLflow, and
   Mage instead of standing up its own.
4. `PortBlockSchema` gains `mlflow: number` (`5050 + blockIndex`) and
   `mage: number` (`6750 + blockIndex`).
5. Existing `ai-pipeline` plugin instances are **not auto-migrated**.
   Users who want the new shape rescaffold; users who don't keep the
   old behavior. Old plugin is deprecated, removed in a later release.

### What's intentionally NOT in scope

- **Mage as the "jobs" runner** in a formal sense. ADR-0008's "Risks"
  section flags jobs as future work. Mage moving to client level is a
  concrete step in that direction; the formal jobs ADR is separate.
- **MLflow Postgres backend.** v1 uses `sqlite` (Mage and MLflow's
  defaults). Production-shape backed by Postgres is future work.
- **Model deployment.** MLflow's model serving is a separate concern;
  for now we just provide the registry.
- **Kafka topic provisioning.** The ai-pipeline plugin currently
  auto-creates events/predictions topics; that stays for now. Will move
  to a plugin contract later.

## Consequences

### Positive

- **One source of truth** for analytical infrastructure: ClickHouse,
  MLflow, Mage all at client level. Multiple plugins (ai-pipeline,
  forecasting, analytics) share them.
- **`ai-pipeline` becomes coherent.** It's just a Python FastAPI
  classifier service that uses the platform's analytical resources.
  Easy to understand, easy to replace, easy to fork.
- **Lower per-plugin RAM.** MLflow + Mage + ClickHouse used to ship per
  ai-pipeline instance. Now once per client.
- **Forecasting / anomaly detection plugins are simpler.** They write
  predictions to ClickHouse and register models in MLflow without
  having to bundle either.
- **Cloud migration story** is now uniform across all analytical
  resources: ClickHouse → ClickHouse Cloud, MLflow → Databricks/managed
  MLflow, Mage → Mage Pro / Airflow / cloud orchestrator.

### Negative

- **Breaking change for existing `ai-pipeline` plugin users.** Anyone
  running it today has an embedded ClickHouse/MLflow/Mage stack that
  doesn't match the new shape. Migration is manual.
- **More client-level always-on services** when enabled. MLflow + Mage
  add ~450 MB RAM. Mitigated by both being opt-in (default off).
- **Plugin contract is still missing.** Without it, MLflow experiment
  naming, Mage pipeline naming, ClickHouse table naming are still
  free-for-all. The forthcoming plugin contract ADR will address.

### Risks / follow-ups

- **`ai-pipeline` plugin needs a clear migration story.** Document for
  existing users: tear down old, rescaffold against new shape.
- **Mage and the forthcoming "jobs" concept overlap.** Mage handles
  data pipelines; the jobs concept handles arbitrary scheduled compute.
  Need to clarify the boundary in the jobs ADR.
- **Three new client-level services land at once.** RAM cost compounds.
  Document for users running multiple clients on a laptop.

## Alternatives considered

- **Promote MLflow + Mage but keep them inside the ai-pipeline plugin
  template.** Hybrid. **Rejected** because the whole point of this ADR
  is that MLflow and Mage are not specific to ai-pipeline — other
  plugins want them too.
- **Promote only MLflow, keep Mage inside ai-pipeline.** Lighter scope.
  **Considered, rejected** because Mage is precisely the workflow
  orchestrator that any "jobs" or "scheduled compute" concept will lean
  on. Lift now, consolidate with jobs later.
- **Replace MLflow with a simpler registry** (DVC, custom). **Rejected**
  for now — MLflow is industry-standard and most users coming to
  blissful-infra for ML expect it.
- **Replace Mage with Airflow / Dagster / Prefect.** **Deferred** — Mage
  is in our existing stack; switching to a different orchestrator is a
  separate decision.
- **Keep the kitchen-sink plugin.** **Rejected** because the lessons of
  ADR-0008 apply: shared platform services belong at client level.

## Migration path for existing users

Users with `--plugins ai-pipeline` services today:

1. Note any custom code in the plugin's FastAPI service
2. Tear down the old service (`service down`, then `rm -rf` the dir)
3. Recreate the client (or just enable the new client-level flags):
   `blissful-infra client create <name> --warehouse --mlflow --mage`
4. Re-add the service: `service add <client> <svc> --plugins ai-pipeline`
5. The new ai-pipeline plugin scaffolds just the FastAPI service,
   wired to the client-level ClickHouse/MLflow/Mage via env vars

## References

- ADR-0008 (ClickHouse + LocalStack at client level) — sets the pattern
- ADR-0009 (Keycloak at client level) — same pattern
- [packages/cli/templates/plugins/ai-pipeline/](../../packages/cli/templates/plugins/ai-pipeline/) — current shape
- Conversation log 2026-05-02 (plugin promotion discussion)
