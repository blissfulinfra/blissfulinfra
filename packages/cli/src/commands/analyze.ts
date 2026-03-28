import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import path from "node:path";
import { loadConfig, findProjectDir } from "../utils/config.js";
import { analyzeSystem, type AnalysisResult } from "../utils/analyzer.js";
import {
  recordIncident,
  getKnowledgeBaseStats,
  initializeKnowledgeBase,
  searchIncidents,
} from "../utils/knowledge-base.js";

interface AnalyzeOptions {
  incident?: string;
  json?: boolean;
  record?: boolean;
  k8s?: boolean;
}

function formatAnalysisResult(result: AnalysisResult): void {
  console.log(chalk.blue.bold(`\nRoot Cause Analysis: ${result.project}\n`));

  // Finding
  const confColor = result.confidence >= 80 ? chalk.green : result.confidence >= 50 ? chalk.yellow : chalk.red;
  console.log(chalk.white.bold("  Finding: ") + chalk.white(result.finding));
  console.log(chalk.white.bold("  Confidence: ") + confColor(`${result.confidence}%`));
  console.log();

  // Root Cause
  console.log(chalk.white.bold("  Root Cause:"));
  console.log(chalk.cyan(`    ${result.rootCause}`));
  console.log();

  // Timeline
  if (result.timeline.length > 0) {
    console.log(chalk.white.bold("  Timeline:"));
    const recentEvents = result.timeline.slice(-10);
    for (const event of recentEvents) {
      const timeStr = new Date(event.timestamp).toLocaleTimeString();
      const sevIcon = event.severity === "critical" ? chalk.red("!!") :
        event.severity === "error" ? chalk.red("!") :
        event.severity === "warning" ? chalk.yellow("~") : chalk.gray("-");
      console.log(`    ${chalk.gray(timeStr)} ${sevIcon} ${event.event.slice(0, 100)}`);
      if (event.details) {
        console.log(chalk.gray(`                   ${event.details}`));
      }
    }
    console.log();
  }

  // Correlations
  if (result.correlations.length > 0) {
    console.log(chalk.white.bold("  Correlations:"));
    for (const corr of result.correlations) {
      console.log(chalk.yellow(`    [${corr.sourceA} ↔ ${corr.sourceB}] ${corr.description}`));
    }
    console.log();
  }

  // Matched Patterns
  if (result.matchedPatterns.length > 0) {
    console.log(chalk.white.bold("  Matched Patterns:"));
    for (const match of result.matchedPatterns.slice(0, 3)) {
      const strength = Math.round(match.matchStrength * 100);
      console.log(chalk.cyan(`    ${match.pattern.name} (${strength}% match)`));
      console.log(chalk.gray(`      Symptoms: ${match.matchedSymptoms.join(", ")}`));
    }
    console.log();
  }

  // Similar Incidents
  if (result.similarIncidents.length > 0) {
    console.log(chalk.white.bold("  Similar Past Incidents:"));
    for (const { incident, similarity } of result.similarIncidents.slice(0, 3)) {
      const simPct = Math.round(similarity * 100);
      const statusIcon = incident.status === "resolved" ? chalk.green("resolved") : chalk.yellow(incident.status);
      console.log(`    ${chalk.gray(`[${simPct}%]`)} ${incident.title} (${statusIcon})`);
      if (incident.resolution) {
        console.log(chalk.gray(`          Fix: ${incident.resolution}`));
      }
    }
    console.log();
  }

  // Suggested Fixes
  if (result.suggestedFixes.length > 0) {
    console.log(chalk.white.bold("  Suggested Fixes:"));
    for (const fix of result.suggestedFixes.slice(0, 5)) {
      const autoTag = fix.autoFixAvailable ? chalk.green(" [AUTO-FIX]") : "";
      const confStr = chalk.gray(`(${Math.round(fix.confidence)}% confidence)`);
      console.log(`    ${chalk.green("→")} ${fix.description}${autoTag} ${confStr}`);
      console.log(chalk.gray(`      Source: ${fix.source}`));
    }
    console.log();
  }
}

async function runAnalysis(projectDir: string, options: AnalyzeOptions): Promise<void> {
  const config = await loadConfig(projectDir);
  const projectName = config?.name || path.basename(projectDir);
  const namespace = projectName;

  // Initialize knowledge base if needed
  await initializeKnowledgeBase(projectDir);

  const spinner = ora("Analyzing system state...").start();
  spinner.text = "Correlating data sources...";

  const result = await analyzeSystem(projectDir, projectName, {
    includeK8s: options.k8s,
    namespace,
    incidentId: options.incident,
  });

  spinner.stop();

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  formatAnalysisResult(result);

  // Record as incident if requested
  if (options.record && result.finding !== "No issues detected") {
    const incident = await recordIncident(projectDir, {
      timestamp: new Date().toISOString(),
      project: projectName,
      type: "custom",
      severity: result.confidence >= 70 ? "high" : "medium",
      title: result.finding,
      description: result.rootCause,
      rootCause: result.rootCause,
      sources: result.matchedPatterns.map((p) => ({
        type: "manual" as const,
        summary: `Pattern: ${p.pattern.name} (${Math.round(p.matchStrength * 100)}% match)`,
      })),
      tags: [],
    });
    console.log(chalk.gray(`Recorded as incident: ${incident.id}`));
  }
}

// --- Suggest Command ---

async function runSuggest(projectDir: string, json: boolean): Promise<void> {
  const config = await loadConfig(projectDir);
  const projectName = config?.name || path.basename(projectDir);

  await initializeKnowledgeBase(projectDir);

  const spinner = ora("Generating suggestions...").start();

  // Collect context and analyze
  const result = await analyzeSystem(projectDir, projectName);

  // Get knowledge base stats
  const stats = await getKnowledgeBaseStats(projectDir);

  // Get open incidents
  const openIncidents = await searchIncidents(projectDir, { status: "open", limit: 10 });

  spinner.stop();

  if (json) {
    console.log(JSON.stringify({ result, stats, openIncidents }, null, 2));
    return;
  }

  console.log(chalk.blue.bold(`\nSuggestions for ${projectName}\n`));

  // Knowledge base stats
  console.log(chalk.white.bold("  Knowledge Base:"));
  console.log(chalk.gray(`    ${stats.incidents.total} incidents (${stats.incidents.open} open, ${stats.incidents.resolved} resolved)`));
  console.log(chalk.gray(`    ${stats.patterns.total} known patterns`));
  if (stats.fixes.total > 0) {
    console.log(chalk.gray(`    Fix success rate: ${(stats.fixes.successRate * 100).toFixed(0)}%`));
  }
  console.log();

  // Open incidents
  if (openIncidents.length > 0) {
    console.log(chalk.yellow.bold("  Open Incidents:"));
    for (const inc of openIncidents) {
      const sevColor = inc.severity === "critical" ? chalk.red : inc.severity === "high" ? chalk.yellow : chalk.gray;
      console.log(`    ${sevColor(`[${inc.severity.toUpperCase()}]`)} ${inc.title} (${inc.id})`);
    }
    console.log();
  }

  // Current suggestions from analysis
  if (result.suggestedFixes.length > 0) {
    console.log(chalk.green.bold("  Recommendations:"));
    for (const fix of result.suggestedFixes.slice(0, 5)) {
      const priority = fix.confidence >= 70 ? chalk.red("[HIGH]") : fix.confidence >= 40 ? chalk.yellow("[MEDIUM]") : chalk.gray("[LOW]");
      console.log(`    ${priority} ${fix.description}`);
    }
    console.log();
  }

  // General best practices if no specific issues found
  if (result.suggestedFixes.length === 0) {
    console.log(chalk.green.bold("  Best Practice Checks:"));
    console.log(chalk.green("    ✓ Run chaos tests: blissful-infra chaos"));
    console.log(chalk.green("    ✓ Run performance tests: blissful-infra perf"));
    console.log(chalk.green("    ✓ Review resilience scorecard: blissful-infra chaos --scorecard"));
    console.log();
  }
}

// --- Commands ---

export const analyzeCommand = new Command("analyze")
  .description("Analyze system state and find root causes")
  .argument("[name]", "Project name")
  .option("-i, --incident <id>", "Analyze specific incident")
  .option("--json", "Output results as JSON")
  .option("--record", "Record findings as a new incident")
  .option("--k8s", "Include Kubernetes context")
  .action(async (name: string | undefined, options: AnalyzeOptions) => {
    const projectDir = await findProjectDir(name);
    if (!projectDir) {
      console.log(chalk.red("Error: Not in a blissful-infra project directory."));
      process.exit(1);
    }
    await runAnalysis(projectDir, options);
  });

export const suggestCommand = new Command("suggest")
  .description("Get proactive improvement suggestions")
  .argument("[name]", "Project name")
  .option("--json", "Output results as JSON")
  .action(async (name: string | undefined, options: { json?: boolean }) => {
    const projectDir = await findProjectDir(name);
    if (!projectDir) {
      console.log(chalk.red("Error: Not in a blissful-infra project directory."));
      process.exit(1);
    }
    await runSuggest(projectDir, !!options.json);
  });

export async function analyzeAction(name: string, options: AnalyzeOptions = {}): Promise<void> {
  const projectDir = await findProjectDir(name);
  if (!projectDir) {
    console.log(chalk.red(`Error: Project '${name}' not found.`));
    return;
  }
  await runAnalysis(projectDir, options);
}

export async function suggestAction(name: string, options: { json?: boolean } = {}): Promise<void> {
  const projectDir = await findProjectDir(name);
  if (!projectDir) {
    console.log(chalk.red(`Error: Project '${name}' not found.`));
    return;
  }
  await runSuggest(projectDir, !!options.json);
}
