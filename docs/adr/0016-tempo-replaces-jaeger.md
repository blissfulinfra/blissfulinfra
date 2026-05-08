# 0016. Tempo replaces Jaeger as the default tracing backend

- **Status:** Accepted (implemented 2026-05-05)
- **Date:** 2026-05-05
- **Deciders:** @cavanpage

## Context

The default observability stack ships Prometheus, Grafana, Loki, and Jaeger. Three of those four (Prom, Grafana, Loki) are part of the Grafana ecosystem and are visible inside the same Grafana UI. Jaeger is the odd one out: traces live behind a separate web app at `localhost:16686`, with no native correlation back to logs in Loki or metrics in Prometheus.

The most valuable distributed-tracing pattern a learner can practice is *trace-to-logs correlation*. Click a slow span, jump straight to the matching Loki log lines at that timestamp. This is a click-through inside Grafana when the tracing backend is Tempo. With Jaeger you bounce between two UIs and reconcile timestamps by hand.

blissful-infra's audience is students, working engineers, and small studios learning enterprise patterns. A unified Grafana UI for traces, logs, and metrics is more pedagogically valuable than Jaeger's standalone trace explorer.

## Decision

**Replace Jaeger with [Grafana Tempo](https://grafana.com/oss/tempo/) in the default observability bundle.** Tempo runs as a single container at the client level, shares the `infra` network with Prometheus/Grafana/Loki, and is provisioned as a Grafana datasource on first start. Backends send OTLP traces to `http://tempo:4318` (instead of `http://jaeger:4318`).

A `tempo` flag is added to `ObservabilityConfigSchema`. The legacy `jaeger` flag is kept as a deprecated alias: clients with `observability.jaeger: true` in their YAML continue to work and get a Tempo container instead. New configs are written with `tempo: true`.

### What changes

1. **Schema**: `ObservabilityConfigSchema.tempo: boolean` (default `true`). `jaeger` remains as an alias that maps to the same Tempo behavior.
2. **PortBlock**: new `tempo` port (base `3200 + blockIndex`, exposing Tempo's HTTP query API). `jaeger` port stays in the schema for back-compat but isn't bound to anything new.
3. **infra-compose**: when `obs.tempo || obs.jaeger`, emit a `tempo` service from `grafana/tempo:2.5` with a generated `tempo.yaml` mounted in.
4. **Grafana datasource provisioning**: replace the Jaeger datasource with a Tempo datasource. Configure `tracesToLogs` linking to the Loki datasource so click-through works.
5. **Service compose** (`generateServiceCompose`): backend env var becomes `OTEL_EXPORTER_OTLP_ENDPOINT=http://tempo:4318` (was `jaeger:4318`).
6. **CLI components list**: `tempo` is added to `VALID_INFRA_COMPONENTS` so `client infra add/remove tempo` works. `jaeger` is also accepted as an alias.

### What is intentionally NOT in scope

- **Persistent trace storage.** Tempo's local-filesystem backend is fine for laptop dev. Object-storage (S3/GCS) backends are a cloud-deploy concern.
- **Sampling configuration.** Tempo accepts everything by default. Tail sampling and head sampling are knobs for production.
- **TraceQL training material.** A future course module under the Learn path can cover Grafana TraceQL once the path content lands.
- **Removing Jaeger ports from the schema entirely.** Kept as a no-op alias for one release. A follow-up ADR can drop it.

## Consequences

### Positive

- **Single Grafana UI for all observability.** Traces, logs, and metrics behind one URL with click-through correlation.
- **TraceQL.** A more powerful query language than Jaeger's tag-based search, especially when chained with LogQL and PromQL in the same dashboard.
- **Aligns with the rest of the stack.** Loki, Mimir, Tempo, and Pyroscope all share the Grafana ecosystem. Adding more later (e.g. profiling) is a smaller step.
- **OTLP unchanged.** The Spring Boot OTel Java agent already speaks OTLP. The endpoint URL is the only change.
- **Cloud migration unchanged.** Most managed APMs (Grafana Cloud, Datadog, Honeycomb) accept OTLP, same as before.

### Negative

- **More config surface.** Tempo wants a `tempo.yaml` (small, generated). Jaeger all-in-one was zero config.
- **No standalone trace UI at a memorable port.** Some users learn the Jaeger UI in courses or other tools. Mitigated by Grafana's trace explorer being more capable.
- **One more piece of stack-specific knowledge.** Anyone who already knew Jaeger has to learn Tempo. The transition is small (TraceQL is a subset of expressivity Jaeger users already learn).

### Risks / follow-ups

- **Existing client configs with `observability.jaeger: true` need to keep working.** Handled by treating it as an alias for Tempo. The client doesn't need to be recreated.
- **Documentation drift.** Several blog posts and guide docs reference Jaeger by name. They will be updated in a follow-up doc pass.
- **Persistent storage.** Tempo's local backend keeps traces in `/var/tempo` inside the container. We mount a Docker volume so traces survive container restarts. `client remove` deletes the volume, which is consistent with the rest of the stack.

## Alternatives considered

- **Keep Jaeger.** Simpler, no migration. Rejected because trace-to-logs correlation is the most valuable observability pattern to teach and Jaeger blocks it.
- **Run both Jaeger and Tempo.** Lets users compare. Rejected because two tracing backends doubles RAM and confuses the default story. Users who want Jaeger specifically can opt in via a future plugin.
- **Use OpenTelemetry Collector to fan out to both.** More flexible, more complex. Deferred to whenever a real use case emerges (e.g. exporting to a managed APM in parallel with local).
- **Wait for Tempo v3.** Punted because v2.5 is stable, OTLP-native, and meets every need we have.

## References

- [Grafana Tempo docs](https://grafana.com/docs/tempo/latest/)
- [Tempo configuration reference](https://grafana.com/docs/tempo/latest/configuration/)
- [Trace to logs correlation](https://grafana.com/docs/grafana/latest/datasources/tempo/configure-tempo-data-source/#trace-to-logs)
- [ADR-0008](./0008-clickhouse-as-client-level-warehouse.md), the pattern this ADR follows for shared client infrastructure
