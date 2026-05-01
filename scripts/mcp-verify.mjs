// Minimal MCP client harness — verifies blissful-infra's MCP server works
// end-to-end after the API versioning + client-model migration.
//
// Spawns: blissful-infra mcp --api <port>
// Calls: tools/list, then a few representative tools.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const apiBase = process.argv[2] || "http://localhost:3013";
const cliBin = "/Users/cavanpage/repos/blissful-infra/packages/cli/dist/index.js";

const transport = new StdioClientTransport({
  command: "node",
  args: [cliBin, "mcp", "--api", apiBase],
});

const client = new Client({ name: "verify-harness", version: "0.0.0" }, { capabilities: {} });

await client.connect(transport);

console.log("✓ connected");

// 1. List tools
const tools = await client.listTools();
console.log(`✓ tools/list returned ${tools.tools.length} tools`);
console.log("  sample:", tools.tools.slice(0, 5).map(t => t.name).join(", "));

// 2. Call list_projects (the headline tool)
try {
  const result = await client.callTool({ name: "list_projects", arguments: {} });
  const firstContent = result.content?.[0];
  const text = firstContent && firstContent.type === "text" ? firstContent.text : "(non-text content)";
  console.log("✓ list_projects ->");
  console.log(text.split("\n").slice(0, 10).map(l => "    " + l).join("\n"));
} catch (e) {
  console.log("✗ list_projects FAILED:", e.message);
  process.exit(1);
}

// 3. Call get_health on the 'app' service
try {
  const result = await client.callTool({ name: "get_health", arguments: { project: "app" } });
  const firstContent = result.content?.[0];
  const text = firstContent && firstContent.type === "text" ? firstContent.text : "(non-text content)";
  console.log("✓ get_health(app) ->");
  console.log(text.split("\n").slice(0, 8).map(l => "    " + l).join("\n"));
} catch (e) {
  console.log("✗ get_health FAILED:", e.message);
}

await client.close();
console.log("✓ closed cleanly");
