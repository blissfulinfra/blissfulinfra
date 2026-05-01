import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import type { ClientConfig } from "@blissful-infra/shared";
import {
  allocateFreePortBlock,
  unregisterClient,
  getClientDir,
  listClients,
  getClientPortBlock,
} from "../utils/client-registry.js";
import {
  generateInfraCompose,
  generatePrometheusConfig,
  generateLokiConfig,
  generateGrafanaConfig,
} from "../utils/infra-compose.js";
import { ensureJenkinsImage, ensureDashboardImage } from "../utils/infra-images.js";
import { toExecError } from "../utils/errors.js";

interface ClientCreateOptions {
  // Commander populates these (defaulting to true) for `--no-X` flags
  jenkins?: boolean;
  kafka?: boolean;
  observability?: boolean;
  yes?: boolean;
}

async function clientCreateAction(clientName: string, opts: ClientCreateOptions): Promise<void> {
  console.log();
  console.log(chalk.bold("blissful-infra client create"), chalk.cyan(clientName));
  console.log();

  if (!/^[a-z0-9-]+$/.test(clientName)) {
    console.error(chalk.red("Client name must be lowercase alphanumeric with hyphens"));
    process.exit(1);
  }

  const clientDir = getClientDir(clientName);

  // Check if already exists
  try {
    await fs.access(clientDir);
    console.error(chalk.red(`Client '${clientName}' already exists at ${clientDir}`));
    process.exit(1);
  } catch {
    // Good — doesn't exist
  }

  // Build infrastructure config — prompt unless --yes or non-TTY.
  // Commander defaults `jenkins/kafka/observability` to true; `--no-X` sets them to false.
  // Defaults from flags pre-populate the prompt so --no-X choices are reflected.
  let infrastructure: NonNullable<ClientConfig["infrastructure"]>;
  const useDefaults = opts.yes || !process.stdout.isTTY;

  const flagJenkins = opts.jenkins !== false;
  const flagKafka = opts.kafka !== false;
  const flagObs = opts.observability !== false;

  if (!useDefaults) {
    const answers = await inquirer.prompt([
      {
        type: "checkbox",
        name: "components",
        message: "Infrastructure components (space to toggle, enter to confirm)",
        choices: [
          { name: "Kafka", value: "kafka", checked: flagKafka },
          { name: "Postgres", value: "postgres", checked: true },
          { name: "Jenkins (CI/CD)", value: "jenkins", checked: flagJenkins },
          { name: "Prometheus + Grafana (metrics)", value: "metrics", checked: flagObs },
          { name: "Jaeger (tracing)", value: "jaeger", checked: flagObs },
          { name: "Loki + Promtail (logs)", value: "loki", checked: flagObs },
          { name: "ClickHouse (Phase 8+ TSDB)", value: "clickhouse", checked: false },
        ],
      },
    ] as never) as { components: string[] };

    infrastructure = {
      kafka: answers.components.includes("kafka"),
      postgres: answers.components.includes("postgres"),
      jenkins: answers.components.includes("jenkins"),
      observability: {
        prometheus: answers.components.includes("metrics"),
        grafana: answers.components.includes("metrics"),
        jaeger: answers.components.includes("jaeger"),
        loki: answers.components.includes("loki"),
        clickhouse: answers.components.includes("clickhouse"),
      },
    };
  } else {
    infrastructure = {
      kafka: flagKafka,
      postgres: true,
      jenkins: flagJenkins,
      observability: flagObs
        ? { prometheus: true, grafana: true, jaeger: true, loki: true, clickhouse: false }
        : { prometheus: false, grafana: false, jaeger: false, loki: false, clickhouse: false },
    };
  }

  // Allocate a port block whose host ports are actually free
  const spinner = ora("Allocating port block...").start();
  let ports;
  try {
    ports = await allocateFreePortBlock(clientName, infrastructure);
  } catch (error) {
    spinner.fail("Could not find a free port block");
    console.error(chalk.red((error as Error).message));
    console.error(chalk.dim("Free up some host ports or stop other blissful-infra projects, then retry."));
    process.exit(1);
  }
  spinner.succeed(`Port block ${ports.blockIndex} allocated (host ports verified free)`);

  // Create directory structure
  const dirSpinner = ora("Creating client directory...").start();
  await fs.mkdir(clientDir, { recursive: true });

  // Write client config YAML
  const obs = infrastructure.observability!;
  const configYaml = `type: client
name: ${clientName}

infrastructure:
  kafka: ${infrastructure.kafka}
  postgres: ${infrastructure.postgres}
  jenkins: ${infrastructure.jenkins}
  observability:
    prometheus: ${obs.prometheus}
    grafana: ${obs.grafana}
    jaeger: ${obs.jaeger}
    loki: ${obs.loki}
    clickhouse: ${obs.clickhouse}

plugins: []

deploy:
  target: local-only

services: []
`;
  await fs.writeFile(path.join(clientDir, "blissful-infra.yaml"), configYaml);
  dirSpinner.succeed("Client directory created");

  // Generate docker-compose.infra.yaml
  const composeSpinner = ora("Generating docker-compose.infra.yaml...").start();
  await generateInfraCompose({ clientName, clientDir, ports, infrastructure });
  composeSpinner.succeed("Generated docker-compose.infra.yaml");

  // Generate supporting configs
  const configSpinner = ora("Generating infrastructure configs...").start();

  if (obs.prometheus) {
    await generatePrometheusConfig(clientDir);
  }
  if (obs.loki) {
    await generateLokiConfig(clientDir);
  }
  if (obs.grafana && obs.prometheus) {
    await generateGrafanaConfig(clientDir);
  }

  configSpinner.succeed("Infrastructure configs generated");

  // Ensure dependent images are built before bringing infra up
  await ensureDashboardImage();
  if (infrastructure.jenkins) {
    await ensureJenkinsImage();
  }

  // Start infrastructure
  console.log(chalk.dim("Starting infrastructure containers..."));
  console.log();

  try {
    await execa("docker", ["compose", "-f", "docker-compose.infra.yaml", "up", "-d"], {
      cwd: clientDir,
      stdio: "inherit",
    });
    console.log();
    console.log(chalk.green("Containers started"));
  } catch (error) {
    const execError = toExecError(error);
    if (execError.stderr) {
      console.error(chalk.red(execError.stderr));
    }
    console.log();
    console.log(chalk.yellow("Client created but infra failed to start. Try:"));
    console.log(chalk.cyan(`  cd ${clientDir}`));
    console.log(chalk.cyan("  docker compose -f docker-compose.infra.yaml up"));
    return;
  }

  // Print access URLs
  console.log();
  console.log(chalk.green.bold(`${clientName} environment ready`));
  console.log();
  if (infrastructure.jenkins) {
    console.log(chalk.dim("  Jenkins:     ") + chalk.cyan(`http://localhost:${ports.jenkins}`) + chalk.dim("  (admin / admin)"));
  }
  if (obs.grafana) {
    console.log(chalk.dim("  Grafana:     ") + chalk.cyan(`http://localhost:${ports.grafana}`));
  }
  if (obs.prometheus) {
    console.log(chalk.dim("  Prometheus:  ") + chalk.cyan(`http://localhost:${ports.prometheus}`));
  }
  if (obs.jaeger) {
    console.log(chalk.dim("  Jaeger:      ") + chalk.cyan(`http://localhost:${ports.jaeger}`));
  }
  if (infrastructure.kafka) {
    console.log(chalk.dim("  Kafka:       ") + chalk.cyan(`localhost:${ports.kafka}`));
  }
  if (infrastructure.postgres) {
    console.log(chalk.dim("  Postgres:    ") + chalk.cyan(`localhost:${ports.postgres}`));
  }
  console.log(chalk.dim("  Dashboard:   ") + chalk.cyan(`http://localhost:${ports.dashboard}`));
  console.log();

  // Offer to scaffold the first service inline
  if (!opts.yes && process.stdout.isTTY) {
    const { addNow } = (await inquirer.prompt([
      {
        type: "confirm",
        name: "addNow",
        message: "Add a service (backend + optional frontend) to this client now?",
        default: true,
      },
    ] as never)) as { addNow: boolean };

    if (addNow) {
      const { serviceName } = (await inquirer.prompt([
        {
          type: "input",
          name: "serviceName",
          message: "Service name (lowercase alphanumeric with hyphens)",
          validate: (v: string) => /^[a-z0-9-]+$/.test(v) || "Must be lowercase alphanumeric with hyphens",
        },
      ] as never)) as { serviceName: string };

      const { serviceAddAction } = await import("./service.js");
      await serviceAddAction(clientName, serviceName, {});
      return;
    }
  }

  console.log(chalk.dim("Add a service:"));
  console.log(chalk.cyan(`  blissful-infra service add ${clientName} <service-name>`));
  console.log();
}

async function clientListAction(): Promise<void> {
  const clients = await listClients();

  if (clients.length === 0) {
    console.log(chalk.dim("No client environments found."));
    console.log(chalk.dim("Create one with: blissful-infra client create <name>"));
    return;
  }

  console.log();
  console.log(chalk.bold("Client environments:"));
  console.log();

  for (const block of clients) {
    // Check if infra is running
    const clientDir = getClientDir(block.clientName);
    let running = false;
    try {
      const { stdout } = await execa("docker", ["compose", "-f", "docker-compose.infra.yaml", "ps", "--format", "json"], {
        cwd: clientDir,
        stdio: "pipe",
      });
      running = stdout.trim().length > 0;
    } catch {
      // Not running
    }

    const status = running ? chalk.green("running") : chalk.dim("stopped");
    console.log(`  ${chalk.bold(block.clientName)}  ${status}  (ports: ${block.jenkins}+)`);
  }
  console.log();
}

async function clientUpAction(clientName: string): Promise<void> {
  const clientDir = getClientDir(clientName);
  const ports = await getClientPortBlock(clientName);

  if (!ports) {
    console.error(chalk.red(`Client '${clientName}' not found in registry`));
    process.exit(1);
  }

  console.log(chalk.dim(`Starting ${clientName}...`));

  // Re-ensure images exist (they may have been pruned)
  const configContentForImages = await fs.readFile(path.join(clientDir, "blissful-infra.yaml"), "utf-8");
  await ensureDashboardImage();
  if (/jenkins:\s*true/i.test(configContentForImages)) {
    await ensureJenkinsImage();
  }

  // One compose call brings up infra + all included services
  await execa("docker", ["compose", "-f", "docker-compose.infra.yaml", "up", "-d"], {
    cwd: clientDir,
    stdio: "inherit",
  });

  console.log();
  console.log(chalk.green(`${clientName} is up`));
}

async function clientDownAction(clientName: string): Promise<void> {
  const clientDir = getClientDir(clientName);
  const ports = await getClientPortBlock(clientName);

  if (!ports) {
    console.error(chalk.red(`Client '${clientName}' not found in registry`));
    process.exit(1);
  }

  console.log(chalk.dim(`Stopping ${clientName}...`));

  // One compose call brings down infra + all included services
  await execa("docker", ["compose", "-f", "docker-compose.infra.yaml", "down"], {
    cwd: clientDir,
    stdio: "inherit",
  });

  console.log(chalk.green(`${clientName} is stopped`));
}

async function clientStatusAction(clientName: string): Promise<void> {
  const clientDir = getClientDir(clientName);
  const ports = await getClientPortBlock(clientName);

  if (!ports) {
    console.error(chalk.red(`Client '${clientName}' not found in registry`));
    process.exit(1);
  }

  console.log();
  console.log(chalk.bold(clientName), chalk.dim(`(port block ${ports.blockIndex})`));
  console.log();

  // Single `docker compose ps` shows infra + all included services together
  try {
    await execa("docker", ["compose", "-f", "docker-compose.infra.yaml", "ps"], {
      cwd: clientDir,
      stdio: "inherit",
    });
  } catch {
    console.log(chalk.dim("  Project not running"));
  }
  console.log();
}

async function clientRemoveAction(clientName: string): Promise<void> {
  const clientDir = getClientDir(clientName);
  const ports = await getClientPortBlock(clientName);

  if (!ports) {
    console.error(chalk.red(`Client '${clientName}' not found in registry`));
    process.exit(1);
  }

  const spinner = ora(`Removing ${clientName}...`).start();

  // One compose call tears down everything (infra + included services + volumes)
  try {
    await execa("docker", ["compose", "-f", "docker-compose.infra.yaml", "down", "-v"], {
      cwd: clientDir,
      stdio: "pipe",
    });
  } catch {
    // Containers might not be running
  }

  // Remove Docker network
  try {
    await execa("docker", ["network", "rm", `${clientName}_infra`], { stdio: "pipe" });
  } catch {
    // Might not exist
  }

  // Remove directory
  await fs.rm(clientDir, { recursive: true, force: true });

  // Unregister
  await unregisterClient(clientName);

  spinner.succeed(`Removed ${clientName}`);
}

async function clientCleanAction(opts: { force?: boolean }): Promise<void> {
  const clients = await listClients();

  if (clients.length === 0) {
    console.log(chalk.dim("No clients to remove."));
    return;
  }

  console.log();
  console.log(chalk.bold("The following clients will be removed:"));
  for (const c of clients) {
    console.log(chalk.dim(`  - ${c.clientName}`));
  }
  console.log();

  if (!opts.force && process.stdout.isTTY) {
    const { confirm } = (await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: `Remove all ${clients.length} client(s)? This deletes containers, networks, volumes, and directories.`,
        default: false,
      },
    ] as never)) as { confirm: boolean };

    if (!confirm) {
      console.log(chalk.dim("Cancelled."));
      return;
    }
  }

  for (const c of clients) {
    try {
      await clientRemoveAction(c.clientName);
    } catch (error) {
      console.error(chalk.yellow(`  Failed to remove ${c.clientName}: ${(error as Error).message}`));
    }
  }

  console.log();
  console.log(chalk.green(`Cleaned ${clients.length} client(s)`));
}

// Minimal parser for service refs from client YAML
function parseServiceRefs(content: string): { name: string; path: string }[] {
  const refs: { name: string; path: string }[] = [];
  const lines = content.split("\n");
  let inServices = false;
  let current: Partial<{ name: string; path: string }> = {};

  for (const line of lines) {
    if (/^services:/.test(line)) {
      inServices = true;
      continue;
    }
    if (!inServices) continue;
    if (line.length > 0 && !line.startsWith(" ") && !line.startsWith("\t") && !/^services:/.test(line)) {
      break;
    }

    const nameMatch = line.match(/^\s+-\s+name:\s*(.+)$/);
    if (nameMatch) {
      if (current.name && current.path) {
        refs.push(current as { name: string; path: string });
      }
      current = { name: nameMatch[1].trim() };
      continue;
    }

    const pathMatch = line.match(/^\s+path:\s*(.+)$/);
    if (pathMatch) {
      current.path = pathMatch[1].trim();
    }
  }

  if (current.name && current.path) {
    refs.push(current as { name: string; path: string });
  }

  return refs;
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export const clientCommand = new Command("client")
  .description("Manage client environments");

clientCommand
  .command("create")
  .description("Create a new client environment with shared infrastructure")
  .argument("<name>", "Client name (lowercase alphanumeric with hyphens)")
  .option("--no-jenkins", "Skip Jenkins")
  .option("--no-kafka", "Skip Kafka")
  .option("--no-observability", "Skip Prometheus/Grafana/Jaeger/Loki")
  .option("-y, --yes", "Skip interactive prompt and use defaults / flag values")
  .action(clientCreateAction);

clientCommand
  .command("list")
  .description("List all client environments")
  .action(clientListAction);

clientCommand
  .command("up")
  .description("Start a client environment (infra + all services)")
  .argument("<name>", "Client name")
  .action(clientUpAction);

clientCommand
  .command("down")
  .description("Stop a client environment")
  .argument("<name>", "Client name")
  .action(clientDownAction);

clientCommand
  .command("status")
  .description("Show client status (infra health + all services)")
  .argument("<name>", "Client name")
  .action(clientStatusAction);

clientCommand
  .command("remove")
  .description("Remove a client environment entirely")
  .argument("<name>", "Client name")
  .action(clientRemoveAction);

clientCommand
  .command("clean")
  .description("Remove ALL client environments (containers, networks, volumes, dirs)")
  .option("-f, --force", "Skip confirmation prompt")
  .action(clientCleanAction);
