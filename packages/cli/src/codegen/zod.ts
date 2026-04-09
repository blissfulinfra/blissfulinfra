import fs from "node:fs/promises";
import path from "node:path";
import { generateZodClientFromOpenAPI } from "openapi-zod-client";
import type { ApiGenerateTypes } from "@blissful-infra/shared";

export async function generateZodSchemas(
  specPath: string,
  config: ApiGenerateTypes,
  projectDir: string,
  dryRun = false
): Promise<void> {
  const absSpec = path.resolve(projectDir, specPath);
  const absOut = path.resolve(projectDir, config.output);

  if (dryRun) {
    console.log(`  [dry-run] zod schemas: ${specPath} → ${config.output}`);
    return;
  }

  // openapi-zod-client requires a parsed document object, not a file path
  const { parse } = await import("yaml");
  const raw = await fs.readFile(absSpec, "utf8");
  const openApiDoc = parse(raw);

  await generateZodClientFromOpenAPI({
    openApiDoc,
    distPath: absOut,
    options: { withDescription: false, withImplicitRequiredProps: true },
  });
}
