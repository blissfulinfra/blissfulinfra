---
title: "A Developer's Guide to IAM: Authentication, Authorization, and RBAC in Modern Web Apps"
description: Learn the difference between authentication and authorization, how JWT and OAuth2/OIDC work, how to implement RBAC, and how to run a full IAM stack locally with Keycloak and Spring Boot.
---

Identity and Access Management (IAM) is one of those topics that every developer knows they need to understand, but the surface area is wide enough that most people piece it together from Stack Overflow answers and half-understood OAuth flows. This guide covers the core concepts clearly, shows you how a real IAM stack fits together, and walks through running it locally with one command.

## Authentication vs Authorization

These two get conflated constantly. They're different things:

**Authentication** (authn) — *Who are you?*
Verifying the identity of the user or system making a request. Logging in with a username/password, presenting a token, using a certificate.

**Authorization** (authz) — *What are you allowed to do?*
Given that we know who you are, what resources and actions are you permitted to access?

You authenticate once per session. You authorize on every request.

```
Request → "Who are you?" → Authentication → "What can you do?" → Authorization → Resource
```

The classic mistake is checking authorization without authentication, or assuming that because a user is authenticated they can access any resource.

---

## How JWT works

JSON Web Tokens (JWT, pronounced "jot") are the standard way to pass identity information between services. A JWT is a base64url-encoded string with three parts separated by dots:

```
header.payload.signature
```

**Header** — token type and signing algorithm:
```json
{ "alg": "RS256", "typ": "JWT" }
```

**Payload** — the claims (who the user is, what they're allowed to do):
```json
{
  "sub": "user-123",
  "email": "alice@example.com",
  "roles": ["admin", "editor"],
  "iat": 1711584000,
  "exp": 1711670400
}
```

**Signature** — cryptographic proof the token wasn't tampered with. With RS256, the auth server signs with its private key; your backend verifies with the public key.

The important property: **JWTs are stateless**. Your backend doesn't need to hit a database or call an auth server to verify a token — it just checks the signature and expiry. This makes them very fast at scale.

The trade-off: **JWTs can't be revoked before expiry**. If you need instant revocation (e.g., user account suspended), you need either short expiry + refresh tokens, or a token blacklist.

---

## OAuth2 and OIDC

OAuth2 is an authorization framework. OpenID Connect (OIDC) is an identity layer built on top of OAuth2. In practice, when developers say "OAuth login" they usually mean OIDC.

The flow for a web app:

```
1. User clicks "Log in"
2. App redirects to auth server (Keycloak, Auth0, Google)
3. User authenticates at the auth server
4. Auth server redirects back with an authorization code
5. App exchanges code for tokens (access token + ID token + refresh token)
6. App uses access token to call APIs
7. APIs verify the token signature against the auth server's public key
```

Three tokens you'll encounter:

| Token | Purpose | Lifetime |
|---|---|---|
| **Access token** | Proves identity to APIs | Short (5–15 min) |
| **ID token** | User profile data for the app | Same as access |
| **Refresh token** | Gets new access tokens without re-login | Long (hours/days) |

Your backend only needs to validate access tokens. Your frontend uses the ID token to display user info.

---

## RBAC: Role-Based Access Control

RBAC is the most widely used authorization model. Users are assigned roles; roles are granted permissions; permissions allow actions on resources.

```
User → has Role → grants Permission → allows Action on Resource
```

A concrete example for a content management app:

| Role | Permissions |
|---|---|
| `viewer` | `article:read` |
| `editor` | `article:read`, `article:write`, `article:publish` |
| `admin` | all editor permissions + `user:manage`, `settings:write` |

In a JWT, roles are typically a claim:
```json
{ "sub": "user-123", "roles": ["editor"] }
```

In Spring Boot with Spring Security, you enforce this at the method or endpoint level:

```kotlin
@GetMapping("/articles")
fun listArticles(): List<Article> = articleService.findAll()

@PostMapping("/articles")
@PreAuthorize("hasRole('editor')")
fun createArticle(@RequestBody article: Article): Article = articleService.save(article)

@DeleteMapping("/articles/{id}")
@PreAuthorize("hasRole('admin')")
fun deleteArticle(@PathVariable id: Long) = articleService.delete(id)
```

---

## Keycloak: the open source IAM server

Keycloak is the de facto open source IAM solution. It handles everything:

- User registration and login UI
- OAuth2/OIDC token issuance
- Role management and RBAC
- Social login (Google, GitHub, etc.)
- Multi-factor authentication
- Admin console at `/admin`

In production, Keycloak runs in front of all your services. For local development, you run it in Docker.

A Keycloak **realm** is an isolated namespace — one realm per application (or per environment). A realm has users, clients, and roles.

A **client** represents an application that uses Keycloak for auth. Your Spring Boot API is a confidential client. Your React frontend is a public client (can't keep secrets).

---

## Running a full IAM stack locally

With blissful-infra, Keycloak is an available plugin. Add it when creating a project:

```bash
blissful-infra start my-app --plugins keycloak
```

This adds Keycloak to your Docker Compose stack, pre-configured with:
- A `my-app` realm
- An `api` client for your Spring Boot backend
- A `frontend` public client for your React app
- `admin`, `editor`, and `viewer` roles
- A test user for each role

Services after adding the plugin:

| Service | URL | Purpose |
|---|---|---|
| Keycloak | `http://localhost:8001` | IAM / admin console |
| Backend API | `http://localhost:8080` | Spring Boot (validates JWTs) |
| Frontend | `http://localhost:3000` | React (acquires tokens) |

The admin console is at `http://localhost:8001/admin` — username `admin`, password `admin`. This is where you manage users, roles, and clients in a visual UI.

---

## Spring Boot: validating tokens

With Spring Security's OAuth2 Resource Server, validating JWTs is a few lines of config:

```kotlin
// build.gradle.kts
implementation("org.springframework.boot:spring-boot-starter-security")
implementation("org.springframework.boot:spring-boot-starter-oauth2-resource-server")
```

```kotlin
// SecurityConfig.kt
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
class SecurityConfig {

    @Bean
    fun securityFilterChain(http: HttpSecurity): SecurityFilterChain {
        http
            .authorizeHttpRequests { auth ->
                auth
                    .requestMatchers("/actuator/health").permitAll()
                    .requestMatchers("/actuator/**").hasRole("admin")
                    .anyRequest().authenticated()
            }
            .oauth2ResourceServer { oauth2 ->
                oauth2.jwt { jwt ->
                    jwt.jwtAuthenticationConverter(keycloakJwtConverter())
                }
            }
            .csrf { it.disable() }  // stateless API — no CSRF needed
        return http.build()
    }

    // Keycloak puts roles inside realm_access.roles, not the standard Spring location
    private fun keycloakJwtConverter(): JwtAuthenticationConverter {
        val converter = JwtAuthenticationConverter()
        converter.setJwtGrantedAuthoritiesConverter { jwt ->
            val realmAccess = jwt.getClaim<Map<String, Any>>("realm_access")
            val roles = (realmAccess?.get("roles") as? List<*>) ?: emptyList<String>()
            roles.filterIsInstance<String>()
                 .map { SimpleGrantedAuthority("ROLE_$it") }
        }
        return converter
    }
}
```

```yaml
# application.yml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: http://localhost:8001/realms/my-app
```

Spring Security fetches Keycloak's public keys from the JWKS endpoint automatically and caches them. Every incoming request gets validated against those keys — no database call, no round trip to Keycloak.

---

## React: acquiring and using tokens

The frontend uses Keycloak's JS adapter to handle the OAuth2 flow:

```bash
npm install keycloak-js
```

```typescript
// src/auth/keycloak.ts
import Keycloak from 'keycloak-js';

const keycloak = new Keycloak({
  url: 'http://localhost:8001',
  realm: 'my-app',
  clientId: 'frontend',
});

export default keycloak;
```

```typescript
// src/auth/AuthProvider.tsx
import { createContext, useContext, useEffect, useState } from 'react';
import keycloak from './keycloak';

interface AuthContextType {
  token: string | null;
  user: { name: string; email: string; roles: string[] } | null;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthContextType['user']>(null);

  useEffect(() => {
    keycloak.init({ onLoad: 'check-sso', silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html' })
      .then(authenticated => {
        if (authenticated && keycloak.token) {
          setToken(keycloak.token);
          setUser({
            name: keycloak.tokenParsed?.name ?? '',
            email: keycloak.tokenParsed?.email ?? '',
            roles: keycloak.tokenParsed?.realm_access?.roles ?? [],
          });
        }
      });

    // Refresh token before it expires
    keycloak.onTokenExpired = () => {
      keycloak.updateToken(30).then(refreshed => {
        if (refreshed && keycloak.token) setToken(keycloak.token);
      });
    };
  }, []);

  return (
    <AuthContext.Provider value={{
      token,
      user,
      login: () => keycloak.login(),
      logout: () => keycloak.logout(),
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext)!;
```

Attaching the token to API calls:

```typescript
// src/api/client.ts
import { useAuth } from '../auth/AuthProvider';

export function useApiClient() {
  const { token } = useAuth();

  return {
    get: (url: string) => fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    post: (url: string, body: unknown) => fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  };
}
```

Role-based UI:

```typescript
function AdminPanel() {
  const { user } = useAuth();

  if (!user?.roles.includes('admin')) {
    return <p>Access denied.</p>;
  }

  return <div>Admin controls...</div>;
}
```

---

## Common IAM mistakes

**Trusting the frontend for authorization decisions** — The frontend can hide a button, but the backend must enforce the permission. Always validate roles on the server.

**Storing tokens in localStorage** — Vulnerable to XSS. Use `httpOnly` cookies for refresh tokens, or the Keycloak JS adapter's silent SSO flow which keeps tokens in memory.

**Long-lived access tokens** — 15 minutes is a good default. Use refresh tokens to maintain sessions. Short expiry limits blast radius if a token is leaked.

**Skipping HTTPS in staging** — Tokens in plaintext are trivially stolen. Enable TLS even for internal staging environments.

**Conflating authentication and session management** — JWT auth is stateless. If you need server-side sessions (e.g., for instant revocation), add Redis and track session IDs separately from the JWT.

---

## What comes next

Once you have authentication and basic RBAC working, the next problems to solve are:

- **Attribute-Based Access Control (ABAC)** — policies based on resource attributes, not just roles (e.g., "editors can only publish their own articles")
- **Audit logging** — who accessed what, and when
- **Token introspection** — for cases where you need to check revocation status in real time
- **Service-to-service auth** — the OAuth2 Client Credentials flow for backend-to-backend calls without a user in the loop

Most teams don't need all of this on day one. Get authentication and RBAC right first. The patterns are the same whether you're running locally in Docker or deploying to production.

---

To run a full auth stack locally — Keycloak, Spring Boot resource server, and React frontend — with everything pre-wired:

```bash
npm install -g @blissful-infra/cli
blissful-infra start my-app --plugins keycloak
```

Admin console is at `http://localhost:8001/admin`. The Spring Boot backend validates tokens automatically. Test users for each role are pre-created.

[Get started →](/getting-started) or [view all plugins →](/getting-started#choosing-your-stack)
