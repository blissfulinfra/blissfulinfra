import { Command } from "commander";
import { startMcpServer } from "../server/mcp.js";
import { ensureHostDashboardRunning, HOST_DASHBOARD_PORT } from "../utils/host-dashboard-compose.js";

const DEFAULT_API = `http://localhost:${HOST_DASHBOARD_PORT}`;

/**
 * Resolve the API base URL from the user's flags.
 *
 *   --api <url>  → explicit override
 *   omitted      → the host control-plane dashboard on :3002
 *
 * Exported for testing.
 */
export function resolveMcpApiBase(opts: { api?: string }): string {
  return opts.api ?? DEFAULT_API;
}

export const mcpCommand = new Command("mcp")
  .description("Start the blissful-infra MCP server (stdio transport for Claude Desktop / Claude Code)")
  .option(
    "--api <url>",
    "Dashboard API base URL",
    DEFAULT_API,
  )
  .action(async (opts: { api?: string }) => {
    const apiBase = resolveMcpApiBase(opts);
    // When pointing at the default host dashboard, auto-start it so the
    // user doesn't have to remember `dashboard up` first. Silent so the
    // JSON-RPC stdio stream on stdout stays clean. If the user pointed
    // --api somewhere else, assume they know what they're doing.
    if (apiBase === DEFAULT_API) {
      await ensureHostDashboardRunning({ silent: true });
    }
    await startMcpServer({ apiBase });
  });
