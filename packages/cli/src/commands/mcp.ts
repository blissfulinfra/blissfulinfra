import { Command } from "commander";
import { startMcpServer } from "../server/mcp.js";

export const mcpCommand = new Command("mcp")
  .description("Start the blissful-infra MCP server (stdio transport for Claude Desktop / Claude Code)")
  .option(
    "--api <url>",
    "Dashboard API base URL",
    "http://localhost:3002"
  )
  .action(async (opts) => {
    await startMcpServer({ apiBase: opts.api });
  });
