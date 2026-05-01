import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const cliBin = "/Users/cavanpage/repos/blissful-infra/packages/cli/dist/index.js";

const transport = new StdioClientTransport({
  command: "node",
  args: [cliBin, "mcp", "--client", "dev"],
});

const client = new Client({ name: "verify", version: "0.0.0" }, { capabilities: {} });
await client.connect(transport);
console.log("✓ connected via --client dev (no --api flag passed)");

const tools = await client.listTools();
console.log(`✓ ${tools.tools.length} tools listed`);

const result = await client.callTool({ name: "list_projects", arguments: {} });
const text = result.content?.[0]?.type === "text" ? result.content[0].text : "(non-text)";
const parsed = JSON.parse(text);
console.log(`✓ list_projects returned ${parsed.length} item(s):`, parsed.map(p => p.name).join(", "));

await client.close();
console.log("✓ done");
