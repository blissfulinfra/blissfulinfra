import { Command } from "commander";
import chalk from "chalk";
import chokidar from "chokidar";
import path from "node:path";
import { loadConfig, findProjectDir } from "../utils/config.js";
import { runCodegen } from "../codegen/index.js";

interface GenerateOptions {
  dryRun?: boolean;
  watch?: boolean;
}

async function runGenerate(name: string | undefined, opts: GenerateOptions): Promise<void> {
  const projectDir = await findProjectDir(name);
  if (!projectDir) {
    if (name) {
      console.error(chalk.red(`Project '${name}' not found.`));
    } else {
      console.error(chalk.red("No blissful-infra.yaml found."));
      console.error(chalk.dim("Run from your project directory or specify a project name:"));
      console.error(chalk.cyan("  blissful-infra generate my-app"));
    }
    process.exit(1);
  }

  const config = await loadConfig(projectDir);
  if (!config) {
    console.error(chalk.red("No blissful-infra.yaml found."));
    process.exit(1);
  }

  if (!config.api) {
    console.error(chalk.red("No api: block found in blissful-infra.yaml"));
    console.error();
    console.error(chalk.dim("Add an api block to enable code generation:"));
    console.error(chalk.cyan("  api:"));
    console.error(chalk.cyan("    spec: ./openapi.yaml"));
    console.error(chalk.cyan("    generate:"));
    console.error(chalk.cyan("      client:"));
    console.error(chalk.cyan("        language: typescript"));
    console.error(chalk.cyan("        output: ./frontend/src/api"));
    process.exit(1);
  }

  try {
    await runCodegen(config, projectDir, { dryRun: opts.dryRun });
    if (!opts.dryRun) {
      console.log(chalk.green("\nDone. Re-run after changing your OpenAPI spec."));
    }
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
}

export const generateCommand = new Command("generate")
  .description("Generate client and server boilerplate from the OpenAPI spec in blissful-infra.yaml")
  .argument("[name]", "project name (defaults to current directory)")
  .option("--dry-run", "show what would be generated without writing files")
  .option("--watch", "re-generate on spec file changes")
  .action(async (name: string | undefined, opts: GenerateOptions) => {
    await runGenerate(name, opts);

    if (opts.watch) {
      const projectDir = await findProjectDir(name);
      if (!projectDir) return;
      const config = await loadConfig(projectDir);
      if (!config?.api?.spec) return;

      const specPath = path.resolve(projectDir, config.api.spec);
      console.log(chalk.dim(`\nWatching ${config.api.spec} for changes...`));

      chokidar.watch(specPath).on("change", async () => {
        console.log(chalk.cyan(`\n↺ Spec changed — regenerating...`));
        try {
          await runCodegen(config, projectDir, { dryRun: false });
          console.log(chalk.green("Done."));
        } catch (err) {
          console.error(chalk.red((err as Error).message));
        }
      });
    }
  });
