---
title: blissful-infra mcp
description: Run the MCP server for Claude to control blissful-infra — provisions clusters, deploys services, drives canary rollouts.
---

The MCP server exposes blissful-infra's tenant model and Kubernetes golden path as tools for Claude. Use it to let Claude scaffold services, run deploys, manage canaries and query cluster state.

```bash
blissful-infra mcp
```

The server listens on stdin/stdout as JSON-RPC 2.0 and emits everything to stderr (so logs don't pollute the stream). Point Claude to it via your client's MCP configuration.

## Installation

### From npm (2.0 and later)

Once blissful-infra 2.0 ships to npm, install globally:

```bash
npm install -g @blissful-infra/cli
blissful-infra mcp
```

Or as a local dev dependency in your project:

```bash
npm install --save-dev @blissful-infra/cli
npx blissful-infra mcp
```

### From GitHub (development / unreleased)

For the bleeding-edge version, clone the repo and run from source:

```bash
git clone https://github.com/cavanpage/blissful-infra.git
cd blissful-infra

# Install dependencies
npm install

# Build the CLI
npm run build

# Run the MCP server
node packages/cli/dist/index.js mcp
```

You can also use `npm link` to simulate a global install without publishing to npm:

```bash
cd blissful-infra/packages/cli
npm link

# Now 'blissful-infra' is available globally as if installed from npm
blissful-infra mcp
```

## Configuring Claude to use the MCP server

The exact configuration depends on your Claude client. Here are the common patterns:

### Claude Code (desktop or VS Code)

Add to your Claude Code settings file (location depends on your client):

```json
{
  "mcpServers": {
    "blissful-infra": {
      "command": "node",
      "args": ["/path/to/packages/cli/dist/index.js", "mcp"]
    }
  }
}
```

Or if you used `npm link`:

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

### Claude.ai (web)

If using Claude.ai with local MCP forwarding (e.g., via a tunnel or local proxy):

```json
{
  "mcpServers": {
    "blissful-infra": {
      "command": "sh",
      "args": ["-c", "cd /path/to/blissful-infra && npm run build && node packages/cli/dist/index.js mcp"]
    }
  }
}
```

## What tools does Claude get

The MCP server exposes 21 tools covering:

| Category | Tools |
|---|---|
| **Discovery** | `list_tenants`, `get_tenant`, `list_projects`, `get_project`, `list_services`, `get_service` |
| **Lifecycle** | `create_tenant`, `delete_tenant`, `create_project`, `delete_project`, `add_service`, `remove_service` |
| **Kubernetes golden path** | `cluster_up`, `cluster_down`, `cluster_status`, `deploy_service`, `canary_status`, `canary_promote`, `canary_abort` |
| **Observability** | `get_logs`, `get_metrics`, `list_ports` |

Each tool takes tenant/project/service coordinates and returns structured data. Long operations (cluster up, deploy) return a job ID polled via `get_job`.

## Example: deploy a service via Claude

With the MCP server running, you can ask Claude:

> "Deploy the orders service to our prod cluster with a canary rollout."

Claude will:
1. Call `list_services` to find the orders service
2. Call `deploy_service` with the service coordinates
3. Poll `get_job` until the deploy completes
4. Call `canary_status` to show you the rollout state
5. Wait for your signal to promote

## See also

- [ADR-0021: MCP as an in-process control plane](/docs/adr/0021-mcp-in-process-control-plane.md)
- [`deploy`](/commands/deploy)
- [`canary`](/commands/canary)
