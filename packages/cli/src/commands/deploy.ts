import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, findProjectDir } from "../utils/config.js";
import { deployProject } from "../deploy/index.js";
import { DeployTargetError, PrereqMissingError, DeployFailedError } from "../deploy/errors.js";

interface DeployCommandOptions {
  dryRun?: boolean;
}

export async function deployAction(
  name: string | undefined,
  opts: DeployCommandOptions
): Promise<void> {
  const projectDir = await findProjectDir(name);
  if (!projectDir) {
    if (name) {
      console.error(chalk.red(`Project '${name}' not found.`));
    } else {
      console.error(chalk.red("No blissful-infra.yaml found."));
      console.error(chalk.dim("Run from your project directory or specify a project name:"));
      console.error(chalk.cyan("  blissful-infra deploy my-app"));
    }
    process.exit(1);
  }

  const config = await loadConfig(projectDir);
  if (!config) {
    console.error(chalk.red("No blissful-infra.yaml found."));
    process.exit(1);
  }

  try {
    await deployProject(config, projectDir, { dryRun: opts.dryRun });
  } catch (err) {
    if (err instanceof DeployTargetError) {
      console.error(chalk.red(err.message));
      console.error();
      console.error(chalk.dim("Set deploy.target in blissful-infra.yaml:"));
      console.error(chalk.cyan("  deploy:"));
      console.error(chalk.cyan("    target: cloudflare  # or: vercel, aws"));
      process.exit(1);
    }

    if (err instanceof PrereqMissingError) {
      console.error(chalk.red(err.message));
      process.exit(1);
    }

    if (err instanceof DeployFailedError) {
      console.error(chalk.red(`Deploy failed: ${err.message}`));
      if (err.stderr) console.error(chalk.dim(err.stderr));
      process.exit(err.exitCode ?? 1);
    }

    throw err;
  }
}

export const deployCommand = new Command("deploy")
  .description("Deploy your project to Cloudflare, Vercel, or AWS")
  .argument("[name]", "Project name (if running from parent directory)")
  .option("--dry-run", "Show what would be deployed without making any changes")
  .action(async (name: string | undefined, opts: DeployCommandOptions) => {
    await deployAction(name, opts);
  });
