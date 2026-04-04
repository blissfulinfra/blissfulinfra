import chalk from "chalk";
import ora from "ora";
import path from "node:path";
import { execa } from "execa";
import { type ProjectConfig } from "@blissful-infra/shared";
import { PrereqMissingError, DeployFailedError } from "./errors.js";
import { type DeployOptions } from "./index.js";

async function checkVercelAvailable(): Promise<string> {
  try {
    const { stdout } = await execa("vercel", ["--version"], { stdio: "pipe" });
    return stdout.trim();
  } catch {
    throw new PrereqMissingError(
      "vercel",
      "Install with: npm install -g vercel\nDocs: https://vercel.com/docs/cli"
    );
  }
}

export async function deploy(
  config: ProjectConfig,
  projectDir: string,
  opts: DeployOptions
): Promise<void> {
  const { dryRun = false } = opts;

  console.log();
  console.log(
    chalk.bold("Deploying to Vercel") + (dryRun ? chalk.yellow(" [dry run]") : "")
  );
  console.log();

  const vercelVersion = await checkVercelAvailable();
  console.log(chalk.dim(`✓ vercel ${vercelVersion}`));

  if (dryRun) {
    console.log();
    if (config.frontend) {
      const frontendDir = path.join(projectDir, "frontend");
      console.log(chalk.dim(`[dry-run] Would run: vercel build`), chalk.dim(`(${frontendDir})`));
      console.log(chalk.dim(`[dry-run] Would run: vercel deploy --prebuilt --prod`));
    }
    if (config.backend) {
      const backendDir = path.join(projectDir, "backend");
      console.log(chalk.dim(`[dry-run] Would run: vercel deploy --prod`), chalk.dim(`(${backendDir})`));
    }
    console.log();
    console.log(chalk.yellow("Dry run complete — no changes were made."));
    return;
  }

  // Full Vercel deploy: build then deploy prebuilt output
  if (config.frontend) {
    const frontendDir = path.join(projectDir, "frontend");
    const buildSpinner = ora("Building frontend...").start();
    try {
      await execa("vercel", ["build", "--prod"], { cwd: frontendDir, stdio: "pipe" });
      buildSpinner.succeed("Frontend built");
    } catch (err) {
      buildSpinner.fail("Frontend build failed");
      const e = err as { stderr?: string; message?: string; exitCode?: number };
      throw new DeployFailedError(
        `Vercel build failed: ${e.stderr || e.message}`,
        e.exitCode,
        e.stderr
      );
    }

    const deploySpinner = ora("Deploying frontend to Vercel...").start();
    try {
      const { stdout } = await execa(
        "vercel",
        ["deploy", "--prebuilt", "--prod"],
        { cwd: frontendDir, stdio: "pipe" }
      );
      const url = stdout.trim().split("\n").pop() ?? "";
      deploySpinner.succeed(`Frontend deployed → ${chalk.cyan(url)}`);
    } catch (err) {
      deploySpinner.fail("Frontend deploy failed");
      const e = err as { stderr?: string; message?: string; exitCode?: number };
      throw new DeployFailedError(
        `Vercel deploy failed: ${e.stderr || e.message}`,
        e.exitCode,
        e.stderr
      );
    }
  }

  if (config.backend) {
    const backendDir = path.join(projectDir, "backend");
    const spinner = ora("Deploying backend to Vercel...").start();
    try {
      const { stdout } = await execa(
        "vercel",
        ["deploy", "--prod"],
        { cwd: backendDir, stdio: "pipe" }
      );
      const url = stdout.trim().split("\n").pop() ?? "";
      spinner.succeed(`Backend deployed → ${chalk.cyan(url)}`);
    } catch (err) {
      spinner.fail("Backend deploy failed");
      const e = err as { stderr?: string; message?: string; exitCode?: number };
      throw new DeployFailedError(
        `Vercel backend deploy failed: ${e.stderr || e.message}`,
        e.exitCode,
        e.stderr
      );
    }
  }

  console.log();
  console.log(chalk.green.bold("Deployment complete"));
  console.log();
  console.log(
    chalk.dim(
      "Note: For Vercel Postgres, Redis (Upstash), and Queues (QStash), configure environment variables in your Vercel project dashboard."
    )
  );
}
