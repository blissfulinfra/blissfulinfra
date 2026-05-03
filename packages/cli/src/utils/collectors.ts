import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";
import type { IncidentSource } from "./knowledge-base.js";

export interface LogEntry {
  timestamp: string;
  service: string;
  message: string;
}

export interface GitCommit {
  sha: string;
  author: string;
  date: string;
  message: string;
}

export interface CollectedContext {
  logs: LogEntry[];
  commits: GitCommit[];
  summary: string;
}

/**
 * Collect Docker Compose logs from a project.
 *
 * In client mode (CLIENT_NAME env set), the service's containers belong to
 * the unified client compose project — `docker compose logs` from the
 * per-service dir would return nothing because the project name doesn't
 * match. We fall through to plain `docker logs` against each matching
 * container instead. Mirror of the same client-mode branch in
 * checkServiceHealth.
 */
export async function collectDockerLogs(
  projectDir: string,
  options: { tail?: number; service?: string } = {}
): Promise<LogEntry[]> {
  const { tail = 100, service } = options;
  const clientName = process.env.CLIENT_NAME;

  if (clientName) {
    return collectClientServiceLogs(projectDir, clientName, tail, service);
  }

  try {
    const args = ["compose", "logs", `--tail=${tail}`, "--no-color"];
    if (service) {
      args.push(service);
    }

    const { stdout } = await execa("docker", args, {
      cwd: projectDir,
      reject: false,
    });

    return parseDockerLogs(stdout);
  } catch {
    return [];
  }
}

async function collectClientServiceLogs(
  projectDir: string,
  clientName: string,
  tail: number,
  roleFilter?: string,
): Promise<LogEntry[]> {
  const serviceName = path.basename(projectDir);
  const prefix = `${clientName}-${serviceName}-`;

  let containers: string[] = [];
  try {
    const ps = await execa("docker", [
      "ps", "-a", "--no-trunc",
      "--filter", `name=${prefix}`,
      "--format", "{{.Names}}",
    ], { reject: false });
    containers = ps.stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }

  const targets = roleFilter
    ? containers.filter(c => c === `${prefix}${roleFilter}`)
    : containers;

  const entries: LogEntry[] = [];
  for (const container of targets) {
    const role = container.slice(prefix.length);
    try {
      const r = await execa("docker", [
        "logs", "--tail", String(tail), "--timestamps", container,
      ], { reject: false });
      // Docker logs interleaves stdout/stderr; merge both for the consumer.
      const combined = `${r.stdout}\n${r.stderr}`;
      for (const line of combined.split("\n")) {
        if (!line.trim()) continue;
        const match = line.match(/^(\S+)\s+(.*)$/);
        if (match) {
          entries.push({ timestamp: match[1], service: role, message: match[2] });
        } else {
          entries.push({ timestamp: new Date().toISOString(), service: role, message: line });
        }
      }
    } catch {
      // Skip containers we can't read — the rest still produce useful output
    }
  }

  entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return entries.slice(-tail);
}

/**
 * Parse Docker Compose logs into structured format
 */
function parseDockerLogs(output: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const lines = output.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    // Docker compose log format: "service-name  | log message"
    const match = line.match(/^([^\s|]+)\s*\|\s*(.*)$/);
    if (match) {
      const [, service, message] = match;

      // Try to extract timestamp from message
      const timestampMatch = message.match(
        /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\s]*)\s*/
      );
      const timestamp = timestampMatch ? timestampMatch[1] : new Date().toISOString();
      const cleanMessage = timestampMatch
        ? message.slice(timestampMatch[0].length)
        : message;

      entries.push({
        timestamp,
        service: service.trim(),
        message: cleanMessage.trim(),
      });
    } else if (line.trim()) {
      // Line without service prefix
      entries.push({
        timestamp: new Date().toISOString(),
        service: "unknown",
        message: line.trim(),
      });
    }
  }

  return entries;
}

/**
 * Collect recent git commits from a repository
 */
export async function collectGitCommits(
  repoDir: string,
  options: { limit?: number; since?: string } = {}
): Promise<GitCommit[]> {
  const { limit = 10, since } = options;

  try {
    const args = [
      "log",
      `--max-count=${limit}`,
      "--format=%H|%an|%aI|%s",
    ];

    if (since) {
      args.push(`--since=${since}`);
    }

    const { stdout } = await execa("git", args, {
      cwd: repoDir,
      reject: false,
    });

    return parseGitLog(stdout);
  } catch {
    return [];
  }
}

/**
 * Parse git log output into structured format
 */
function parseGitLog(output: string): GitCommit[] {
  const commits: GitCommit[] = [];
  const lines = output.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    const parts = line.split("|");
    if (parts.length >= 4) {
      commits.push({
        sha: parts[0],
        author: parts[1],
        date: parts[2],
        message: parts.slice(3).join("|"), // Handle | in commit messages
      });
    }
  }

  return commits;
}

/**
 * Get git diff for a specific commit
 */
export async function getGitDiff(
  repoDir: string,
  sha: string
): Promise<string> {
  try {
    const { stdout } = await execa("git", ["show", sha, "--stat"], {
      cwd: repoDir,
      reject: false,
    });
    return stdout;
  } catch {
    return "";
  }
}

/**
 * Collect all context for agent analysis
 */
export async function collectContext(
  projectDir: string,
  options: {
    logTail?: number;
    commitLimit?: number;
    service?: string;
  } = {}
): Promise<CollectedContext> {
  const { logTail = 100, commitLimit = 10, service } = options;

  // Collect in parallel
  const [logs, commits] = await Promise.all([
    collectDockerLogs(projectDir, { tail: logTail, service }),
    collectGitCommits(projectDir, { limit: commitLimit }),
  ]);

  // Generate summary
  const errorLogs = logs.filter(
    (l) =>
      l.message.toLowerCase().includes("error") ||
      l.message.toLowerCase().includes("exception") ||
      l.message.toLowerCase().includes("failed")
  );

  const summary = [
    `Collected ${logs.length} log entries from Docker containers.`,
    errorLogs.length > 0
      ? `Found ${errorLogs.length} entries containing errors/exceptions.`
      : "No obvious errors found in logs.",
    `Collected ${commits.length} recent git commits.`,
  ].join(" ");

  return { logs, commits, summary };
}

/**
 * Format context for LLM prompt
 */
export function formatContextForPrompt(context: CollectedContext): string {
  const sections: string[] = [];

  // Recent logs section
  if (context.logs.length > 0) {
    const logLines = context.logs
      .slice(-50) // Last 50 entries
      .map((l) => `[${l.service}] ${l.message}`)
      .join("\n");

    sections.push(`## Recent Logs\n\`\`\`\n${logLines}\n\`\`\``);
  }

  // Recent commits section
  if (context.commits.length > 0) {
    const commitLines = context.commits
      .map((c) => `- ${c.sha.slice(0, 7)} (${c.author}): ${c.message}`)
      .join("\n");

    sections.push(`## Recent Commits\n${commitLines}`);
  }

  return sections.join("\n\n");
}

// --- Phase 5: Enhanced Collectors for Knowledge Base ---

export interface TimelineEvent {
  timestamp: string;
  source: string;
  event: string;
  severity: "info" | "warning" | "error" | "critical";
  details?: string;
}

/**
 * Collect container metrics as an IncidentSource
 */
export async function collectContainerMetrics(
  projectName: string
): Promise<IncidentSource> {
  try {
    const { stdout } = await execa("docker", [
      "stats", "--no-stream", "--no-trunc",
      "--format", "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.PIDs}}",
    ], { stdio: "pipe", timeout: 10000 });

    const containers = stdout.split("\n").filter(Boolean).map((line) => {
      const [name, cpu, mem, memPct, net, pids] = line.split("\t");
      return { name, cpu, mem, memPct, net, pids };
    }).filter((c) => c.name.includes(projectName));

    return {
      type: "metrics",
      summary: `Container metrics for ${containers.length} services`,
      data: { containers },
    };
  } catch {
    return {
      type: "metrics",
      summary: "Failed to collect container metrics",
      data: { error: "Docker stats unavailable" },
    };
  }
}

/**
 * Collect Kubernetes events
 */
export async function collectKubernetesEvents(
  namespace: string
): Promise<IncidentSource> {
  try {
    const { stdout } = await execa("kubectl", [
      "get", "events",
      "-n", namespace,
      "--sort-by=.lastTimestamp",
      "-o", "json",
    ], { stdio: "pipe", timeout: 15000 });

    const events = JSON.parse(stdout);
    const items = (events.items || []).map((e: any) => ({
      type: e.type,
      reason: e.reason,
      message: e.message,
      object: `${e.involvedObject.kind}/${e.involvedObject.name}`,
      timestamp: e.lastTimestamp || e.eventTime,
      count: e.count,
    }));

    const warnings = items.filter((e: any) => e.type === "Warning");

    return {
      type: "kubernetes",
      summary: `${items.length} events (${warnings.length} warnings) in namespace ${namespace}`,
      data: { events: items.slice(-30), warnings: warnings.slice(-10) },
    };
  } catch {
    return {
      type: "kubernetes",
      summary: "Kubernetes events unavailable",
      data: { error: "kubectl unavailable" },
    };
  }
}

/**
 * Collect pod status from Kubernetes
 */
export async function collectPodStatus(
  namespace: string
): Promise<IncidentSource> {
  try {
    const { stdout } = await execa("kubectl", [
      "get", "pods",
      "-n", namespace,
      "-o", "json",
    ], { stdio: "pipe", timeout: 15000 });

    const pods = JSON.parse(stdout);
    const podStatuses = (pods.items || []).map((p: any) => ({
      name: p.metadata.name,
      phase: p.status.phase,
      ready: p.status.conditions?.find((c: any) => c.type === "Ready")?.status === "True",
      restarts: p.status.containerStatuses?.reduce((sum: number, c: any) => sum + (c.restartCount || 0), 0) || 0,
    }));

    const unhealthy = podStatuses.filter((p: any) => !p.ready || p.phase !== "Running");

    return {
      type: "kubernetes",
      summary: `${podStatuses.length} pods (${unhealthy.length} unhealthy)`,
      data: { pods: podStatuses, unhealthy },
    };
  } catch {
    return {
      type: "kubernetes",
      summary: "Pod status unavailable",
      data: { error: "kubectl unavailable" },
    };
  }
}

/**
 * Collect chaos test results
 */
export async function collectChaosResults(
  projectDir: string
): Promise<IncidentSource> {
  const chaosDir = path.join(projectDir, ".blissful-infra", "chaos");

  try {
    const files = await fs.readdir(chaosDir);
    const jsonFiles = files.filter((f) => f.endsWith(".json")).sort().reverse();

    if (jsonFiles.length === 0) {
      return { type: "chaos", summary: "No chaos test results found", data: {} };
    }

    const latest = JSON.parse(await fs.readFile(path.join(chaosDir, jsonFiles[0]), "utf8"));

    return {
      type: "chaos",
      summary: `Latest chaos test: score ${latest.score}/${latest.maxScore}, ${latest.results?.filter((r: any) => !r.passed).length || 0} failures`,
      data: { score: latest.score, maxScore: latest.maxScore, results: latest.results, recommendations: latest.recommendations },
    };
  } catch {
    return { type: "chaos", summary: "No chaos test results available", data: {} };
  }
}

/**
 * Collect performance test results
 */
export async function collectPerfResults(
  projectDir: string
): Promise<IncidentSource> {
  const perfDir = path.join(projectDir, ".blissful-infra", "perf");

  try {
    const files = await fs.readdir(perfDir);
    const jsonFiles = files.filter((f) => f.endsWith(".json")).sort().reverse();

    if (jsonFiles.length === 0) {
      return { type: "perf", summary: "No performance test results found", data: {} };
    }

    const latest = JSON.parse(await fs.readFile(path.join(perfDir, jsonFiles[0]), "utf8"));

    return {
      type: "perf",
      summary: `Latest perf test: ${latest.requests?.total || 0} requests, p95=${latest.latency?.p95?.toFixed(1) || "?"}ms`,
      data: latest,
    };
  } catch {
    return { type: "perf", summary: "No performance test results available", data: {} };
  }
}

/**
 * Collect all context for deep analysis (knowledge base + agent)
 */
export async function collectFullContext(
  projectDir: string,
  projectName: string,
  options: { includeK8s?: boolean; namespace?: string } = {}
): Promise<{
  sources: IncidentSource[];
  timeline: TimelineEvent[];
  context: CollectedContext;
}> {
  // Base context (logs + git)
  const context = await collectContext(projectDir);

  const sources: IncidentSource[] = [];
  const timeline: TimelineEvent[] = [];

  // Convert base context to incident sources
  const errorLogs = context.logs.filter((l) =>
    /error|exception|fatal|panic|fail/i.test(l.message)
  );

  sources.push({
    type: "logs",
    summary: `${context.logs.length} log lines (${errorLogs.length} errors)`,
    data: { totalLines: context.logs.length, errorLines: errorLogs.map((l) => `[${l.service}] ${l.message}`).slice(-20) },
  });

  sources.push({
    type: "git",
    summary: `${context.commits.length} recent commits`,
    data: { commits: context.commits },
  });

  // Collect additional sources in parallel
  const [metrics, chaos, perf] = await Promise.all([
    collectContainerMetrics(projectName),
    collectChaosResults(projectDir),
    collectPerfResults(projectDir),
  ]);

  sources.push(metrics, chaos, perf);

  // K8s sources if available
  if (options.includeK8s && options.namespace) {
    const [events, pods] = await Promise.all([
      collectKubernetesEvents(options.namespace),
      collectPodStatus(options.namespace),
    ]);
    sources.push(events, pods);
  }

  // Build timeline from git commits
  for (const commit of context.commits) {
    timeline.push({
      timestamp: commit.date,
      source: "git",
      event: `Commit: ${commit.message}`,
      severity: "info",
      details: `${commit.sha.slice(0, 7)} by ${commit.author}`,
    });
  }

  // Add error log entries to timeline
  for (const log of errorLogs.slice(-10)) {
    timeline.push({
      timestamp: log.timestamp,
      source: "logs",
      event: `[${log.service}] ${log.message.slice(0, 200)}`,
      severity: "error",
    });
  }

  timeline.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return { sources, timeline, context };
}
