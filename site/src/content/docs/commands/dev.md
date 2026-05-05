---
title: blissful-infra dev
description: Development mode with hot reload for inner-loop iteration on a scaffolded app.
---

`blissful-infra dev` starts a development mode that watches for file changes
and provides fast feedback loops while iterating on a scaffolded application.

:::caution[Mode availability]
The `dev` command currently targets **flat-model projects** (created with
`blissful-infra start`). It does not yet support the
[client model](/guides/client-model), porting it is on the roadmap. For
client-model projects, use `client up` and rebuild containers manually until
hot-reload is wired in.
:::

## Usage

```bash
# Run from inside a project directory
cd my-app
blissful-infra dev

# Local mode: run the app process outside Docker (requires matching JDK)
blissful-infra dev --local
```

## Options

| Flag | Description |
|------|-------------|
| `--local` | Run the application process locally instead of in Docker. Requires a matching JDK for Spring Boot projects. |

## Spring Boot (Docker, with DevTools)

For Spring Boot projects, if a `docker-compose.dev.yaml` is present (generated
by `blissful-infra start`), the CLI uses Spring Boot DevTools for the fastest
possible restart cycle:

1. The backend source is volume-mounted into the container
2. The Gradle incremental compiler (`classes -t`) runs continuously inside Docker
3. Spring Boot DevTools detects the recompiled classes and restarts the JVM in ~2–3 seconds

```bash
cd my-app
blissful-infra dev
# Spring Boot DevTools mode activates automatically
```

## Spring Boot (local)

With `--local`, the CLI starts the incremental compiler and `bootRun` directly
on your machine, no Docker involved for the app process:

```bash
cd my-app/backend
blissful-infra dev --local
```

The infrastructure services (Kafka, Postgres, Redis) are kept running in
Docker. The app connects to them via `localhost:9092`, `localhost:5432`, etc.

## Other runtimes

For Node.js, Python, and Go projects, `dev` watches source files, rebuilds on
change, and restarts the process. Detection is automatic based on the presence
of `package.json`, `go.mod`, `requirements.txt`, etc.

| Runtime | Watch paths | Rebuild command |
|---------|-------------|-----------------|
| Gradle / Kotlin | `src/**/*.kt`, `src/**/*.java`, `build.gradle.kts` | `./gradlew build -x test` |
| Maven | `src/**/*.java`, `pom.xml` | `./mvnw package -DskipTests` |
| Node.js | `src/**/*.ts`, `src/**/*.tsx`, `package.json` | `npm run build` |
| Go | `**/*.go`, `go.mod` | `go build -o app .` |
| Python | `**/*.py`, `requirements.txt` | (no compilation needed) |

Changes are debounced by 500ms to avoid triggering multiple rebuilds on rapid saves.
