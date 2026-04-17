import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import type { ClientConfig } from "@blissful-infra/shared";
import {
  registerClient,
  unregisterClient,
  getClientDir,
  getClientsDir,
  listClients,
  getClientPortBlock,
} from "../utils/client-registry.js";
import {
  generateInfraCompose,
  generatePrometheusConfig,
  generateLokiConfig,
  generateGrafanaConfig,
} from "../utils/infra-compose.js";
import { toExecError } from "../utils/errors.js";

interface ClientCreateOptions {
  noJenkins?: boolean;
  noKafka?: boolean;
  noObservability?: boolean;
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

  // Register and allocate ports
  const spinner = ora("Allocating port block...").start();
  const ports = await registerClient(clientName);
  spinner.succeed(`Port block ${ports.blockIndex} allocated`);

  // Build infrastructure config from flags
  const infrastructure: NonNullable<ClientConfig["infrastructure"]> = {
    kafka: !opts.noKafka,
    postgres: true,
    jenkins: !opts.noJenkins,
    observability: opts.noObservability
      ? { prometheus: false, grafana: false, jaeger: false, loki: false, clickhouse: false }
      : { prometheus: true, grafana: true, jaeger: true, loki: true, clickhouse: false },
  };

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
  console.log(chalk.dim("Add a service:"));
  console.log(chalk.cyan(`  blissful-infra service add ${clientName} <service-name> --backend spring-boot`));
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

  console.log(chalk.dim(`Starting ${clientName} infrastructure...`));

  // Start infra
  await execa("docker", ["compose", "-f", "docker-compose.infra.yaml", "up", "-d"], {
    cwd: clientDir,
    stdio: "inherit",
  });

  // Start all services
  const configContent = await fs.readFile(path.join(clientDir, "blissful-infra.yaml"), "utf-8");
  const serviceRefs = parseServiceRefs(configContent);

  for (const svc of serviceRefs) {
    const svcDir = path.join(clientDir, svc.path);
    try {
      await execa("docker", ["compose", "up", "-d"], { cwd: svcDir, stdio: "inherit" });
    } catch {
      console.log(chalk.yellow(`  Warning: failed to start service ${svc.name}`));
    }
  }

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

  // Stop all services first
  const configContent = await fs.readFile(path.join(clientDir, "blissful-infra.yaml"), "utf-8");
  const serviceRefs = parseServiceRefs(configContent);

  for (const svc of serviceRefs) {
    const svcDir = path.join(clientDir, svc.path);
    try {
      await execa("docker", ["compose", "down"], { cwd: svcDir, stdio: "pipe" });
    } catch {
      // Might not be running
    }
  }

  // Stop infra
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

  // Infra status
  console.log(chalk.bold("Infrastructure:"));
  try {
    await execa("docker", ["compose", "-f", "docker-compose.infra.yaml", "ps"], {
      cwd: clientDir,
      stdio: "inherit",
    });
  } catch {
    console.log(chalk.dim("  Infrastructure not running"));
  }

  // Service status
  const configContent = await fs.readFile(path.join(clientDir, "blissful-infra.yaml"), "utf-8");
  const serviceRefs = parseServiceRefs(configContent);

  if (serviceRefs.length > 0) {
    console.log();
    console.log(chalk.bold("Services:"));
    for (const svc of serviceRefs) {
      const svcDir = path.join(clientDir, svc.path);
      console.log(chalk.dim(`  ${svc.name}:`));
      try {
        await execa("docker", ["compose", "ps"], { cwd: svcDir, stdio: "inherit" });
      } catch {
        console.log(chalk.dim("    Not running"));
      }
    }
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

  // Stop and remove all containers
  try {
    // Stop services first
    const configContent = await fs.readFile(path.join(clientDir, "blissful-infra.yaml"), "utf-8");
    const serviceRefs = parseServiceRefs(configContent);
    for (const svc of serviceRefs) {
      const svcDir = path.join(clientDir, svc.path);
      try {
        await execa("docker", ["compose", "down", "-v"], { cwd: svcDir, stdio: "pipe" });
      } catch { /* noop */ }
    }

    // Stop infra
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
