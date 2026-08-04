#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { demoCommand } from "./commands/demo.js";
import { cleanCommand } from "./commands/clean.js";
import { agentCommand } from "./commands/agent.js";
import { dashboardCommand } from "./commands/dashboard.js";
// CI/CD and deployment
import { deployCommand } from "./commands/deploy.js";
import { rollbackCommand } from "./commands/rollback.js";
import { statusCommand } from "./commands/status.js";
import { pipelineCommand } from "./commands/pipeline.js";
import { jenkinsCommand } from "./commands/jenkins.js";
import { ciCommand } from "./commands/ci.js";
// Resilience
import { perfCommand } from "./commands/perf.js";
import { chaosCommand } from "./commands/chaos.js";
import { compareCommand } from "./commands/compare.js";
import { canaryCommand } from "./commands/canary.js";
// Intelligence
import { analyzeCommand, suggestCommand } from "./commands/analyze.js";
import { mcpCommand } from "./commands/mcp.js";
import { generateCommand } from "./commands/generate.js";
// Tenant/Project/Service hierarchy (ADR-0017)
import { tenantCommand } from "./commands/tenant.js";
import { projectCommand } from "./commands/project.js";
import { serviceCommandV2 } from "./commands/service-v2.js";
import { useCommand } from "./commands/use.js";
import { clusterCommand } from "./commands/cluster.js";

const program = new Command();

program
  .name("blissful-infra")
  .description("Infrastructure that thinks for itself")
  .version("0.1.0");

// Tenant/Project/Service (ADR-0017)
program.addCommand(initCommand);
program.addCommand(demoCommand);
program.addCommand(cleanCommand);
program.addCommand(useCommand);
program.addCommand(tenantCommand);
program.addCommand(projectCommand);
program.addCommand(serviceCommandV2);
program.addCommand(clusterCommand);
program.addCommand(dashboardCommand);

// CI/CD and deployment
program.addCommand(deployCommand);
program.addCommand(rollbackCommand);
program.addCommand(statusCommand);
program.addCommand(pipelineCommand);
program.addCommand(ciCommand);
program.addCommand(jenkinsCommand);
program.addCommand(canaryCommand);

// Resilience (flat-model-keyed, deferred re-key — see CLAUDE.md)
program.addCommand(perfCommand);
program.addCommand(chaosCommand);
program.addCommand(compareCommand);

// Intelligence
program.addCommand(agentCommand);
program.addCommand(analyzeCommand);
program.addCommand(suggestCommand);
program.addCommand(generateCommand);

// Integration
program.addCommand(mcpCommand);

program.parse();
