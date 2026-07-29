import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getJob, listJobs, runCli, startJob, summarizeJob } from "../jobs.js";

/**
 * The job registry shells out to `node <cliPath>`, so these tests point it at
 * throwaway scripts instead of the real CLI. That keeps them at L1 speed and
 * lets us assert on failure paths without breaking anything.
 */

async function scriptFile(body: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "blissful-jobs-"));
  const file = path.join(dir, "fake-cli.js");
  await fs.writeFile(file, body);
  return file;
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error("timed out waiting for job to settle");
}

describe("runCli", () => {
  it("reports success with combined output", async () => {
    const cli = await scriptFile(`console.log("scaffolded"); console.error("a warning");`);
    const result = await runCli(["ignored"], cli);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("scaffolded");
    expect(result.output).toContain("a warning");
  });

  it("reports failure without throwing", async () => {
    const cli = await scriptFile(`console.error("boom"); process.exit(3);`);
    const result = await runCli([], cli);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.output).toContain("boom");
  });
});

describe("startJob", () => {
  it("returns immediately and settles to succeeded", async () => {
    const cli = await scriptFile(`console.log("step one"); console.log("step two");`);
    const job = startJob("scaffold", ["tenant", "create", "acme"], cli);

    expect(job.status).toBe("running");
    expect(job.command).toBe("blissful-infra tenant create acme");

    await waitFor(() => getJob(job.id)?.status !== "running");
    const settled = getJob(job.id)!;
    expect(settled.status).toBe("succeeded");
    expect(settled.exitCode).toBe(0);
    expect(settled.output).toEqual(["step one", "step two"]);
  });

  it("marks a nonzero exit as failed and keeps the output", async () => {
    const cli = await scriptFile(`console.error("terraform exploded"); process.exit(1);`);
    const job = startJob("cluster up", ["cluster", "up"], cli);

    await waitFor(() => getJob(job.id)?.status !== "running");
    const settled = getJob(job.id)!;
    expect(settled.status).toBe("failed");
    expect(settled.exitCode).toBe(1);
    expect(settled.output.join("\n")).toContain("terraform exploded");
  });

  it("keeps the tail when output exceeds the buffer", async () => {
    const cli = await scriptFile(`for (let i = 0; i < 700; i++) console.log("line " + i);`);
    const job = startJob("noisy", [], cli);

    await waitFor(() => getJob(job.id)?.status !== "running");
    const settled = getJob(job.id)!;
    expect(settled.output.length).toBe(500);
    expect(settled.output.at(-1)).toBe("line 699");
  });

  it("gives every job a distinct id and lists newest first", async () => {
    const cli = await scriptFile(`console.log("ok");`);
    const first = startJob("first", [], cli);
    const second = startJob("second", [], cli);

    expect(first.id).not.toBe(second.id);
    const ids = listJobs().map(j => j.id);
    expect(ids.indexOf(second.id)).toBeLessThanOrEqual(ids.indexOf(first.id));
  });
});

describe("summarizeJob", () => {
  it("truncates to the requested tail and flags it", async () => {
    const cli = await scriptFile(`for (let i = 0; i < 50; i++) console.log("l" + i);`);
    const job = startJob("tail", [], cli);
    await waitFor(() => getJob(job.id)?.status !== "running");

    const summary = summarizeJob(getJob(job.id)!, 5) as {
      outputTail: string[]; truncated: boolean; jobId: string;
    };
    expect(summary.outputTail).toHaveLength(5);
    expect(summary.outputTail.at(-1)).toBe("l49");
    expect(summary.truncated).toBe(true);
    expect(summary.jobId).toBe(job.id);
  });
});

describe("getJob", () => {
  it("returns undefined for an unknown id", () => {
    expect(getJob("does-not-exist")).toBeUndefined();
  });
});
