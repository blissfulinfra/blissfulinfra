---
title: blissful-infra dashboard
description: The host-level web dashboard — one control plane at localhost:3002 for every tenant, with logs, metrics, canary rollouts and an AI agent.
---

The dashboard is a single control plane for **every** tenant on the machine. It runs in its own container on `localhost:3002`, separate from any tenant's network.

```bash
blissful-infra dashboard up
```

## Subcommands

| Command | What it does |
|---|---|
| `dashboard up` | Start the dashboard and open it in your browser |
| `dashboard down` | Stop the dashboard |
| `dashboard status` | Show whether it is running |
| `dashboard open` | Open the running dashboard in your browser |
| `dashboard login` | Authenticate the Agent tab with Claude (one-time, no API key needed) |

`dashboard up` takes `--no-open` to skip launching the browser.

## One dashboard, every tenant

The dashboard is host-level, not per-tenant. A tenant switcher in the header re-scopes the whole UI, and every request it makes carries the selected tenant. You do not run one dashboard per tenant.

## Tabs

| Tab | What it does |
|---|---|
| **Logs** | Live log streaming, Loki-backed when available, with service, level and text filters. Falls back to Docker logs when Loki is not running. |
| **Metrics** | CPU, memory, request rate and latency percentiles (p50/p95/p99) from Prometheus, with a selectable time window. |
| **Agent** | Chat with an AI agent that has read access to logs, metrics and container state. Needs `dashboard login` or an `ANTHROPIC_API_KEY`. |
| **Pipeline** | Jenkins stage view and build history. Trigger a run, optionally skipping tests or the security scan. |
| **Environments** | ArgoCD sync state per environment, plus a live canary card — weight bar, step counter, Promote / Promote Full / Abort. |
| **Deployments** | Deploy history with git SHA, image tag, strategy, duration and p95 latency delta with regression flagging. |
| **Plugins** | Status of the project's platform services. |
| **Perf** | Gatling load-test runs and their results. |
| **Watcher** | File-watching and rebuild activity. |
| **Settings** | Alert thresholds, log retention and metrics storage. |

Beyond the tabs, the header opens a **Graph** view of the system topology — tenant infrastructure, project lanes, services, and the cluster components (ArgoCD, Gitea, Argo Rollouts) when a project runs on Kubernetes — and a **Terminal** into the dashboard container.

## The canary card

For `--runtime kubernetes` projects, the Environments tab renders the live Argo Rollout: current traffic split, which step it is on, and buttons to promote or abort. It is the same rollout [`canary`](/commands/canary) drives from the CLI, so you can start in one and finish in the other.

Compose-runtime projects have no Rollout, so the card does not appear.

## The Agent tab

```bash
blissful-infra dashboard login
```

A one-time browser flow that authenticates the Agent tab against your Claude account, so you do not need to manage an API key. If you would rather use a key, set `ANTHROPIC_API_KEY` in your environment before starting the dashboard.

## MCP server

The same capabilities are available to Claude Desktop and Claude Code over the Model Context Protocol:

```json
{
  "mcpServers": {
    "blissful-infra": {
      "command": "blissful-infra",
      "args": ["mcp"]
    }
  }
}
```

Once connected you can ask things like "what is the health of my running services?", "show me ERROR logs from orders", or "why did the last deploy regress p95?".

## Stopping it

```bash
blissful-infra dashboard down
```

The dashboard runs as a detached container, so closing your terminal does not stop it.

## See also

- [`status`](/commands/status) — the same information from the CLI
- [`canary`](/commands/canary) — drive rollouts from the terminal
- [`jenkins`](/commands/jenkins) — the CI server behind the Pipeline tab
