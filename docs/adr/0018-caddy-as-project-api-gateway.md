# 0018. Caddy as the project-level API gateway

- **Status:** Proposed
- **Date:** 2026-07-21
- **Deciders:** @cavanpage (drafted by Claude to record the de facto choice, routing model pending review)

## Context

[ADR-0017](./0017-tenant-project-service-hierarchy.md) gives every project an API gateway as its single ingress point and left the technology choice to a follow-up ADR. The code has since made the choice de facto: `project-compose.ts` ships a `caddy:2-alpine` gateway service per project (container `${tenant}-${project}-gateway`, published on the project's allocated gateway port, joined to both the project and tenant networks). The generated Caddyfile is still a placeholder that serves a static "configure routes" response, with a comment deferring real routing to this ADR.

## Decision

Standardize on **Caddy 2** as the project-level API gateway, confirming what the code already does.

Proposed routing model (the part that needs review before implementation):

- **Path-prefix routing, generated from the registry.** At `project up` (and after every `service add`/`service remove`), regenerate the Caddyfile from the project's service list:
  - `/api/<service>/*` → the project's backend and worker services by service name (Docker DNS on the project network), with the prefix stripped.
  - `/` → the project's frontend service if one exists, otherwise the static placeholder.
- **No hand-edited gateway config.** The Caddyfile is a build artifact of the registry, same as the compose files. Custom routes come later via a `gateway:` block in `project.yaml` if a real need appears.
- **Reload over restart.** Config changes apply with `caddy reload` inside the running container so route updates don't drop connections.

## Consequences

- **Positive:**
  - One proxy technology across the stack: [ADR-0001](./0001-caddy-edge-proxy.md) already chose Caddy for the edge, so there is a single config dialect to learn.
  - Zero-config routing that tracks the registry, consistent with the "right choice is the easy choice" principle of ADR-0017.
  - Caddy's automatic internal TLS remains available if project-internal TLS is ever wanted.
- **Negative:**
  - Path-prefix routing means backend services must tolerate a stripped prefix (or generate links relative to it). Subdomain routing avoids that but needs local DNS, rejected for now.
  - Regenerating config on every service change adds a step to `service add`/`remove` that must not be forgotten.
- **Risks / follow-ups:**
  - Implement `buildCaddyfile` route generation in `project-compose.ts` and wire regeneration into the service lifecycle commands, with an L2 test asserting the generated routes.
  - Decide whether cross-project calls through the gateway need auth before the access-control story (ADR-0017 §access control) lands.

## Alternatives considered

- **Traefik:** label-based dynamic discovery is elegant but introduces a second proxy dialect next to the ADR-0001 edge Caddy and a heavier mental model for a local-first tool. Rejected.
- **nginx:** ubiquitous but config is verbose, reload ergonomics are worse and it adds nothing Caddy lacks here. Rejected.
- **Reuse the ADR-0001 edge Caddy for project routing:** conflates two jobs, the edge proxy is a host-level browser-URL concern while the project gateway is the bounded-context ingress inside one project network. Rejected.

## References

- [ADR-0017: Tenant / Project / Service hierarchy](./0017-tenant-project-service-hierarchy.md)
- [ADR-0001: Caddy edge proxy](./0001-caddy-edge-proxy.md)
- `packages/cli/src/utils/project-compose.ts` (gateway service + placeholder Caddyfile generation)
