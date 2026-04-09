import path from "node:path";
import { execa } from "execa";
import type { ApiGenerateServer } from "@blissful-infra/shared";

export async function generateSpringServer(
  specPath: string,
  config: ApiGenerateServer,
  projectDir: string,
  dryRun = false
): Promise<void> {
  const absSpec = path.resolve(projectDir, specPath);
  const absOut = path.resolve(projectDir, config.output);

  const pkg = config.package ?? "com.example.api";
  const additionalProps = [
    "interfaceOnly=true",
    "library=spring-boot",
    "useSpringBoot3=true",
    "useTags=true",
    `apiPackage=${pkg}.api`,
    `modelPackage=${pkg}.model`,
  ].join(",");

  const args = [
    "--yes",
    "@openapitools/openapi-generator-cli",
    "generate",
    "-g", "spring",
    "-i", absSpec,
    "-o", absOut,
    "--additional-properties", additionalProps,
    "--skip-validate-spec",
  ];

  if (dryRun) {
    console.log(`  [dry-run] spring server: ${specPath} → ${config.output}/`);
    console.log(`            package: ${pkg}`);
    return;
  }

  await execa("npx", args, { cwd: projectDir, stdio: "inherit" });
}
