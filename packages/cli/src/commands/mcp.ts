import { Command } from "commander";
import { startMcpServer } from "../server/mcp/index.js";

export const mcpCommand = new Command("mcp")
  .description("Start the blissful-infra MCP server (stdio transport for Claude Desktop / Claude Code)")
  .action(async () => {
    // Nothing may be written to stdout here: it carries the JSON-RPC stream.
    await startMcpServer();
  });
