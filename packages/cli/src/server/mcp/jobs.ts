/**
 * Job registry for long-running MCP tools.
 *
 * `cluster up` runs terraform against a fresh kind cluster and takes minutes;
 * `deploy` builds an image, loads it into the cluster and waits on ArgoCD.
 * Both exceed the request timeout of a typical MCP client, so the tools that
 * drive them start a job and return immediately. The agent polls get_job.
 *
 * Jobs live in memory for the life of the MCP process, which is the same
 * lifetime as the client session that spawned it.
 */

import { execa, type ResultPromise } from "execa";
import { randomUUID } from "node:crypto";

export type JobStatus = "running" | "succeeded" | "failed";

export interface Job {
  id: string;
  label: string;
  command: string;
  status: JobStatus;
  startedAt: number;
  completedAt?: number;
  exitCode?: number;
  output: string[];
}

const MAX_OUTPUT_LINES = 500;
const jobs = new Map<string, Job>();
const running = new Map<string, ResultPromise>();

function append(job: Job, chunk: string): void {
  for (const line of chunk.split("\n")) {
    if (!line.trim()) continue;
    job.output.push(line);
  }
  // Keep the tail — the head of a terraform log is rarely the interesting part.
  if (job.output.length > MAX_OUTPUT_LINES) {
    job.output.splice(0, job.output.length - MAX_OUTPUT_LINES);
  }
}

/**
 * Spawn a CLI subprocess and track it as a job.
 *
 * Subprocess rather than an in-process call on purpose: the command actions
 * print to stdout via chalk/ora, and this process's stdout IS the MCP JSON-RPC
 * stream. Anything written there would corrupt the protocol.
 */
export function startJob(label: string, args: string[], cliPath: string): Job {
  const job: Job = {
    id: randomUUID().slice(0, 8),
    label,
    command: `blissful-infra ${args.join(" ")}`,
    status: "running",
    startedAt: Date.now(),
    output: [],
  };
  jobs.set(job.id, job);

  const child = execa("node", [cliPath, ...args], {
    all: true,
    reject: false,
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  running.set(job.id, child);

  child.all?.on("data", (buf: Buffer) => append(job, buf.toString()));

  child.then(
    result => {
      job.status = result.exitCode === 0 ? "succeeded" : "failed";
      job.exitCode = result.exitCode ?? undefined;
      job.completedAt = Date.now();
      running.delete(job.id);
    },
    (err: unknown) => {
      job.status = "failed";
      job.completedAt = Date.now();
      append(job, err instanceof Error ? err.message : String(err));
      running.delete(job.id);
    },
  );

  return job;
}

/**
 * Run a CLI subprocess to completion and return its combined output. For
 * commands that finish in seconds (service up, canary promote) — the agent
 * gets the result in one call instead of having to poll.
 */
export async function runCli(
  args: string[],
  cliPath: string,
  timeoutMs = 120_000,
): Promise<{ ok: boolean; output: string; exitCode: number }> {
  const result = await execa("node", [cliPath, ...args], {
    all: true,
    reject: false,
    timeout: timeoutMs,
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  return {
    ok: result.exitCode === 0,
    output: (result.all ?? "").trim(),
    exitCode: result.exitCode ?? 1,
  };
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
}

export function cancelJob(id: string): boolean {
  const child = running.get(id);
  if (!child) return false;
  child.kill("SIGTERM");
  return true;
}

/** Trim a job for tool output: the full line buffer is usually noise. */
export function summarizeJob(job: Job, tailLines = 40): Record<string, unknown> {
  return {
    jobId: job.id,
    label: job.label,
    command: job.command,
    status: job.status,
    exitCode: job.exitCode,
    elapsedSeconds: Math.round(((job.completedAt ?? Date.now()) - job.startedAt) / 1000),
    outputTail: job.output.slice(-tailLines),
    truncated: job.output.length > tailLines,
  };
}
