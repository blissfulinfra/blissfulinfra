---
title: blissful-infra jenkins
description: Manage the shared Jenkins CI/CD server and register projects with pipelines.
---

`blissful-infra jenkins` manages the shared Jenkins CI/CD server and your project pipelines. Jenkins is a shared service — one instance runs on your machine and all your blissful-infra projects register jobs with it.

## Subcommands

| Subcommand | Description |
|------------|-------------|
| `jenkins start` | Start the Jenkins server |
| `jenkins stop` | Stop the Jenkins server |
| `jenkins status` | Show Jenkins server status and running jobs |
| `jenkins add-project <name>` | Register a project with Jenkins |
| `jenkins build <name>` | Trigger a pipeline build for a project |
| `jenkins list` | List all registered projects and their build status |

---

## `jenkins start`

```bash
blissful-infra jenkins start [--build] [--reset]
```

Starts the Jenkins server if it is not already running.

Jenkins is a custom Docker image (`blissful-jenkins:latest`) built with all required plugins pre-installed. On first run the image is built automatically — this takes about 2 minutes and only happens once. Subsequent starts take a few seconds.

Jenkins data (jobs, build history, configuration) is persisted in `~/.blissful-infra/jenkins/` so it survives restarts.

### Options

| Flag | Description |
|------|-------------|
| `--build` | Force a rebuild of the Jenkins Docker image. Use this after plugin updates. |
| `--reset` | Wipe the Jenkins Docker volumes and rebuild from scratch. Deletes all job history. |

### What starts

- **Jenkins** at `http://localhost:8081` (admin/admin)
- **Docker registry** at `localhost:5050` — a local image registry for CI-built images

Jenkins is configured via JCasC (Jenkins Configuration as Code) so there is no manual setup wizard. All plugins, security settings, and the `blissful-projects` folder are provisioned automatically.

### Waiting for readiness

The CLI waits up to 120 seconds for Jenkins to respond at `/login` before returning. If Jenkins does not become ready in time, the command fails with an error suggesting you check `docker logs blissful-jenkins`.

---

## `jenkins stop`

```bash
blissful-infra jenkins stop
```

Stops the Jenkins containers with `docker compose down`. Data is preserved in the Docker volumes — the next `jenkins start` will restore the previous state.

---

## `jenkins status`

```bash
blissful-infra jenkins status
```

Prints whether Jenkins is running and, if so, the URL and credentials. Also checks whether the Docker registry container is up.

---

## `jenkins add-project`

```bash
blissful-infra jenkins add-project <name>
```

Registers an existing blissful-infra project with Jenkins by creating a pipeline job.

### Prerequisites

- Jenkins must be running (`blissful-infra jenkins start` or `blissful-infra dashboard`)
- The project directory must exist in the current working directory with a `blissful-infra.yaml`
- The project must have a `Jenkinsfile` at either `Jenkinsfile` (root) or `backend/Jenkinsfile`

The Spring Boot template generates `backend/Jenkinsfile` automatically when you run `blissful-infra start`. If you used a different backend template, check whether it includes a Jenkinsfile.

### What it does

1. Reads the Jenkinsfile location (`Jenkinsfile` or `backend/Jenkinsfile`)
2. Generates a Jenkins pipeline job XML that points to your project directory as the SCM source (using the local filesystem path as a Git remote — Jenkins polls the local repo)
3. POSTs the job XML to `http://localhost:8081/job/blissful-projects/createItem?name=<name>` with CSRF crumb injection
4. Falls back to the Jenkins root if the `blissful-projects` folder does not exist

After registration, the job is visible at:
`http://localhost:8081/job/blissful-projects/job/<name>`

### Notes

- `blissful-infra start` calls `add-project` automatically after booting the stack. You only need to call it manually if start skipped it (e.g. Jenkins was down at the time) or if you created the project with `blissful-infra create`.
- The job is idempotent — running `add-project` for an already-registered project is a no-op.

---

## `jenkins build`

```bash
blissful-infra jenkins build <name>
```

Triggers a new pipeline build for the named project. Equivalent to clicking "Build Now" in the Jenkins UI.

The CLI posts to `http://localhost:8081/job/blissful-projects/job/<name>/build` with a CSRF crumb. It does not wait for the build to complete — use `blissful-infra pipeline <name>` or open the Jenkins UI to monitor progress.

---

## `jenkins list`

```bash
blissful-infra jenkins list
```

Lists all jobs registered with Jenkins, their current status (success, failed, building, not built), and the timestamp of the last build.

Example output:

```
Name                     Status         Last Build
───────────────────────────────────────────────────────
my-app                   success        #3 (3/25/2026, 10:14:22 AM)
fraud-detector           failed         #1 (3/24/2026, 4:02:11 PM)
content-recommender      not built      -
```

---

## The Jenkinsfile

Every Spring Boot project generated by blissful-infra includes a `backend/Jenkinsfile`. The pipeline stages are:

1. **Checkout** — fetches the source from the local path configured in the job
2. **Build** — runs `./gradlew build` inside the backend directory
3. **Test** — runs `./gradlew test` and publishes JUnit results
4. **Docker build** — builds the backend Docker image and tags it with the build number
5. **Push** — pushes the image to the local registry at `localhost:5050`

The pipeline uses Docker-in-Docker so the Gradle build runs in an isolated container and the resulting image is pushed to your local registry.

---

## Jenkins credentials reference

| Field | Value |
|-------|-------|
| URL | http://localhost:8081 |
| Username | `admin` |
| Password | `admin` |
| Registry | `localhost:5050` |
| Data directory | `~/.blissful-infra/jenkins/` |
