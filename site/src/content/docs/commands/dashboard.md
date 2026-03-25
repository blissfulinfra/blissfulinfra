---
title: blissful-infra dashboard
description: Launch the local web dashboard for monitoring, logs, CI/CD, and AI diagnostics.
---

`blissful-infra dashboard` starts the local web UI for managing all your blissful-infra projects in one place. It also starts the shared Jenkins CI server if it is not already running.

## Usage

```bash
blissful-infra dashboard [options]
```

## Options

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--port <port>` | `-p` | `3002` | Port for the dashboard API server |
| `--no-open` | — | opens browser | Skip automatic browser open |
| `--no-jenkins` | — | starts Jenkins | Do not start Jenkins CI server |
| `--dir <directory>` | `-d` | `cwd` | Working directory to scan for projects |

## What the dashboard provides

The dashboard is a React application backed by a local API server that connects to your running Docker containers. It runs at `http://localhost:5173` (Vite dev server) and communicates with the API at `http://localhost:3002`.

### Tabs

| Tab | What it does |
|-----|--------------|
| **Logs** | Real-time log streaming from all containers via WebSocket. Filter by service, log level, or search text. Loki-backed for historical search. |
| **Metrics** | Live CPU, memory, HTTP request rates, latency percentiles (p50/p95/p99), and error rates. Sourced from Prometheus. |
| **Agent** | Chat interface to the AI debugging agent. Ask about errors, request root cause analysis, or get recommendations. The agent has read access to logs, metrics, and container state. |
| **Pipeline** | Jenkins CI/CD pipeline status — current stage, last build result, build history. Trigger new builds from the UI. |
| **Environments** | Deploy and rollback across environments (local, staging, production via Argo CD). |
| **Settings** | Configure alert thresholds, log retention, and notification preferences. |

## Services started by `dashboard`

Running `blissful-infra dashboard` starts two things:

1. **The API server** on `--port` (default `3002`) — a Node.js HTTP + WebSocket server that proxies Docker, Prometheus, Loki, and Jenkins APIs
2. **The Jenkins CI server** — starts the shared `blissful-jenkins` Docker container if it is not already running. Jenkins persists at `~/.blissful-infra/jenkins/` so it retains all jobs, build history, and configuration between restarts

The Vite dev server for the dashboard UI starts after both are ready and the browser opens automatically.

## MCP server integration

The dashboard API is also the backend for the [MCP server](https://modelcontextprotocol.io), which lets Claude orchestrate your infrastructure directly.

Start the MCP server after the dashboard is running:

```bash
# In a separate terminal, after blissful-infra dashboard is running
blissful-infra mcp --api http://localhost:3002
```

Or configure it permanently in Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "blissful-infra": {
      "command": "npx",
      "args": ["-y", "blissful-infra", "mcp"],
      "env": {}
    }
  }
}
```

Once connected, you can ask Claude things like:

- "What's the health of all my running projects?"
- "Show me ERROR logs from the backend in my-app"
- "Why is the backend restarting? Check the logs and diagnose."
- "Deploy my-app to staging"
- "Roll back my-app in production to the previous revision"

## Running the dashboard in a specific directory

By default the dashboard scans the current working directory for projects (directories with a `blissful-infra.yaml`). Use `--dir` to point it at a different location:

```bash
blissful-infra dashboard --dir ~/projects
```

This is useful if you keep all your blissful-infra projects in a dedicated directory.

## Jenkins credentials

Jenkins runs with default credentials:

- **URL:** http://localhost:8081
- **Username:** `admin`
- **Password:** `admin`

Jenkins is configured with the Jenkins Configuration as Code (JCasC) plugin, so the initial setup is fully automated. All jobs created by `blissful-infra jenkins add-project` land in a `blissful-projects` folder.

## Stopping the dashboard

Press `Ctrl+C`. The API server shuts down cleanly. Jenkins is intentionally left running so any in-progress builds can complete. Stop Jenkins explicitly with:

```bash
blissful-infra jenkins stop
```
