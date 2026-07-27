import { execa } from "execa";
import chalk from "chalk";
import { toExecError } from "./errors.js";

/**
 * Argo Rollouts utilities for canary deployment management.
 */

export interface RolloutStatus {
  name: string;
  status: string;
  strategy: string;
  step: number;
  totalSteps: number;
  currentWeight: number;
  stableRevision: string;
  canaryRevision: string;
  analysisStatus?: string;
  message?: string;
}

export interface AnalysisResult {
  name: string;
  status: "Successful" | "Failed" | "Running" | "Pending";
  metrics: Array<{
    name: string;
    value: string;
    threshold: string;
    passed: boolean;
  }>;
}

function ctxArgs(context?: string): string[] {
  return context ? ["--context", context] : [];
}

async function checkKubectlPlugin(): Promise<boolean> {
  try {
    await execa("kubectl", ["argo", "rollouts", "version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export async function ensureRolloutsAvailable(): Promise<boolean> {
  const hasPlugin = await checkKubectlPlugin();
  if (!hasPlugin) {
    console.log(chalk.red("Error: kubectl argo rollouts plugin not found."));
    console.log(chalk.gray("Install with:"));
    console.log(chalk.gray("  brew install argoproj/tap/kubectl-argo-rollouts"));
    console.log(chalk.gray("  Or: curl -LO https://github.com/argoproj/argo-rollouts/releases/latest/download/kubectl-argo-rollouts-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)"));
    return false;
  }
  return true;
}

export async function getRolloutStatus(
  name: string,
  namespace: string,
  context?: string
): Promise<RolloutStatus | null> {
  try {
    const { stdout } = await execa("kubectl", [
      "argo", "rollouts", "get", "rollout", name,
      "-n", namespace,
      "--no-color",
      ...ctxArgs(context),
    ], { stdio: "pipe", timeout: 10000 });

    // Parse the `get rollout` header block
    const lines = stdout.split("\n");
    const status: RolloutStatus = {
      name,
      status: "Unknown",
      strategy: "canary",
      step: 0,
      totalSteps: 0,
      currentWeight: 0,
      stableRevision: "",
      canaryRevision: "",
    };

    for (const line of lines) {
      if (line.includes("Status:")) {
        status.status = (line.split("Status:")[1]?.trim() || "Unknown").replace(/^[^A-Za-z]+/, "");
      }
      if (line.includes("Step:")) {
        const stepMatch = line.match(/Step:\s*(\d+)\/(\d+)/);
        if (stepMatch) {
          status.step = parseInt(stepMatch[1], 10);
          status.totalSteps = parseInt(stepMatch[2], 10);
        }
      }
      if (line.includes("ActualWeight:") || line.includes("Weight:")) {
        const weightMatch = line.match(/(?:Actual)?Weight:\s*(\d+)/);
        if (weightMatch) {
          status.currentWeight = parseInt(weightMatch[1], 10);
        }
      }
      if (line.includes("Message:")) {
        status.message = line.split("Message:")[1]?.trim();
      }
    }

    return status;
  } catch {
    return null;
  }
}

export async function getRolloutDetails(
  name: string,
  namespace: string,
  context?: string
): Promise<string> {
  try {
    const { stdout } = await execa("kubectl", [
      "argo", "rollouts", "get", "rollout", name,
      "-n", namespace,
      "--no-color",
      ...ctxArgs(context),
    ], { stdio: "pipe", timeout: 10000 });
    return stdout;
  } catch (error) {
    const err = toExecError(error);
    return err.stderr || "Failed to get rollout details";
  }
}

export async function promoteRollout(
  name: string,
  namespace: string,
  full: boolean = false,
  context?: string
): Promise<boolean> {
  try {
    const args = ["argo", "rollouts", "promote", name, "-n", namespace, ...ctxArgs(context)];
    if (full) args.push("--full");

    await execa("kubectl", args, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export async function abortRollout(
  name: string,
  namespace: string,
  context?: string
): Promise<boolean> {
  try {
    await execa("kubectl", [
      "argo", "rollouts", "abort", name,
      "-n", namespace,
      ...ctxArgs(context),
    ], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export async function retryRollout(
  name: string,
  namespace: string,
  context?: string
): Promise<boolean> {
  try {
    await execa("kubectl", [
      "argo", "rollouts", "retry", "rollout", name,
      "-n", namespace,
      ...ctxArgs(context),
    ], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export async function pauseRollout(
  name: string,
  namespace: string,
  context?: string
): Promise<boolean> {
  try {
    await execa("kubectl", [
      "argo", "rollouts", "pause", name,
      "-n", namespace,
      ...ctxArgs(context),
    ], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export async function resumeRollout(
  name: string,
  namespace: string,
  context?: string
): Promise<boolean> {
  try {
    await execa("kubectl", [
      "argo", "rollouts", "promote", name,
      "-n", namespace,
      ...ctxArgs(context),
    ], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export async function setRolloutImage(
  name: string,
  namespace: string,
  container: string,
  image: string,
  context?: string
): Promise<boolean> {
  try {
    await execa("kubectl", [
      "argo", "rollouts", "set", "image", name,
      `${container}=${image}`,
      "-n", namespace,
      ...ctxArgs(context),
    ], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export async function undoRollout(
  name: string,
  namespace: string,
  revision?: string,
  context?: string
): Promise<boolean> {
  try {
    const args = ["argo", "rollouts", "undo", name, "-n", namespace, ...ctxArgs(context)];
    if (revision) args.push("--to-revision", revision);

    await execa("kubectl", args, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export async function getRolloutHistory(
  name: string,
  namespace: string,
  context?: string
): Promise<string> {
  try {
    const { stdout } = await execa("kubectl", [
      "argo", "rollouts", "get", "rollout", name,
      "-n", namespace,
      "--no-color",
      ...ctxArgs(context),
    ], { stdio: "pipe", timeout: 10000 });
    return stdout;
  } catch {
    return "";
  }
}
