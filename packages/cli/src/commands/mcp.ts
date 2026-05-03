import { Command } from "commander";
import { startMcpServer } from "../server/mcp.js";
import { getClientPortBlock, listClients } from "../utils/client-registry.js";

const DEFAULT_API = "http://localhost:3002";

/**
 * Resolve the API base URL from the user's flags.
 *
 *   --api <url>       → explicit override, wins over everything
 *   --client <name>   → look up the client's dashboard port in the registry,
 *                       construct http://localhost:<port>
 *   neither           → default to http://localhost:3002 (legacy flat-model)
 *
 * Exported for testing.
 */
export async function resolveMcpApiBase(opts: { api?: string; client?: string }): Promise<string> {
  if (opts.api && opts.api !== DEFAULT_API) {
    // User passed --api explicitly (a non-default value). Honor it.
    return opts.api;
  }
  if (opts.client) {
    const block = await getClientPortBlock(opts.client);
    if (!block) {
      const known = (await listClients()).map(c => c.clientName).join(", ") || "(none)";
      throw new Error(
        `Client '${opts.client}' not found in registry. Known clients: ${known}`,
      );
    }
    return `http://localhost:${block.dashboard}`;
  }
  return opts.api ?? DEFAULT_API;
}

export const mcpCommand = new Command("mcp")
  .description("Start the blissful-infra MCP server (stdio transport for Claude Desktop / Claude Code)")
  .option(
    "--api <url>",
    "Dashboard API base URL (overrides --client)",
    DEFAULT_API,
  )
  .option(
    "--client <name>",
    "Auto-discover the dashboard port for the given client (reads ~/.blissful-infra/registry.json)",
  )
  .action(async (opts: { api?: string; client?: string }) => {
    const apiBase = await resolveMcpApiBase(opts);
    await startMcpServer({ apiBase });
  });
