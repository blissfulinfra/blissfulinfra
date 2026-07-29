/**
 * Cloudflare promotion target (ADR-0022).
 *
 * Local kind is the rehearsal; Cloudflare is production. A service promotes
 * without changing its local runtime:
 *
 *   frontend (react-vite) → Cloudflare Pages
 *   backend/worker (hono) → Cloudflare Workers
 *
 * spring-boot and lambda-python have no Workers runtime — a JVM or CPython
 * process cannot run on the Workers isolate model. Those services get a clear
 * error pointing at the hono template rather than a confusing wrangler failure.
 */

import path from "node:path";
import fs from "node:fs/promises";
import chalk from "chalk";
import ora from "ora";
import { execa } from "execa";
import type { CloudflareDeploy, ServiceConfigV2 } from "@blissful-infra/shared";
import { PrereqMissingError, DeployFailedError, DeployTargetError } from "./errors.js";
import type { ServiceCoords } from "../commands/deploy.js";
import { getServiceDir, readServiceConfig } from "../utils/tenant-registry.js";
import { saveDeployment } from "../utils/deployment-storage.js";

export interface CloudflareDeployOptions {
  tag?: string;
  dryRun?: boolean;
}

/** Backend templates that compile to a Workers-compatible fetch handler. */
const WORKERS_COMPATIBLE_BACKENDS = new Set(["hono"]);

async function ensureWrangler(): Promise<string> {
  try {
    const { stdout } = await execa("wrangler", ["--version"], { stdio: "pipe" });
    return stdout.trim().split("\n").pop() ?? stdout.trim();
  } catch {
    throw new PrereqMissingError(
      "wrangler",
      "Install with: npm install -g wrangler@latest\n" +
      "Then authenticate: wrangler login\n" +
      "Docs: https://developers.cloudflare.com/workers/wrangler/install-and-update/",
    );
  }
}

/**
 * `wrangler whoami` is the only reliable auth probe — a deploy against an
 * unauthenticated CLI fails deep in the upload with an opaque message.
 */
async function ensureAuthenticated(): Promise<void> {
  const { exitCode, stdout } = await execa("wrangler", ["whoami"], { stdio: "pipe", reject: false });
  if (exitCode !== 0 || /not authenticated|log in/i.test(stdout)) {
    throw new PrereqMissingError(
      "wrangler login",
      "wrangler is installed but not authenticated. Run:\n  wrangler login\n" +
      "In CI, set CLOUDFLARE_API_TOKEN instead.",
    );
  }
}

async function runWrangler(
  args: string[],
  cwd: string,
  label: string,
  dryRun: boolean,
  accountId?: string,
): Promise<string> {
  if (dryRun) {
    console.log(chalk.dim(`  [dry-run] wrangler ${args.join(" ")}`));
    return "";
  }
  const result = await execa("wrangler", args, {
    cwd,
    stdio: "pipe",
    reject: false,
    // wrangler reads the account from the environment; there is no per-command
    // flag for it, and a login with several accounts otherwise prompts.
    env: accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : undefined,
  });
  if (result.exitCode !== 0) {
    throw new DeployFailedError(
      `${label} failed`,
      result.exitCode ?? 1,
      result.stderr || result.stdout,
    );
  }
  return result.stdout;
}

function cfConfig(service: ServiceConfigV2): CloudflareDeploy {
  return service.deploy?.cloudflare ?? {};
}

/** Conventional resource name: <project>-<service>, matching the k8s app name. */
function defaultName(coords: ServiceCoords): string {
  return `${coords.project}-${coords.service}`;
}

async function hasScript(serviceDir: string, script: string): Promise<boolean> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(serviceDir, "package.json"), "utf-8")) as {
      scripts?: Record<string, string>;
    };
    return Boolean(pkg.scripts?.[script]);
  } catch {
    return false;
  }
}

/**
 * Provision D1 / KV when the service declares them. `wrangler d1 create` is
 * not idempotent — an existing database is an error, which we treat as success
 * so re-deploys work.
 */
async function provisionBindings(
  cf: CloudflareDeploy,
  serviceDir: string,
  dryRun: boolean,
): Promise<void> {
  if (cf.d1Database) {
    const spinner = ora(`Ensuring D1 database "${cf.d1Database}"...`).start();
    try {
      await runWrangler(["d1", "create", cf.d1Database], serviceDir, "D1 create", dryRun, cf.accountId);
      spinner.succeed(`D1 database "${cf.d1Database}" created`);
    } catch (err) {
      if (err instanceof DeployFailedError && /already exists/i.test(err.stderr ?? "")) {
        spinner.succeed(`D1 database "${cf.d1Database}" already exists`);
      } else {
        spinner.fail(`D1 database "${cf.d1Database}" could not be created`);
        throw err;
      }
    }

    if (await hasScript(serviceDir, "d1:migrate")) {
      const migrate = ora("Applying D1 migrations...").start();
      await runWrangler(
        ["d1", "migrations", "apply", cf.d1Database, "--remote"],
        serviceDir,
        "D1 migrations",
        dryRun,
        cf.accountId,
      );
      migrate.succeed("D1 migrations applied");
    }
  }

  if (cf.kvNamespace) {
    const spinner = ora(`Ensuring KV namespace "${cf.kvNamespace}"...`).start();
    try {
      await runWrangler(["kv", "namespace", "create", cf.kvNamespace], serviceDir, "KV create", dryRun, cf.accountId);
      spinner.succeed(`KV namespace "${cf.kvNamespace}" created`);
    } catch (err) {
      if (err instanceof DeployFailedError && /already exists/i.test(err.stderr ?? "")) {
        spinner.succeed(`KV namespace "${cf.kvNamespace}" already exists`);
      } else {
        spinner.fail(`KV namespace "${cf.kvNamespace}" could not be created`);
        throw err;
      }
    }
  }
}

async function deployWorker(
  coords: ServiceCoords,
  service: ServiceConfigV2,
  serviceDir: string,
  dryRun: boolean,
): Promise<string> {
  const template = service.backend?.template ?? service.worker?.runtime ?? "unknown";
  if (service.serviceType === "backend" && !WORKERS_COMPATIBLE_BACKENDS.has(template)) {
    throw new DeployTargetError(
      `Service '${coords.service}' uses the '${template}' backend template, which cannot run on ` +
      `Cloudflare Workers.\n\n` +
      `Workers runs Web-standard fetch handlers on a V8 isolate — there is no JVM and no CPython.\n` +
      `Workers-compatible backend template: ${[...WORKERS_COMPATIBLE_BACKENDS].join(", ")}.\n\n` +
      `Options:\n` +
      `  • Add a hono service:  blissful-infra service add <name> --type backend --template hono\n` +
      `  • Keep this service on the kubernetes runtime:  blissful-infra deploy ${coords.service}`,
    );
  }

  const cf = cfConfig(service);
  const workerName = cf.workerName ?? defaultName(coords);

  await provisionBindings(cf, serviceDir, dryRun);

  if (await hasScript(serviceDir, "build")) {
    const build = ora("Building worker...").start();
    if (dryRun) {
      build.info("[dry-run] npm run build");
    } else {
      const result = await execa("npm", ["run", "build"], { cwd: serviceDir, stdio: "pipe", reject: false });
      if (result.exitCode !== 0) {
        build.fail("Worker build failed");
        throw new DeployFailedError("Worker build failed", result.exitCode ?? 1, result.stderr);
      }
      build.succeed("Worker built");
    }
  }

  const spinner = ora(`Deploying worker "${workerName}"...`).start();
  const out = await runWrangler(
    ["deploy", "--name", workerName],
    serviceDir,
    "Workers deploy",
    dryRun,
    cf.accountId,
  );

  const url = out.match(/https?:\/\/[^\s]+\.workers\.dev[^\s]*/)?.[0] ?? `https://${workerName}.workers.dev`;
  if (dryRun) spinner.info(`[dry-run] would deploy worker → ${url}`);
  else spinner.succeed(`Worker deployed → ${chalk.cyan(url)}`);
  return url;
}

async function deployPages(
  coords: ServiceCoords,
  service: ServiceConfigV2,
  serviceDir: string,
  dryRun: boolean,
): Promise<string> {
  const cf = cfConfig(service);
  const pagesProject = cf.pagesProject ?? defaultName(coords);

  const build = ora("Building frontend...").start();
  if (dryRun) {
    build.info("[dry-run] npm run build");
  } else {
    const result = await execa("npm", ["run", "build"], { cwd: serviceDir, stdio: "pipe", reject: false });
    if (result.exitCode !== 0) {
      build.fail("Frontend build failed");
      throw new DeployFailedError("Frontend build failed", result.exitCode ?? 1, result.stderr);
    }
    build.succeed("Frontend built");
  }

  const distDir = path.join(serviceDir, "dist");
  if (!dryRun) {
    try {
      await fs.access(distDir);
    } catch {
      throw new DeployFailedError(
        `Build succeeded but no dist/ directory at ${distDir}. ` +
        `Cloudflare Pages needs a static output directory.`,
      );
    }
  }

  const spinner = ora(`Deploying to Pages project "${pagesProject}"...`).start();
  const out = await runWrangler(
    ["pages", "deploy", "dist", "--project-name", pagesProject, "--commit-dirty=true"],
    serviceDir,
    "Pages deploy",
    dryRun,
    cf.accountId,
  );

  const url = out.match(/https?:\/\/[^\s]+\.pages\.dev[^\s]*/)?.[0] ?? `https://${pagesProject}.pages.dev`;
  if (dryRun) spinner.info(`[dry-run] would deploy frontend → ${url}`);
  else spinner.succeed(`Frontend deployed → ${chalk.cyan(url)}`);
  return url;
}

async function resolveTag(serviceDir: string, explicit?: string): Promise<string> {
  if (explicit) return explicit;
  try {
    const { stdout } = await execa("git", ["-C", serviceDir, "rev-parse", "--short", "HEAD"], { stdio: "pipe" });
    return stdout.trim();
  } catch {
    return `t${Date.now()}`;
  }
}

export async function deployCloudflare(
  coords: ServiceCoords,
  opts: CloudflareDeployOptions,
): Promise<void> {
  const dryRun = opts.dryRun ?? false;
  const serviceDir = getServiceDir(coords.tenant, coords.project, coords.service);
  const service = await readServiceConfig(coords.tenant, coords.project, coords.service);

  const version = await ensureWrangler();
  if (!dryRun) await ensureAuthenticated();

  console.log();
  console.log(
    chalk.bold("blissful-infra deploy"),
    chalk.cyan(`${coords.tenant}/${coords.project}/${coords.service}`),
    chalk.dim("→ Cloudflare") + (dryRun ? chalk.yellow(" [dry run]") : ""),
  );
  console.log(chalk.dim(`  wrangler ${version}`));
  console.log();

  const url = service.serviceType === "frontend"
    ? await deployPages(coords, service, serviceDir, dryRun)
    : await deployWorker(coords, service, serviceDir, dryRun);

  if (dryRun) {
    console.log();
    console.log(chalk.yellow("Dry run complete — nothing was deployed."));
    return;
  }

  const tag = await resolveTag(serviceDir, opts.tag);
  await saveDeployment(serviceDir, {
    id: `cf-${Date.now()}`,
    timestamp: Date.now(),
    projectName: coords.service,
    gitSha: tag,
    status: "success",
    regression: false,
    environment: "cloudflare",
    imageTag: tag,
    strategy: "rolling",
  });

  console.log();
  console.log(chalk.green.bold("✓ Promoted to Cloudflare."), chalk.cyan(url));
  console.log(chalk.dim("  Logs:     ") + chalk.cyan(`wrangler tail ${cfConfig(service).workerName ?? defaultName(coords)}`));
  console.log(chalk.dim("  Rollback: ") + chalk.cyan("wrangler rollback"));
  console.log();
}
