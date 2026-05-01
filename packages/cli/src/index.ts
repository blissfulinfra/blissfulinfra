#!/usr/bin/env node

import { Command } from "commander";
import fs from "node:fs/promises";
import path from "node:path";
import { createCommand } from "./commands/create.js";
import { startCommand } from "./commands/start.js";
import { initCommand } from "./commands/init.js";
import { upCommand, upAction } from "./commands/up.js";
import { downCommand, downAction } from "./commands/down.js";
import { logsCommand, logsAction } from "./commands/logs.js";
import { devCommand } from "./commands/dev.js";
import { agentCommand, agentAction } from "./commands/agent.js";
import { dashboardCommand } from "./commands/dashboard.js";
// Phase 2 commands
import { deployCommand, deployAction } from "./commands/deploy.js";
import { rollbackCommand, rollbackAction } from "./commands/rollback.js";
import { statusCommand, statusAction } from "./commands/status.js";
import { pipelineCommand, pipelineAction } from "./commands/pipeline.js";
import { jenkinsCommand } from "./commands/jenkins.js";
// Phase 4 commands
import { perfCommand, perfAction } from "./commands/perf.js";
import { chaosCommand, chaosAction } from "./commands/chaos.js";
import { compareCommand, compareAction } from "./commands/compare.js";
import { canaryCommand } from "./commands/canary.js";
// Phase 5 commands
import { analyzeCommand, analyzeAction, suggestCommand, suggestAction } from "./commands/analyze.js";
import { exampleCommand } from "./commands/example.js";
import { mcpCommand } from "./commands/mcp.js";
import { generateCommand } from "./commands/generate.js";
// Phase 6 commands (Client Model)
import { clientCommand } from "./commands/client.js";
import { serviceCommand } from "./commands/service.js";

const program = new Command();

program
  .name("blissful-infra")
  .description("Infrastructure that thinks for itself")
  .version("0.1.0");

// Global commands (don't require a project)
program.addCommand(initCommand);
program.addCommand(startCommand);
program.addCommand(createCommand);

// Legacy commands (also work from project directory or with name arg)
program.addCommand(upCommand);
program.addCommand(downCommand);
program.addCommand(logsCommand);
program.addCommand(devCommand);
program.addCommand(agentCommand);
program.addCommand(dashboardCommand);

// Phase 2 commands (CI/CD and deployment)
program.addCommand(deployCommand);
program.addCommand(rollbackCommand);
program.addCommand(statusCommand);
program.addCommand(pipelineCommand);
program.addCommand(jenkinsCommand);

// Phase 4 commands (Resilience)
program.addCommand(perfCommand);
program.addCommand(chaosCommand);
program.addCommand(compareCommand);
program.addCommand(canaryCommand);

// Phase 5 commands (Intelligence)
program.addCommand(analyzeCommand);
program.addCommand(suggestCommand);

// Examples
program.addCommand(exampleCommand);
program.addCommand(mcpCommand);

// Schema-first code generation
program.addCommand(generateCommand);

// Phase 6 commands (Client Model)
program.addCommand(clientCommand);
program.addCommand(serviceCommand);

// Check if first arg is a project directory for project-first syntax
async function isProjectDir(name: string): Promise<boolean> {
  try {
    const projectDir = path.join(process.cwd(), name);
    await fs.access(path.join(projectDir, "blissful-infra.yaml"));
    return true;
  } catch {
    return false;
  }
}

// Handle project-first syntax: blissful-infra <project> <command>
async function main() {
  const args = process.argv.slice(2);

  // If first arg could be a project name (not a known command or flag)
  if (args.length >= 1 && !args[0].startsWith("-")) {
    const knownCommands = ["start", "create", "up", "down", "logs", "dev", "agent", "dashboard", "deploy", "rollback", "status", "pipeline", "jenkins", "perf", "chaos", "compare", "canary", "analyze", "suggest", "example", "help", "client", "service", "generate", "mcp", "init"];
    const firstArg = args[0];

    if (!knownCommands.includes(firstArg) && await isProjectDir(firstArg)) {
      const projectName = firstArg;
      const subCommand = args[1];
      const remainingArgs = args.slice(2);

      // Create a project-specific command group
      const projectProgram = new Command(projectName);
      projectProgram.description(`Commands for project '${projectName}'`);

      // Add project-scoped commands
      projectProgram
        .command("up")
        .description("Start the local development environment")
        .option("-d, --detach", "Run in background", true)
        .action(async () => {
          await upAction(projectName);
        });

      projectProgram
        .command("down")
        .description("Stop the local development environment")
        .option("-v, --volumes", "Remove volumes too")
        .action(async (opts: { volumes?: boolean }) => {
          await downAction(projectName, opts);
        });

      projectProgram
        .command("logs")
        .description("View logs from the local environment")
        .option("-f, --follow", "Follow log output")
        .option("-n, --lines <number>", "Number of lines to show", "100")
        .option("-s, --service <name>", "Show logs for specific service")
        .action(async (opts: { follow?: boolean; lines?: string; service?: string }) => {
          await logsAction(projectName, opts);
        });

      // Agent command with subcommands
      const projectAgent = projectProgram
        .command("agent")
        .description("AI agents and virtual employees");

      projectAgent
        .command("chat")
        .description("Interactive AI assistant for debugging")
        .option("-q, --query <query>", "Single query mode (non-interactive)")
        .option("-m, --model <model>", "Override model selection")
        .action(async (opts: { query?: string; model?: string }) => {
          await agentAction(projectName, opts);
        });

      projectAgent
        .command("hire")
        .description("Hire a virtual employee")
        .argument("<role>", "Agent role")
        .option("-n, --name <name>", "Agent name")
        .action(async (role: string, opts: { name?: string }) => {
          // Delegate to the global agent hire command
          const { agentCommand: ac } = await import("./commands/agent.js");
          ac.parse(["node", "blissful-infra", "hire", role, ...(opts.name ? ["-n", opts.name] : [])]);
        });

      projectAgent
        .command("fire")
        .description("Fire a virtual employee")
        .argument("<name>", "Agent name")
        .action(async (name: string) => {
          const { agentCommand: ac } = await import("./commands/agent.js");
          ac.parse(["node", "blissful-infra", "fire", name]);
        });

      projectAgent
        .command("list")
        .description("List active virtual employees")
        .action(async () => {
          const { agentCommand: ac } = await import("./commands/agent.js");
          ac.parse(["node", "blissful-infra", "list"]);
        });

      projectAgent
        .command("assign")
        .description("Assign a task to a virtual employee")
        .argument("<name>", "Agent name")
        .argument("<task>", "Task description")
        .action(async (name: string, task: string) => {
          const { agentCommand: ac } = await import("./commands/agent.js");
          ac.parse(["node", "blissful-infra", "assign", name, task]);
        });

      projectAgent
        .command("status")
        .description("Show agent progress")
        .argument("<name>", "Agent name")
        .action(async (name: string) => {
          const { agentCommand: ac } = await import("./commands/agent.js");
          ac.parse(["node", "blissful-infra", "status", name]);
        });

      // Phase 2 commands
      projectProgram
        .command("deploy")
        .description("Deploy to environment via Argo CD")
        .option("-e, --env <environment>", "Target environment", "staging")
        .option("-i, --image <tag>", "Specific image tag to deploy")
        .option("--dry-run", "Show what would be deployed")
        .action(async (opts: { env: string; image?: string; dryRun?: boolean }) => {
          await deployAction(projectName, opts);
        });

      projectProgram
        .command("rollback")
        .description("Rollback to previous deployment")
        .option("-e, --env <environment>", "Target environment", "staging")
        .option("-r, --revision <id>", "Revision to rollback to")
        .option("--dry-run", "Show what would be rolled back")
        .action(async (opts: { env: string; revision?: string; dryRun?: boolean }) => {
          await rollbackAction(projectName, opts);
        });

      projectProgram
        .command("status")
        .description("Show deployment status")
        .action(async () => {
          await statusAction(projectName);
        });

      projectProgram
        .command("pipeline")
        .description("Run CI/CD pipeline locally")
        .option("--local", "Run pipeline locally")
        .option("--push", "Push image to registry")
        .option("--skip-tests", "Skip test stage")
        .option("--skip-scan", "Skip security scan")
        .action(async (opts: { local?: boolean; push?: boolean; skipTests?: boolean; skipScan?: boolean }) => {
          await pipelineAction(projectName, opts);
        });

      // Phase 4 commands
      projectProgram
        .command("perf")
        .description("Run performance tests with k6")
        .option("-e, --env <environment>", "Target environment", "local")
        .option("-d, --duration <duration>", "Duration per stage", "30s")
        .option("-u, --vus <count>", "Maximum virtual users", "50")
        .option("-b, --base-url <url>", "Base URL to test against")
        .option("-s, --script <path>", "Custom k6 script path")
        .option("--json", "Output results as JSON")
        .action(async (opts: { env?: string; duration?: string; vus?: string; baseUrl?: string; script?: string; json?: boolean }) => {
          await perfAction(projectName, opts);
        });

      projectProgram
        .command("chaos")
        .description("Run chaos engineering experiments (FMEA)")
        .option("-e, --env <environment>", "Target environment", "local")
        .option("-s, --scenario <name>", "Run specific scenario")
        .option("-d, --duration <duration>", "Duration per experiment", "30s")
        .option("-i, --intensity <level>", "Chaos intensity (low, medium, high)", "medium")
        .option("--service <name>", "Target specific service")
        .option("--dry-run", "Show what would happen without running")
        .option("--json", "Output results as JSON")
        .action(async (opts: { env?: string; scenario?: string; duration?: string; intensity?: "low" | "medium" | "high"; service?: string; dryRun?: boolean; json?: boolean }) => {
          await chaosAction(projectName, opts);
        });

      projectProgram
        .command("compare")
        .description("Compare performance between two versions")
        .requiredOption("--old <ref>", "Old version git ref")
        .requiredOption("--new <ref>", "New version git ref")
        .option("-d, --duration <duration>", "Duration per version", "15s")
        .option("-u, --vus <count>", "Virtual users", "20")
        .option("-b, --base-url <url>", "Base URL", "http://localhost:8080")
        .option("--json", "Output results as JSON")
        .action(async (opts: { old: string; new: string; duration?: string; vus?: string; baseUrl?: string; json?: boolean }) => {
          await compareAction(projectName, opts);
        });

      // Phase 5 commands
      projectProgram
        .command("analyze")
        .description("Analyze system state and find root causes")
        .option("-i, --incident <id>", "Analyze specific incident")
        .option("--json", "Output results as JSON")
        .option("--record", "Record findings as incident")
        .option("--k8s", "Include Kubernetes context")
        .action(async (opts: { incident?: string; json?: boolean; record?: boolean; k8s?: boolean }) => {
          await analyzeAction(projectName, opts);
        });

      projectProgram
        .command("suggest")
        .description("Get proactive improvement suggestions")
        .option("--json", "Output results as JSON")
        .action(async (opts: { json?: boolean }) => {
          await suggestAction(projectName, opts);
        });

      // Parse project-specific command
      if (subCommand) {
        projectProgram.parse(["node", "blissful-infra", subCommand, ...remainingArgs]);
      } else {
        projectProgram.outputHelp();
      }
      return;
    }
  }

  // Fall back to standard parsing
  program.parse();
}

main().catch(console.error);
