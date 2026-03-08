import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { watch } from "chokidar";
import { execa } from "execa";
import { loadConfig, type ProjectConfig } from "../utils/config.js";
import { toExecError } from "../utils/errors.js";
import { replaceVariables, isBinaryFile, getTemplateDir } from "../utils/template.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AppProcess = any;

interface DevState {
  appProcess: AppProcess | null;
  isRebuilding: boolean;
  pendingRebuild: boolean;
}

const state: DevState = {
  appProcess: null,
  isRebuilding: false,
  pendingRebuild: false,
};

async function detectProjectType(): Promise<string> {
  const cwd = process.cwd();

  // Check for build files to determine project type
  try {
    await fs.access(path.join(cwd, "build.gradle.kts"));
    return "gradle-kotlin";
  } catch {}

  try {
    await fs.access(path.join(cwd, "build.gradle"));
    return "gradle";
  } catch {}

  try {
    await fs.access(path.join(cwd, "pom.xml"));
    return "maven";
  } catch {}

  try {
    await fs.access(path.join(cwd, "package.json"));
    return "node";
  } catch {}

  try {
    await fs.access(path.join(cwd, "go.mod"));
    return "go";
  } catch {}

  try {
    await fs.access(path.join(cwd, "requirements.txt"));
    return "python";
  } catch {}

  try {
    await fs.access(path.join(cwd, "pyproject.toml"));
    return "python";
  } catch {}

  return "unknown";
}

function getWatchPaths(projectType: string): string[] {
  switch (projectType) {
    case "gradle-kotlin":
    case "gradle":
    case "maven":
      return ["src/**/*.kt", "src/**/*.java", "src/**/*.xml", "build.gradle.kts", "build.gradle", "pom.xml"];
    case "node":
      return ["src/**/*.ts", "src/**/*.js", "src/**/*.tsx", "src/**/*.jsx", "package.json"];
    case "go":
      return ["**/*.go", "go.mod", "go.sum"];
    case "python":
      return ["**/*.py", "requirements.txt", "pyproject.toml"];
    default:
      return ["src/**/*"];
  }
}

function getIgnorePaths(): string[] {
  return [
    "**/node_modules/**",
    "**/build/**",
    "**/target/**",
    "**/.gradle/**",
    "**/dist/**",
    "**/__pycache__/**",
    "**/.git/**",
    "**/vendor/**",
  ];
}

async function rebuildDockerApp(_config: ProjectConfig): Promise<void> {
  const spinner = ora("Rebuilding application in Docker...").start();

  try {
    // Rebuild and restart the app container
    await execa("docker", ["compose", "up", "-d", "--build", "app"], {
      stdio: "pipe",
    });
    spinner.succeed("Application rebuilt and restarted");
  } catch (error) {
    spinner.fail("Failed to rebuild application");
    const execError = toExecError(error);
    if (execError.stderr) {
      console.error(chalk.red(execError.stderr));
    }
  }
}

async function ensureInfraRunning(includeApp: boolean): Promise<boolean> {
  const spinner = ora("Checking infrastructure...").start();

  try {
    // Check if docker-compose.yaml exists
    try {
      await fs.access(path.join(process.cwd(), "docker-compose.yaml"));
    } catch {
      spinner.fail("No docker-compose.yaml found");
      console.error(chalk.dim("Run"), chalk.cyan("blissful-infra up"), chalk.dim("first to generate it."));
      return false;
    }

    // Start services
    const services = includeApp
      ? ["up", "-d"]
      : ["up", "-d", "kafka", "postgres", "redis"];

    spinner.text = "Starting services...";
    await execa("docker", ["compose", ...services], {
      stdio: "pipe",
      reject: false
    });

    // Wait for services to be healthy
    spinner.text = "Waiting for services to be healthy...";
    await new Promise(resolve => setTimeout(resolve, 3000));

    spinner.succeed("Infrastructure ready");
    return true;
  } catch {
    spinner.warn("Could not verify infrastructure - continuing anyway");
    return true;
  }
}

async function startDockerDevMode(config: ProjectConfig): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan("🐳 Docker Development Mode"));
  console.log(chalk.dim("Watching for changes, rebuilding in Docker..."));
  console.log();

  const projectType = await detectProjectType();
  console.log(chalk.dim(`Detected project type: ${projectType}`));

  // Ensure all services are running (including app)
  const infraReady = await ensureInfraRunning(true);
  if (!infraReady) {
    process.exit(1);
  }

  // Set up file watcher
  const watchPaths = getWatchPaths(projectType);
  const ignorePaths = getIgnorePaths();

  console.log();
  console.log(chalk.dim("Watching:"), watchPaths.join(", "));
  console.log();

  const watcher = watch(watchPaths, {
    cwd: process.cwd(),
    ignored: ignorePaths,
    persistent: true,
    ignoreInitial: true,
    usePolling: true,
    interval: 1000,
  });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let isRebuilding = false;
  let pendingRebuild = false;

  const handleRebuild = async () => {
    if (isRebuilding) {
      pendingRebuild = true;
      return;
    }

    isRebuilding = true;
    await rebuildDockerApp(config);
    isRebuilding = false;

    if (pendingRebuild) {
      pendingRebuild = false;
      await handleRebuild();
    }
  };

  const handleChange = (filePath: string) => {
    console.log(chalk.yellow(`\n📝 Changed: ${path.relative(process.cwd(), filePath)}`));

    // Debounce rapid changes
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      handleRebuild();
    }, 500);
  };

  watcher.on("change", handleChange);
  watcher.on("add", handleChange);
  watcher.on("unlink", handleChange);

  // Handle shutdown
  const shutdown = async () => {
    console.log(chalk.yellow("\n\nShutting down..."));
    await watcher.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(chalk.green("✓ Dev server running"));
  console.log(chalk.dim("  Press Ctrl+C to stop"));
  console.log();
  console.log(chalk.dim("  Application:"), chalk.cyan("http://localhost:8080"));
  console.log(chalk.dim("  Logs:       "), chalk.cyan("docker compose logs -f app"));
  console.log();
}

async function buildProject(projectType: string): Promise<boolean> {
  const spinner = ora("Building project...").start();

  try {
    switch (projectType) {
      case "gradle-kotlin":
      case "gradle":
        await execa("./gradlew", ["build", "-x", "test", "--quiet"], {
          stdio: "pipe",
          env: { ...process.env, TERM: "dumb" }
        });
        break;
      case "maven":
        await execa("./mvnw", ["package", "-DskipTests", "-q"], { stdio: "pipe" });
        break;
      case "node":
        await execa("npm", ["run", "build"], { stdio: "pipe" });
        break;
      case "go":
        await execa("go", ["build", "-o", "app", "."], { stdio: "pipe" });
        break;
      case "python":
        // Python doesn't need compilation
        break;
    }
    spinner.succeed("Build complete");
    return true;
  } catch (error) {
    spinner.fail("Build failed");
    const execError = toExecError(error);
    if (execError.stderr) {
      console.error(chalk.red(execError.stderr));
    }
    return false;
  }
}

async function startApp(projectType: string, config: ProjectConfig): Promise<AppProcess | null> {
  console.log(chalk.cyan("Starting application..."));

  try {
    const env = {
      ...process.env,
      KAFKA_BOOTSTRAP_SERVERS: "localhost:9092",
      DATABASE_URL: `postgresql://${config.name.replace(/-/g, "_")}:localdev@localhost:5432/${config.name.replace(/-/g, "_")}`,
      REDIS_URL: "redis://localhost:6379",
    };

    const execOptions = {
      stdio: "inherit" as const,
      env,
      reject: false,
    };

    switch (projectType) {
      case "gradle-kotlin":
      case "gradle":
        return execa("./gradlew", ["bootRun", "--quiet"], execOptions);
      case "maven":
        return execa("./mvnw", ["spring-boot:run"], execOptions);
      case "node":
        return execa("npm", ["run", "dev"], execOptions);
      case "go":
        return execa("./app", [], execOptions);
      case "python":
        return execa("python", ["-m", "uvicorn", "main:app", "--reload", "--host", "0.0.0.0", "--port", "8080"], execOptions);
      default:
        console.error(chalk.red(`Unknown project type: ${projectType}`));
        return null;
    }
  } catch {
    console.error(chalk.red("Failed to start application"));
    return null;
  }
}

async function stopApp(): Promise<void> {
  if (state.appProcess) {
    console.log(chalk.yellow("\nStopping application..."));
    state.appProcess.kill("SIGTERM");

    // Wait for graceful shutdown
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        state.appProcess?.kill("SIGKILL");
        resolve();
      }, 5000);

      Promise.resolve(state.appProcess).then(() => {
        clearTimeout(timeout);
        resolve();
      });
    });

    state.appProcess = null;
  }
}

async function rebuild(projectType: string, config: ProjectConfig): Promise<void> {
  if (state.isRebuilding) {
    state.pendingRebuild = true;
    return;
  }

  state.isRebuilding = true;

  await stopApp();

  const buildSuccess = await buildProject(projectType);

  if (buildSuccess) {
    state.appProcess = await startApp(projectType, config);
  }

  state.isRebuilding = false;

  // Handle any pending rebuilds that came in while we were building
  if (state.pendingRebuild) {
    state.pendingRebuild = false;
    await rebuild(projectType, config);
  }
}

async function startLocalDevMode(config: ProjectConfig): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan("🔥 Local Development Mode"));
  console.log(chalk.dim("Watching for changes..."));
  console.log();

  const projectType = await detectProjectType();
  console.log(chalk.dim(`Detected project type: ${projectType}`));

  if (projectType === "unknown") {
    console.error(chalk.red("Could not detect project type. Supported: Gradle, Maven, Node.js, Go, Python"));
    process.exit(1);
  }

  // Ensure infrastructure is running (but not the app)
  await ensureInfraRunning(false);

  // Initial build and start
  const buildSuccess = await buildProject(projectType);
  if (buildSuccess) {
    state.appProcess = await startApp(projectType, config);
  }

  // Set up file watcher
  const watchPaths = getWatchPaths(projectType);
  const ignorePaths = getIgnorePaths();

  console.log();
  console.log(chalk.dim("Watching:"), watchPaths.join(", "));
  console.log();

  const watcher = watch(watchPaths, {
    cwd: process.cwd(),
    ignored: ignorePaths,
    persistent: true,
    ignoreInitial: true,
    usePolling: true,
    interval: 1000,
  });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const handleChange = (filePath: string) => {
    console.log(chalk.yellow(`\n📝 Changed: ${path.relative(process.cwd(), filePath)}`));

    // Debounce rapid changes
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      rebuild(projectType, config);
    }, 500);
  };

  watcher.on("change", handleChange);
  watcher.on("add", handleChange);
  watcher.on("unlink", handleChange);

  // Handle shutdown
  const shutdown = async () => {
    console.log(chalk.yellow("\n\nShutting down..."));
    await watcher.close();
    await stopApp();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(chalk.green("✓ Dev server running"));
  console.log(chalk.dim("  Press Ctrl+C to stop"));
  console.log();
  console.log(chalk.dim("  Application:"), chalk.cyan("http://localhost:8080"));
  console.log();
}

// ── Template development mode ─────────────────────────────────────────────
// Watches packages/cli/templates/{spring-boot,react-vite}/src/** and syncs
// changed files (with template variable substitution applied) into a running
// scaffolded project so that Vite HMR and Spring devtools pick them up live.

const TEMPLATE_MAP: Record<string, { templateName: string; destSubDir: string }> = {
  "spring-boot": { templateName: "spring-boot", destSubDir: "backend" },
  "react-vite":  { templateName: "react-vite",  destSubDir: "frontend" },
};

async function syncTemplateFile(
  changedAbsPath: string,
  templateSrcDir: string,
  destDir: string,
  variables: Parameters<typeof replaceVariables>[1]
): Promise<void> {
  const relPath = path.relative(templateSrcDir, changedAbsPath);
  const destPath = path.join(destDir, relPath);

  // Ensure parent directory exists
  await fs.mkdir(path.dirname(destPath), { recursive: true });

  if (isBinaryFile(changedAbsPath)) {
    await fs.copyFile(changedAbsPath, destPath);
  } else {
    const raw = await fs.readFile(changedAbsPath, "utf-8");
    await fs.writeFile(destPath, replaceVariables(raw, variables));
  }
}

async function startTemplateDev(projectName: string): Promise<void> {
  // Resolve the scaffolded project directory
  const projectDir = path.resolve(process.cwd(), projectName);
  const config = await loadConfig(projectDir);
  if (!config) {
    console.error(chalk.red(`No blissful-infra.yaml found in ${projectDir}`));
    console.error(chalk.dim(`Scaffold the project first: blissful-infra start ${projectName}`));
    process.exit(1);
  }

  const variables: Parameters<typeof replaceVariables>[1] = {
    projectName: config.name,
    database: config.database || "postgres",
    deployTarget: "local-only",
  };

  console.log();
  console.log(chalk.bold.cyan("🔄 Template Dev Mode"));
  console.log(chalk.dim(`Syncing template changes → ${projectName}/`));
  console.log();

  const watchEntries: Array<{ srcDir: string; destDir: string; label: string }> = [];

  for (const [key, { templateName, destSubDir }] of Object.entries(TEMPLATE_MAP)) {
    const templateSrcDir = path.join(getTemplateDir(templateName), "src");
    const destDir = path.join(projectDir, destSubDir, "src");

    try {
      await fs.access(templateSrcDir);
      await fs.access(destDir);
      watchEntries.push({ srcDir: templateSrcDir, destDir, label: key });
      console.log(chalk.dim(`  ${key}: packages/cli/templates/${templateName}/src → ${projectName}/${destSubDir}/src`));
    } catch {
      console.log(chalk.dim(`  ${key}: skipped (dest ${projectName}/${destSubDir}/src not found)`));
    }
  }

  if (watchEntries.length === 0) {
    console.error(chalk.red("No template directories found to watch."));
    process.exit(1);
  }

  console.log();
  console.log(chalk.dim("Vite HMR handles frontend changes automatically."));
  console.log(chalk.dim("For backend: run `./gradlew classes -t` in another terminal to auto-compile."));
  console.log();

  const watchPaths = watchEntries.map(e => e.srcDir);

  const watcher = watch(watchPaths, {
    persistent: true,
    ignoreInitial: true,
    usePolling: false,
  });

  const handleChange = async (absPath: string, event: string) => {
    const entry = watchEntries.find(e => absPath.startsWith(e.srcDir));
    if (!entry) return;

    const rel = path.relative(entry.srcDir, absPath);
    console.log(chalk.yellow(`[${entry.label}] ${event}: ${rel}`));

    try {
      if (event === "unlink") {
        const destPath = path.join(entry.destDir, rel);
        await fs.rm(destPath, { force: true });
        console.log(chalk.dim(`  deleted ${path.relative(process.cwd(), destPath)}`));
      } else {
        await syncTemplateFile(absPath, entry.srcDir, entry.destDir, variables);
        const destPath = path.join(entry.destDir, rel);
        console.log(chalk.green(`  → ${path.relative(process.cwd(), destPath)}`));
      }
    } catch (err) {
      console.error(chalk.red(`  sync error: ${err}`));
    }
  };

  watcher.on("change", p => handleChange(p, "changed"));
  watcher.on("add",    p => handleChange(p, "added"));
  watcher.on("unlink", p => handleChange(p, "deleted"));

  console.log(chalk.green("✓ Watching template sources — edit away!"));
  console.log(chalk.dim("  Press Ctrl+C to stop"));
  console.log();

  process.on("SIGINT", async () => {
    await watcher.close();
    process.exit(0);
  });
}

export const devCommand = new Command("dev")
  .description("Start development mode with hot reload")
  .option("--local", "Run locally instead of in Docker (requires matching JDK)")
  .option("--templates <project>", "Template dev mode: watch template sources and sync to a scaffolded project")
  .action(async (opts: { local?: boolean; templates?: string }) => {
    if (opts.templates) {
      await startTemplateDev(opts.templates);
      return;
    }

    // Load project config
    const config = await loadConfig();
    if (!config) {
      console.error(chalk.red("No blissful-infra.yaml found."));
      console.error(chalk.dim("Run"), chalk.cyan("blissful-infra create"), chalk.dim("first."));
      process.exit(1);
    }

    if (opts.local) {
      await startLocalDevMode(config);
    } else {
      await startDockerDevMode(config);
    }
  });
