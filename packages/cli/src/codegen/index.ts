import path from "node:path";
import fs from "node:fs/promises";
import ora from "ora";
import type { ProjectConfig } from "@blissful-infra/shared";
import { generateTypescriptClient } from "./typescript.js";
import { generateSpringServer } from "./spring.js";
import { generateZodSchemas } from "./zod.js";

export interface CodegenOptions {
  dryRun?: boolean;
}

export async function runCodegen(
  config: ProjectConfig,
  projectDir: string,
  opts: CodegenOptions = {}
): Promise<void> {
  const { dryRun = false } = opts;

  if (!config.api) {
    throw new Error("No api: block found in blissful-infra.yaml");
  }

  const { spec, generate } = config.api;

  // Verify spec file exists
  const absSpec = path.resolve(projectDir, spec);
  try {
    await fs.access(absSpec);
  } catch {
    throw new Error(`API spec not found: ${spec} (resolved to ${absSpec})`);
  }

  if (!generate) {
    console.log(`Spec loaded: ${spec} — no generate: block configured, nothing to do.`);
    return;
  }

  if (generate.client) {
    const spinner = ora(`Generating TypeScript client → ${generate.client.output}`).start();
    try {
      await generateTypescriptClient(spec, generate.client, projectDir, dryRun);
      spinner.succeed(`TypeScript client → ${generate.client.output}`);
    } catch (err) {
      spinner.fail(`TypeScript client failed`);
      throw err;
    }
  }

  if (generate.server) {
    const spinner = ora(`Generating ${generate.server.framework} server stubs → ${generate.server.output}`).start();
    try {
      await generateSpringServer(spec, generate.server, projectDir, dryRun);
      spinner.succeed(`${generate.server.framework} server stubs → ${generate.server.output}`);
    } catch (err) {
      spinner.fail(`Server stubs failed`);
      throw err;
    }
  }

  if (generate.types) {
    const label = generate.types.runtime === "zod" ? "Zod schemas" : "TypeScript types";
    const spinner = ora(`Generating ${label} → ${generate.types.output}`).start();
    try {
      await generateZodSchemas(spec, generate.types, projectDir, dryRun);
      spinner.succeed(`${label} → ${generate.types.output}`);
    } catch (err) {
      spinner.fail(`${label} generation failed`);
      throw err;
    }
  }
}
