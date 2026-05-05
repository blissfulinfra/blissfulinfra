# 0009. Keycloak is the client-level identity provider

- **Status:** Accepted (Spring Boot + React-Vite template wiring landed 2026-05-04)
- **Date:** 2026-05-02
- **Deciders:** @cavanpage

## Context

Keycloak today is a per-service plugin: any service can opt in via
`--plugins keycloak`, scaffolding a per-service Keycloak instance on the
service's `internal` network. Each service gets its own realm, its own
admin console, its own `localhost:8001`-style port.

This doesn't match how authentication works in the real world. Production
deployments overwhelmingly run **one identity provider per organization**
with realms or OIDC clients per app. SSO across an org's services is the
default. Per-service Keycloak instances would mean every service's users
are in their own silo, not what anyone actually does.

The pattern carries over to local dev: when a client has multiple services
that need auth, you want a single sign-on experience locally too. Login
once to the client's Keycloak, all the services accept your token.

This ADR builds on ADR-0008's pattern of promoting shared platform services
to client level.

## Decision

**Keycloak is promoted from a per-service plugin to a first-class
client-level infrastructure component.** Every client gets a single
Keycloak instance available to all its services on the `<client>_infra`
network.

### What changes

1. **New flag `ClientInfrastructure.keycloak: boolean`**, defaulting to
   `false` (opt-in). Auth is heavy infra (~400 MB RAM, ~30s startup) and
   most quick-experiments don't need it.
2. `PortBlockSchema` gains `keycloak: number` (`8050 + blockIndex`).
3. The infra compose generator emits a `<client>-keycloak` container
   on the `infra` network with admin/admin credentials and a default
   realm imported from a generated `realm.json`.
4. Services discover Keycloak via env vars injected by the compose
   generator: `KEYCLOAK_ISSUER_URI=http://keycloak:8080/realms/<client>`
   (resolves on the infra network).
5. The existing `keycloak` plugin remains available as an opt-in
   **service-scoped** Keycloak for users who want strong test isolation.
   Default is the client-level one.

### Realm strategy

For v1: **one realm per client**, named after the client. All services
register as OIDC clients within that realm. This gives:

- One admin console per client
- One user database per client (sign in once, access all services)
- Per-service OIDC client_id/client_secret for service-to-service auth

Services that want their own realm can opt out and use the per-service
plugin. The plugin contract for declaring realm requirements is deferred
to a future ADR (likely the same one that defines plugin data contracts
see ADR-0008's "Risks" section).

### What's intentionally NOT in scope

- **Realm-as-code** (declarative realm definitions managed via Git). For
  v1, the generated `realm.json` is a starting point; users edit
  imperatively via the admin console.
- **User federation** (LDAP, AD, social login). Keycloak supports it; we
  don't preconfigure it.
- **Multi-realm clients.** Apps that need different identity contexts per
  feature.
- **Keycloak's own database**. We use Keycloak's `dev-file` mode for
  speed; switching to Postgres-backed Keycloak (production-shape) is
  future work.
- **Cloud deploy adapter** (managed Keycloak: Auth0, Clerk, Cognito,
  Stytch). Each is a separate ADR when prioritized.

## Consequences

### Positive

- **SSO across a client's services for free.** Real-world auth pattern.
- **One admin console** per client, manage users, realms, clients in
  one place.
- **Less RAM** when a client has multiple auth-needing services (one
  Keycloak vs N).
- **Cloud migration is one-front.** Replace local Keycloak with managed
  IdP, every service's `KEYCLOAK_ISSUER_URI` env var changes via the
  deploy adapter, done.

### Negative

- **Always-on cost when enabled.** ~400 MB RAM, ~30s startup. Off by
  default mitigates.
- **Single failure domain.** All services lose auth if Keycloak crashes.
  Acceptable for local dev; cloud handles via managed IdP HA.
- **Cross-service config coupling.** Every service that wants auth has
  to be registered as a client in the realm. Adds a step compared to
  per-service Keycloak (where the plugin auto-registers).

### Risks / follow-ups

- **Auto-registration of services as OIDC clients.** When `service add`
  runs, the new service should auto-register itself as a client in the
  client's Keycloak realm (with auto-generated client_id/secret).
  Punted to follow-up, for v1, manual registration via admin console.
- **Migration of existing per-service Keycloak instances.** Any client
  that currently has the plugin keeps it (backward-compatible). New
  clients use the client-level one by default.
- **Production-shape Keycloak DB.** `dev-file` mode loses state on every
  rebuild. Acceptable locally; production deploy adapter must use a
  real Postgres backend.

## Alternatives considered

- **Keep per-service Keycloak as default.** Simpler isolation. **Rejected**
  because it forces every service to manage its own user database, a
  fundamental mismatch with how production auth works.
- **One Keycloak per service, one shared realm.** Hybrid. **Rejected** as
  the worst of both worlds: Keycloak's strength is realm-as-tenant; one
  Keycloak per service that all share a realm imports complexity without
  benefit.
- **Skip Keycloak entirely, recommend external IdPs.** Auth0, Clerk,
  etc. **Rejected** because it breaks blissful-infra's promise of
  zero-cloud local dev.
- **Use a lighter IdP** (Authentik, Ory Hydra). **Deferred**: Keycloak
  is the most familiar to enterprise teams, who are blissful-infra's
  primary audience. Lighter alternatives are interesting but not
  compelling enough to switch from the dominant choice.

## References

- ADR-0002 (per-client isolation), the boundary Keycloak fits inside
- ADR-0008 (ClickHouse + LocalStack at client level), sets the pattern
  this ADR follows
- [Keycloak quick start](https://www.keycloak.org/getting-started/getting-started-docker)
