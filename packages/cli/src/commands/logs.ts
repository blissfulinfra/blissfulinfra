import { Command } from "commander";
import chalk from "chalk";
import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { findProjectDir } from "../utils/config.js";
import { getClientDir, getClientPortBlock } from "../utils/client-registry.js";

export async function logsAction(name?: string, opts: { follow?: boolean; lines?: string; service?: string } = {}): Promise<void> {
  // If `name` is a known client, route to the client-model logs flow
  // (tail across the whole client compose project).
  if (name) {
    const block = await getClientPortBlock(name);
    if (block) {
      const clientDir = getClientDir(name);
      const tail = opts.lines || "100";
      const args = ["compose", "-f", "docker-compose.infra.yaml", "logs", `--tail=${tail}`];
      if (opts.follow) args.push("-f");
      if (opts.service) args.push(opts.service);
      await execa("docker", args, { cwd: clientDir, stdio: "inherit" });
      return;
    }
  }

  // Otherwise fall back to the flat-model layout
  const projectDir = await findProjectDir(name);
  if (!projectDir) {
    console.error(chalk.red(name ? `'${name}' not found.` : "No blissful-infra.yaml found."));
    process.exit(1);
  }

  const composeFile = path.join(projectDir, "docker-compose.yaml");
  try {
    await fs.access(composeFile);
  } catch {
    console.error(chalk.red("No docker-compose.yaml found."));
    console.error(chalk.dim("Run"), chalk.cyan("blissful-infra up"), chalk.dim("first."));
    process.exit(1);
  }

  const tail = opts.lines || "100";
  const args = ["compose", "logs", `--tail=${tail}`];

  if (opts.follow) {
    args.push("-f");
  }

  if (opts.service) {
    args.push(opts.service);
  }

  try {
    await execa("docker", args, { cwd: projectDir, stdio: "inherit" });
  } catch (error) {
    const execaError = error as { signal?: string };
    if (execaError.signal !== "SIGINT") {
      throw error;
    }
  }
}

export const logsCommand = new Command("logs")
  .description("View logs from the local environment")
  .argument("[name]", "Project name (if running from parent directory)")
  .option("-f, --follow", "Follow log output", false)
  .option("-n, --tail <lines>", "Number of lines to show", "100")
  .option("-s, --service <name>", "Show logs for specific service")
  .action(async (name: string | undefined, opts: { follow: boolean; tail: string; service?: string }) => {
    await logsAction(name, { follow: opts.follow, lines: opts.tail, service: opts.service });
  });
