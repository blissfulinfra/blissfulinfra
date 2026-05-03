import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { findProjectDir } from "../utils/config.js";
import { toExecError } from "../utils/errors.js";
import { getClientDir, getClientPortBlock } from "../utils/client-registry.js";

export async function downAction(name?: string, opts: { volumes?: boolean } = {}): Promise<void> {
  // If `name` is a known client, route to the client-model down flow.
  if (name) {
    const block = await getClientPortBlock(name);
    if (block) {
      const clientDir = getClientDir(name);
      const args = ["compose", "-f", "docker-compose.infra.yaml", "down"];
      if (opts.volumes) args.push("-v");
      await execa("docker", args, { cwd: clientDir, stdio: "inherit" });
      console.log(chalk.green(`${name} is stopped`));
      return;
    }
  }

  // Otherwise fall back to the flat-model layout
  const projectDir = await findProjectDir(name);
  if (!projectDir) {
    console.error(chalk.red(name ? `'${name}' not found.` : "No blissful-infra.yaml found."));
    process.exit(1);
  }

  // Check for docker-compose.yaml
  const composeFile = path.join(projectDir, "docker-compose.yaml");
  try {
    await fs.access(composeFile);
  } catch {
    console.log(chalk.yellow("No docker-compose.yaml found. Nothing to stop."));
    return;
  }

  const spinner = ora("Stopping environment...").start();

  try {
    const args = ["compose", "down"];
    if (opts.volumes) {
      args.push("-v");
    }

    await execa("docker", args, { cwd: projectDir, stdio: "pipe" });

    if (opts.volumes) {
      spinner.succeed("Environment stopped and volumes removed");
    } else {
      spinner.succeed("Environment stopped");
      console.log(chalk.dim("  Run with --volumes to also remove data volumes"));
    }
  } catch (error) {
    spinner.fail("Failed to stop environment");
    const execaError = toExecError(error);
    if (execaError.stderr?.includes("Cannot connect to the Docker daemon")) {
      console.error(chalk.red("Docker is not running."));
      console.error(chalk.dim("Please start Docker and try again."));
    } else if (execaError.stderr) {
      console.error(chalk.red(execaError.stderr));
    }
    process.exit(1);
  }
}

export const downCommand = new Command("down")
  .description("Stop the local development environment")
  .argument("[name]", "Project name (if running from parent directory)")
  .option("-v, --volumes", "Also remove volumes", false)
  .action(async (name: string | undefined, opts: { volumes: boolean }) => {
    await downAction(name, opts);
  });
