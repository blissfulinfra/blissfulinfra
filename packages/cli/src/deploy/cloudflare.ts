import chalk from "chalk";
import ora from "ora";
import path from "node:path";
import { execa } from "execa";
import { type ProjectConfig } from "@blissful-infra/shared";
import { PrereqMissingError, DeployFailedError } from "./errors.js";
import { type DeployOptions } from "./index.js";

async function checkWranglerAvailable(): Promise<string> {
  try {
    const { stdout } = await execa("wrangler", ["--version"], { stdio: "pipe" });
    return stdout.trim();
  } catch {
    throw new PrereqMissingError(
      "wrangler",
      "Install with: npm install -g wrangler\nDocs: https://developers.cloudflare.com/workers/wrangler/install-and-update/"
    );
  }
}

async function runWrangler(
  args: string[],
  cwd: string,
  label: string,
  dryRun: boolean
): Promise<string> {
  if (dryRun) {
    console.log(chalk.dim(`  [dry-run] wrangler ${args.join(" ")}`));
    return "";
  }
  try {
    const { stdout } = await execa("wrangler", args, { cwd, stdio: "pipe" });
    return stdout;
  } catch (err) {
    const e = err as { message?: string; stderr?: string; exitCode?: number };
    throw new DeployFailedError(
      `${label} failed: ${e.stderr || e.message || "unknown error"}`,
      e.exitCode,
      e.stderr
    );
  }
}

async function deployFrontend(
  config: ProjectConfig,
  projectDir: string,
  dryRun: boolean
): Promise<string | null> {
  if (!config.frontend) return null;

  const frontendDir = path.join(projectDir, "frontend");
  const spinner = ora("Building frontend...").start();

  if (dryRun) {
    spinner.info("[dry-run] Would run: vite build");
  } else {
    try {
      await execa("npm", ["run", "build"], { cwd: frontendDir, stdio: "pipe" });
      spinner.succeed("Frontend built");
    } catch (err) {
      spinner.fail("Frontend build failed");
      const e = err as { stderr?: string; message?: string };
      throw new DeployFailedError(
        `Frontend build failed: ${e.stderr || e.message}`,
        undefined,
        e.stderr
      );
    }
  }

  const pagesProject =
    config.deploy?.cloudflare?.pagesProject ?? `${config.name}-frontend`;

  spinner.start("Deploying frontend to Cloudflare Pages...");
  const out = await runWrangler(
    ["pages", "deploy", "dist", "--project-name", pagesProject],
    frontendDir,
    "Cloudflare Pages deploy",
    dryRun
  );

  const urlMatch = out.match(/https?:\/\/[^\s]+\.pages\.dev[^\s]*/);
  const url = urlMatch?.[0] ?? `https://${pagesProject}.pages.dev`;

  if (dryRun) {
    spinner.info(`[dry-run] Would deploy frontend to Cloudflare Pages → ${url}`);
  } else {
    spinner.succeed(`Frontend deployed → ${chalk.cyan(url)}`);
  }

  return url;
}

async function deployBackend(
  config: ProjectConfig,
  projectDir: string,
  dryRun: boolean
): Promise<string | null> {
  if (!config.backend) return null;

  const backendDir = path.join(projectDir, "backend");
  const workerName =
    config.deploy?.cloudflare?.workerName ?? `${config.name}-api`;

  const spinner = ora("Deploying backend to Cloudflare Workers...").start();
  const out = await runWrangler(
    ["deploy", "--name", workerName],
    backendDir,
    "Cloudflare Workers deploy",
    dryRun
  );

  const urlMatch = out.match(/https?:\/\/[^\s]+\.workers\.dev[^\s]*/);
  const url = urlMatch?.[0] ?? `https://${workerName}.workers.dev`;

  if (dryRun) {
    spinner.info(`[dry-run] Would deploy backend to Cloudflare Workers → ${url}`);
  } else {
    spinner.succeed(`Backend deployed → ${chalk.cyan(url)}`);
  }

  return url;
}

async function deployDatabase(
  config: ProjectConfig,
  projectDir: string,
  dryRun: boolean
): Promise<void> {
  const dbEngine = config.modules?.database?.engine ?? config.database ?? "none";
  if (dbEngine === "none") return;

  const dbName = `${config.name}-db`;
  const spinner = ora("Provisioning Cloudflare D1 database...").start();

  // Create D1 database (no-op if already exists — wrangler handles idempotency)
  await runWrangler(
    ["d1", "create", dbName, "--experimental-backend"],
    projectDir,
    "D1 create",
    dryRun
  );

  if (dryRun) {
    spinner.info(`[dry-run] Would provision D1 database "${dbName}" and run migrations`);
    return;
  }

  spinner.text = "Running D1 migrations...";

  // Apply any SQL migrations from backend/migrations/
  const migrationsDir = path.join(projectDir, "backend", "migrations");
  try {
    await runWrangler(
      ["d1", "migrations", "apply", dbName, "--experimental-backend"],
      path.join(projectDir, "backend"),
      "D1 migrations",
      dryRun
    );
    spinner.succeed(`D1 database "${dbName}" ready`);
  } catch {
    // Migrations dir may not exist yet — not fatal
    spinner.warn(`D1 database "${dbName}" created (no migrations found at ${migrationsDir})`);
  }
}

async function deployCache(
  config: ProjectConfig,
  projectDir: string,
  dryRun: boolean
): Promise<void> {
  const dbEngine = config.modules?.database?.engine ?? config.database ?? "none";
  if (!dbEngine.includes("redis")) return;

  const kvName = `${config.name}-cache`;
  const spinner = ora("Provisioning Cloudflare KV namespace...").start();

  await runWrangler(
    ["kv:namespace", "create", kvName],
    projectDir,
    "KV namespace create",
    dryRun
  );

  if (dryRun) {
    spinner.info(`[dry-run] Would provision KV namespace "${kvName}"`);
  } else {
    spinner.succeed(`KV namespace "${kvName}" ready`);
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
    chalk.bold("Deploying to Cloudflare") +
      (dryRun ? chalk.yellow(" [dry run]") : "")
  );
  console.log();

  // Prereq check
  const wranglerVersion = await checkWranglerAvailable();
  console.log(chalk.dim(`✓ wrangler ${wranglerVersion}`));

  const cfConfig = config.deploy?.cloudflare;
  if (!dryRun && !cfConfig?.accountId) {
    console.log(
      chalk.yellow(
        "Tip: set deploy.cloudflare.accountId in blissful-infra.yaml for explicit account targeting."
      )
    );
  }

  // Deploy each component
  const frontendUrl = await deployFrontend(config, projectDir, dryRun);
  const backendUrl = await deployBackend(config, projectDir, dryRun);
  await deployDatabase(config, projectDir, dryRun);
  await deployCache(config, projectDir, dryRun);

  // Summary
  console.log();
  if (dryRun) {
    console.log(chalk.yellow("Dry run complete — no changes were made."));
  } else {
    console.log(chalk.green.bold("Deployment complete"));
    if (frontendUrl) console.log(chalk.dim("  Frontend:"), chalk.cyan(frontendUrl));
    if (backendUrl) console.log(chalk.dim("  Backend: "), chalk.cyan(backendUrl));
    console.log();
    console.log(
      chalk.dim("Run"),
      chalk.cyan("blissful-infra status"),
      chalk.dim("to view deployment history")
    );
  }
}
