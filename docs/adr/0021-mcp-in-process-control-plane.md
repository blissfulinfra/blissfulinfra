# 0021. The MCP server is an in-process control plane, not an HTTP shim

- **Status:** Accepted
- **Date:** 2026-07-28
- **Deciders:** @cavanpage

## Context

The MCP server was written against the pre-2.0 flat model and never migrated when ADR-0017 replaced it with tenant → project → service, or when ADR-0020 added the Kubernetes golden path. It had drifted into being actively misleading rather than merely incomplete. Measured against a live registry:

- **`start_project` was dead.** It proxied `POST /api/v1/projects/:name/up`, which shells `blissful-infra up <name>` — a command deleted with the client model. Every call returned `{"success":false,"error":"error: unknown command 'up'"}`.
- **Discovery output did not feed action input.** `list_projects` returned *projects*, but every project-scoped API route resolves its `:name` segment through `resolveProjectDir`, which searches for a **service**. Passing a real project name returned `status:"unknown", services:[]` — byte-identical to passing a name that never existed.
- **No route returned 404.** Unknown names produced empty success payloads, so an agent could not distinguish a typo from an idle service. Agents cannot see the terminal; the error string is their only chance to self-correct.
- **Advertised parameters did nothing.** `deploy` exposed `env: staging|production|ephemeral` and `image`; the handler read only `{tag}`. Choosing "production" silently did the same thing as choosing "staging".
- **The tenant was resolved once and cached** for the process lifetime, so `blissful-infra use <other-tenant>` did not take effect until the server restarted.
- **The whole ADR-0020 golden path was invisible** — no cluster, canary, or service-lifecycle tools existed.

Underneath the drift was a structural problem. The server was a thin proxy to the API server on :3002, which normally runs **inside the dashboard container**. That container installs `docker-cli`, `docker-cli-compose`, bash, curl, vim and git — and no `kubectl`, `terraform`, `kind` or `kubectl-argo-rollouts`. Every Kubernetes-touching endpoint it proxied to was therefore unrunnable in its own deployment target. The MCP server, by contrast, is spawned as a subprocess on the **host**, where all four tools are present.

## Decision

The MCP server talks to the CLI's own library layer instead of proxying HTTP. It no longer takes `--api`, and no longer needs a running dashboard, a free port, or Docker to answer registry questions.

Three execution modes, chosen by what the operation needs:

| Mode | Used for | Why |
|---|---|---|
| **In-process** | registry reads, coordinate resolution, rollout status, links, log collection | Same package. Typed results, no serialization, no network hop. |
| **CLI subprocess, awaited** | `create_project`, `add_service`, `canary_control`, dry-run deploys | The command actions print via chalk/ora, and this process's **stdout is the JSON-RPC stream** — writing there corrupts the protocol. A subprocess isolates it. Finishes in seconds, so the agent gets the result in one call. |
| **CLI subprocess, as a job** | `cluster_up`, `deploy_service`, `rollback_service`, lifecycle, `run_pipeline` | `cluster up` runs Terraform for minutes and would blow any MCP client's request timeout. The tool returns a `jobId` immediately; the agent polls `get_job` for status and an output tail. |

Coordinate resolution is the other half of the fix. Every tool takes optional `tenant`/`project`/`service` arguments, filled from the `use` context — re-read on **every call**, never cached. When resolution fails, the error names what does exist (`Known services (project/service): 'shop/orders', 'blog/posts'`), and passing a project name where a service is expected says so explicitly instead of returning nothing.

The tool surface is 21 tools named for the current model: `get_context` (the single discovery call, returning the full tree with each project's runtime and each tenant's cluster state), `describe_service`, `cluster_up`/`down`/`status`, `deploy_service`, `canary_status`/`canary_control`, `tenant`/`project`/`service_lifecycle`, `get_logs`, `get_links`, `get_job`/`list_jobs`.

## Consequences

- **Positive:**
  - The golden path is drivable by an agent: provision a cluster, deploy, watch the canary, promote or abort.
  - Works with the dashboard stopped and Docker down (for registry reads), removing a whole class of "why is it empty" failures.
  - Errors are actionable, which is what makes an agent able to recover instead of confabulating.
  - The dashboard's in-container `claude -p` agent keeps working unchanged — it spawns the same `node dist/index.js mcp`, and reads that only need Docker still succeed there.
- **Negative:**
  - The MCP server and the API server are now separate implementations of overlapping reads. The API server remains the dashboard's integration point; MCP no longer depends on it. Fixing a collector benefits both only if it lives in `utils/`.
  - Mutations pay subprocess startup (~150ms of Node boot). Irrelevant next to a Docker build.
  - Jobs live in memory for the session. A client restart loses the handles, though the underlying work continues and its effects are visible through `get_context` / `cluster_status`.
- **Neutral:**
  - The in-container MCP server cannot run the k8s tools, exactly as before. That is a property of the dashboard image, not of this design; adding kubectl to `Dockerfile.dashboard` would lift it.
