import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { getClientDir, getClientPortBlock } from "../utils/client-registry.js";
import { copyTemplate, getAvailableTemplates, getAvailablePlugins, copyPlugin } from "../utils/template.js";
import { parsePluginSpecs, serializePluginSpecs } from "../utils/config.js";
import { generatePrometheusConfig } from "../utils/infra-compose.js";
import { toExecError } from "../utils/errors.js";

interface ServiceAddOptions {
  backend?: string;
  frontend?: string;
  plugins?: string;
}

async function serviceAddAction(clientName: string, serviceName: string, opts: ServiceAddOptions): Promise<void> {
  console.log();
  console.log(chalk.bold("blissful-infra service add"), chalk.cyan(`${clientName}/${serviceName}`));
  console.log();

  if (!/^[a-z0-9-]+$/.test(serviceName)) {
    console.error(chalk.red("Service name must be lowercase alphanumeric with hyphens"));
    process.exit(1);
  }

  const clientDir = getClientDir(clientName);
  const ports = await getClientPortBlock(clientName);

  if (!ports) {
    console.error(chalk.red(`Client '${clientName}' not found. Create it first:`));
    console.error(chalk.cyan(`  blissful-infra client create ${clientName}`));
    process.exit(1);
  }

  const serviceDir = path.join(clientDir, serviceName);

  try {
    await fs.access(serviceDir);
    console.error(chalk.red(`Service '${serviceName}' already exists in ${clientName}`));
    process.exit(1);
  } catch {
    // Good
  }

  const backend = opts.backend || "spring-boot";
  const frontend = opts.frontend;
  const plugins = opts.plugins ? parsePluginSpecs(opts.plugins.split(",").map(p => p.trim())) : [];

  // Scaffold service directory
  const spinner = ora(`Scaffolding ${serviceName}...`).start();
  await fs.mkdir(serviceDir, { recursive: true });

  const availableTemplates = getAvailableTemplates();
  const availablePlugins = getAvailablePlugins();

  // Copy backend template
  if (availableTemplates.includes(backend)) {
    await fs.mkdir(path.join(serviceDir, "backend"), { recursive: true });
    await copyTemplate(backend, path.join(serviceDir, "backend"), {
      projectName: serviceName,
      database: "postgres",
      deployTarget: "local-only",
      plugins: plugins.map(p => p.type),
    });
  }

  // Copy frontend template
  if (frontend && availableTemplates.includes(frontend)) {
    await fs.mkdir(path.join(serviceDir, "frontend"), { recursive: true });
    await copyTemplate(frontend, path.join(serviceDir, "frontend"), {
      projectName: serviceName,
      database: "postgres",
      deployTarget: "local-only",
      plugins: plugins.map(p => p.type),
    });
  }

  // Copy plugin templates
  for (const plugin of plugins) {
    if (availablePlugins.includes(plugin.type)) {
      const pluginDir = path.join(serviceDir, plugin.instance);
      await fs.mkdir(pluginDir, { recursive: true });
      await copyPlugin(plugin.type, pluginDir, {
        projectName: serviceName,
        database: "postgres",
        deployTarget: "local-only",
        instanceName: plugin.instance,
        apiPort: 8090,
      });
    }
  }

  spinner.succeed(`Scaffolded ${serviceName}`);

  // Write service config
  const configSpinner = ora("Writing service config...").start();
  const pluginLine = plugins.length > 0 ? `\nplugins: ${serializePluginSpecs(plugins)}` : "";
  const frontendLine = frontend ? `\nfrontend: ${frontend}` : "";

  const serviceConfig = `type: service
name: ${serviceName}
client: ${clientName}

backend: ${backend}${frontendLine}${pluginLine}
`;
  await fs.writeFile(path.join(serviceDir, "blissful-infra.yaml"), serviceConfig);

  // Generate service docker-compose.yaml joining the client's infra network
  const serviceCompose = generateServiceCompose(clientName, serviceName, backend, frontend, plugins);
  await fs.writeFile(path.join(serviceDir, "docker-compose.yaml"), serviceCompose);

  configSpinner.succeed("Service config written");

  // Update client config to include this service
  const clientConfigPath = path.join(clientDir, "blissful-infra.yaml");
  const clientConfig = await fs.readFile(clientConfigPath, "utf-8");
  const updatedConfig = appendServiceToClientConfig(clientConfig, serviceName);
  await fs.writeFile(clientConfigPath, updatedConfig);

  // Update Prometheus scrape targets
  const promSpinner = ora("Updating Prometheus scrape config...").start();
  const allServices = parseExistingServices(updatedConfig);
  const targets = allServices.map(svc => ({
    name: `${clientName}-${svc.name}`,
    host: `${svc.name}-backend:8080`,
  }));
  await generatePrometheusConfig(clientDir, targets);

  // Reload Prometheus if running
  try {
    await execa("curl", ["-sf", "-XPOST", `http://localhost:${ports.prometheus}/-/reload`], { stdio: "pipe" });
    promSpinner.succeed("Prometheus config updated and reloaded");
  } catch {
    promSpinner.succeed("Prometheus config updated (reload on next start)");
  }

  // Start the service
  console.log(chalk.dim(`Starting ${serviceName}...`));
  console.log();

  try {
    await execa("docker", ["compose", "up", "-d", "--build"], {
      cwd: serviceDir,
      stdio: "inherit",
    });
    console.log();
    console.log(chalk.green(`${serviceName} is running`));
  } catch (error) {
    const execError = toExecError(error);
    if (execError.stderr) {
      console.error(chalk.red(execError.stderr));
    }
    console.log(chalk.yellow("Service created but failed to start. Try:"));
    console.log(chalk.cyan(`  cd ${serviceDir}`));
    console.log(chalk.cyan("  docker compose up --build"));
  }

  console.log();
}

async function serviceUpAction(clientName: string, serviceName: string): Promise<void> {
  const clientDir = getClientDir(clientName);
  const serviceDir = path.join(clientDir, serviceName);

  try {
    await fs.access(path.join(serviceDir, "docker-compose.yaml"));
  } catch {
    console.error(chalk.red(`Service '${serviceName}' not found in client '${clientName}'`));
    process.exit(1);
  }

  await execa("docker", ["compose", "up", "-d"], { cwd: serviceDir, stdio: "inherit" });
  console.log(chalk.green(`${clientName}/${serviceName} is up`));
}

async function serviceDownAction(clientName: string, serviceName: string): Promise<void> {
  const clientDir = getClientDir(clientName);
  const serviceDir = path.join(clientDir, serviceName);

  try {
    await fs.access(path.join(serviceDir, "docker-compose.yaml"));
  } catch {
    console.error(chalk.red(`Service '${serviceName}' not found in client '${clientName}'`));
    process.exit(1);
  }

  await execa("docker", ["compose", "down"], { cwd: serviceDir, stdio: "inherit" });
  console.log(chalk.green(`${clientName}/${serviceName} is stopped`));
}

async function serviceLogsAction(clientName: string, serviceName: string): Promise<void> {
  const clientDir = getClientDir(clientName);
  const serviceDir = path.join(clientDir, serviceName);

  try {
    await fs.access(path.join(serviceDir, "docker-compose.yaml"));
  } catch {
    console.error(chalk.red(`Service '${serviceName}' not found in client '${clientName}'`));
    process.exit(1);
  }

  await execa("docker", ["compose", "logs", "-f", "--tail", "100"], {
    cwd: serviceDir,
    stdio: "inherit",
  });
}

// Generate a service docker-compose.yaml that joins the client's infra network
function generateServiceCompose(
  clientName: string,
  serviceName: string,
  backend: string,
  frontend: string | undefined,
  plugins: { type: string; instance: string }[],
): string {
  const hasLocalStack = plugins.some(p => p.type === "localstack");
  const dbUser = clientName.replace(/-/g, "_");

  let yaml = `networks:
  infra:
    external: true
    name: ${clientName}_infra

services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: ${serviceName}-backend
    networks:
      - infra
    environment:
      KAFKA_BOOTSTRAP_SERVERS: "kafka:9094"
      OTEL_SERVICE_NAME: "${serviceName}-backend"
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://jaeger:4318"
      OTEL_TRACES_EXPORTER: otlp
      JAVA_TOOL_OPTIONS: "-javaagent:/otel-agent.jar"
      DATABASE_URL: "jdbc:postgresql://postgres:5432/${serviceName.replace(/-/g, "_")}"
      DB_USERNAME: "${dbUser}"
      DB_PASSWORD: localdev`;

  if (hasLocalStack) {
    yaml += `
      AWS_ENDPOINT_URL: "http://localstack:4566"
      AWS_ACCESS_KEY_ID: test
      AWS_SECRET_ACCESS_KEY: test
      AWS_DEFAULT_REGION: us-east-1`;
  }

  yaml += `
    depends_on:
      kafka:
        condition: service_healthy
      jaeger:
        condition: service_healthy
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/actuator/health"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s`;

  if (frontend) {
    yaml += `

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: ${serviceName}-frontend
    networks:
      - infra
    depends_on:
      - backend
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost/ > /dev/null || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 30s`;
  }

  yaml += "\n";
  return yaml;
}

function appendServiceToClientConfig(content: string, serviceName: string): string {
  const serviceEntry = `  - name: ${serviceName}\n    path: ./${serviceName}`;

  // If services is empty (services: []), replace it
  if (/^services:\s*\[\]\s*$/m.test(content)) {
    return content.replace(/^services:\s*\[\]\s*$/m, `services:\n${serviceEntry}`);
  }

  // If services section exists, append to it
  if (/^services:/m.test(content)) {
    return content.trimEnd() + `\n${serviceEntry}\n`;
  }

  // Otherwise add services section
  return content.trimEnd() + `\n\nservices:\n${serviceEntry}\n`;
}

function parseExistingServices(content: string): { name: string; path: string }[] {
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
    if (line.length > 0 && !line.startsWith(" ") && !line.startsWith("\t")) break;

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

export const serviceCommand = new Command("service")
  .description("Manage services within a client environment");

serviceCommand
  .command("add")
  .description("Add a service to an existing client")
  .argument("<client>", "Client name")
  .argument("<service>", "Service name")
  .option("-b, --backend <backend>", "Backend framework (default: spring-boot)")
  .option("-f, --frontend <frontend>", "Frontend framework (e.g. react-vite)")
  .option("-p, --plugins <plugins>", "Comma-separated plugins (e.g. localstack,keycloak)")
  .action(serviceAddAction);

serviceCommand
  .command("up")
  .description("Start a service within a client")
  .argument("<client>", "Client name")
  .argument("<service>", "Service name")
  .action(serviceUpAction);

serviceCommand
  .command("down")
  .description("Stop a service within a client")
  .argument("<client>", "Client name")
  .argument("<service>", "Service name")
  .action(serviceDownAction);

serviceCommand
  .command("logs")
  .description("Stream logs for a service")
  .argument("<client>", "Client name")
  .argument("<service>", "Service name")
  .action(serviceLogsAction);
