import { Command } from "commander";
import chalk from "chalk";
import {
  readContext,
  writeContext,
  clearContext,
  parseTarget,
} from "../utils/context.js";
import { getTenant, getProject } from "../utils/tenant-registry.js";

/**
 * `blissful-infra use [target]`
 *   - no args: print the current context
 *   - --clear: drop the context entirely
 *   - "acme": set tenant=acme, clear project
 *   - "acme/ecommerce": set tenant=acme, project=ecommerce
 *
 * Other commands read this context when their positional args are missing.
 * Per ADR-0017-followup; modeled after kubectl context / sdk use.
 */
export const useCommand = new Command("use")
  .description("Set or show the current tenant/project context")
  .argument("[target]", "Target — `<tenant>` or `<tenant>/<project>`. Omit to show current context.")
  .option("--clear", "Clear the current context")
  .action(async (target: string | undefined, opts: { clear?: boolean }) => {
    if (opts.clear) {
      await clearContext();
      console.log(chalk.green("✓ Context cleared."));
      return;
    }

    if (!target) {
      const ctx = await readContext();
      if (!ctx.tenant && !ctx.project) {
        console.log(chalk.dim("No context set."));
        console.log(chalk.dim("Set one with:"));
        console.log(chalk.cyan("  blissful-infra use <tenant>"));
        console.log(chalk.cyan("  blissful-infra use <tenant>/<project>"));
        return;
      }
      console.log();
      console.log(chalk.bold("Current context:"));
      console.log(chalk.dim("  tenant  ") + chalk.cyan(ctx.tenant ?? "(unset)"));
      console.log(chalk.dim("  project ") + chalk.cyan(ctx.project ?? "(unset)"));
      console.log();
      return;
    }

    let parsed;
    try {
      parsed = parseTarget(target);
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }

    // Verify the target actually exists in the registry. Saves the user from
    // a silent typo that surfaces only when the next command can't find the
    // tenant/project.
    if (parsed.tenant) {
      const t = await getTenant(parsed.tenant);
      if (!t) {
        console.error(chalk.red(`Tenant '${parsed.tenant}' is not in the registry.`));
        console.error(chalk.dim("Create it first:"));
        console.error(chalk.cyan(`  blissful-infra tenant create ${parsed.tenant}`));
        process.exit(1);
      }
    }
    if (parsed.tenant && parsed.project) {
      const p = await getProject(parsed.tenant, parsed.project);
      if (!p) {
        console.error(chalk.red(`Project '${parsed.project}' not found in tenant '${parsed.tenant}'.`));
        console.error(chalk.dim("Create it first:"));
        console.error(chalk.cyan(`  blissful-infra project create ${parsed.tenant} ${parsed.project}`));
        process.exit(1);
      }
    }

    await writeContext(parsed);
    console.log();
    console.log(chalk.green("✓ Context set."));
    console.log(chalk.dim("  tenant  ") + chalk.cyan(parsed.tenant ?? "(unset)"));
    console.log(chalk.dim("  project ") + chalk.cyan(parsed.project ?? "(unset)"));
    console.log();
    console.log(chalk.dim("Other commands now fill missing args from this context."));
    console.log(chalk.dim("  blissful-infra service add my-api --type backend") + chalk.dim("    # uses context"));
    console.log();
  });
