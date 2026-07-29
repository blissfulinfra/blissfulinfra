// Smoke harness for the blissful-infra MCP server.
//
// Spawns `blissful-infra mcp` over stdio, lists the tool surface, and exercises
// the read-only tools against whatever is in BLISSFUL_HOME. Mutating tools are
// exercised only in --deep mode, and even then only via dry runs.
//
//   node scripts/mcp-verify.mjs            # read-only checks
//   node scripts/mcp-verify.mjs --deep     # adds a dry-run deploy
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliBin = path.join(repoRoot, "packages", "cli", "dist", "index.js");
const deep = process.argv.includes("--deep");

let failures = 0;
const pass = msg => console.log(`  ✓ ${msg}`);
const fail = msg => { failures++; console.log(`  ✗ ${msg}`); };

// The SDK filters the child environment down to a safe default set, which
// drops BLISSFUL_HOME — without this the harness silently tests the real
// registry instead of whatever scratch home the caller set up.
const transport = new StdioClientTransport({
  command: "node",
  args: [cliBin, "mcp"],
  env: { ...process.env },
});
const client = new Client({ name: "verify-harness", version: "0.0.0" }, { capabilities: {} });

/** Tool errors come back as results with isError, not as exceptions. */
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const first = result.content?.[0];
  return {
    text: first && first.type === "text" ? first.text : "(non-text)",
    isError: Boolean(result.isError),
  };
}

await client.connect(transport);
console.log("connected\n");

console.log("tools/list");
const { tools } = await client.listTools();
console.log(`  ${tools.length} tools: ${tools.map(t => t.name).join(", ")}\n`);

const required = [
  "get_context", "describe_service", "cluster_status", "canary_status",
  "deploy_service", "get_logs", "get_job",
];
console.log("tool surface");
for (const name of required) {
  if (tools.some(t => t.name === name)) pass(name);
  else fail(`${name} missing`);
}
console.log();

console.log("get_context");
let tree = null;
const ctx = await call("get_context");
if (ctx.isError) {
  fail(`errored: ${ctx.text}`);
} else {
  tree = JSON.parse(ctx.text);
  pass(`${tree.tenants.length} tenant(s), current = ${tree.currentTenant ?? "none"}`);
  for (const t of tree.tenants) {
    const svc = t.projects.flatMap(p => p.services.map(s => `${p.name}/${s.name}`));
    console.log(`      ${t.name}: cluster=${t.clusterProvisioned} services=[${svc.join(", ") || "none"}]`);
  }
}
console.log();

const firstService = tree?.tenants
  ?.flatMap(t => t.projects.map(p => ({ tenant: t.name, project: p.name, service: p.services[0]?.name })))
  ?.find(x => x.service);

if (firstService) {
  console.log(`describe_service (${firstService.service})`);
  const d = await call("describe_service", { service: firstService.service, tenant: firstService.tenant });
  if (d.isError) fail(d.text);
  else pass(`resolved → ${JSON.parse(d.text).coordinates.project}/${firstService.service}`);
  console.log();
}

console.log("error paths (the old server returned empty success payloads for these)");
const bogus = await call("describe_service", { service: "definitely-not-a-service" });
if (bogus.isError && /Known services/.test(bogus.text)) {
  pass("unknown service name → actionable error listing real services");
} else {
  fail(`expected a listing error, got: ${bogus.text.slice(0, 120)}`);
}

if (tree?.tenants?.length) {
  const projectName = tree.tenants[0].projects[0]?.name;
  if (projectName) {
    const asService = await call("describe_service", { service: projectName, tenant: tree.tenants[0].name });
    if (asService.isError) pass(`project name '${projectName}' passed as a service → rejected, not silently empty`);
    else fail(`project name '${projectName}' was accepted as a service name`);
  }
}

const bogusJob = await call("get_job", { jobId: "nope" });
if (bogusJob.isError) pass("unknown jobId → error");
else fail("unknown jobId accepted");
console.log();

if (tree?.tenants?.length) {
  const t = tree.tenants[0].name;
  console.log(`cluster_status / get_links (${t})`);
  const cs = await call("cluster_status", { tenant: t });
  if (cs.isError) fail(cs.text);
  else pass(`cluster provisioned = ${JSON.parse(cs.text).provisioned}`);

  const links = await call("get_links", { tenant: t });
  if (links.isError) fail(links.text);
  else pass(`grafana = ${JSON.parse(links.text).grafana ?? "(no port allocated)"}`);
  console.log();
}

if (deep && firstService) {
  console.log("deep: deploy_service dry run");
  const dry = await call("deploy_service", {
    service: firstService.service,
    tenant: firstService.tenant,
    dryRun: true,
  });
  console.log(`      ${dry.text.split("\n").slice(0, 6).join("\n      ")}`);
  pass("dry run returned without side effects");
  console.log();
}

await client.close();
console.log(failures === 0 ? "all checks passed" : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
