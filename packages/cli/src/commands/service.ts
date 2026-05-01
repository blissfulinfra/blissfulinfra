import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { getClientDir, getClientPortBlock } from "../utils/client-registry.js";
import { copyTemplate, getAvailableTemplates, getAvailablePlugins, copyPlugin } from "../utils/template.js";
import { parsePluginSpecs, serializePluginSpecs } from "../utils/config.js";
import { generatePrometheusConfig, regenerateInfraCompose } from "../utils/infra-compose.js";
import { toExecError } from "../utils/errors.js";

const BACKEND_CHOICES = ["spring-boot", "fastapi", "express", "go-chi", "none"];
const FRONTEND_CHOICES = ["react-vite", "nextjs", "none"];
const PLUGIN_CHOICES = ["localstack", "keycloak", "ai-pipeline", "scraper", "agent-service", "gatling"];

interface ServiceAddOptions {
  backend?: string;
  frontend?: string;
  plugins?: string;
}

export async function serviceAddAction(clientName: string, serviceName: string, opts: ServiceAddOptions): Promise<void> {
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

  // Prompt for any field the user didn't pass via flag (when in a TTY)
  const isTty = !!process.stdout.isTTY;
  const promptQs: Array<Record<string, unknown>> = [];

  if (opts.backend === undefined && isTty) {
    promptQs.push({
      type: "list",
      name: "backend",
      message: "Backend framework",
      choices: BACKEND_CHOICES,
      default: "spring-boot",
    });
  }
  if (opts.frontend === undefined && isTty) {
    promptQs.push({
      type: "list",
      name: "frontend",
      message: "Frontend framework",
      choices: FRONTEND_CHOICES,
      default: "none",
    });
  }
  if (opts.plugins === undefined && isTty) {
    promptQs.push({
      type: "checkbox",
      name: "plugins",
      message: "Plugins (space to toggle)",
      choices: PLUGIN_CHOICES,
    });
  }

  const answers = (promptQs.length > 0
    ? await inquirer.prompt(promptQs as never)
    : {}) as { backend?: string; frontend?: string; plugins?: string[] };

  const backend = (opts.backend ?? answers.backend ?? "spring-boot") === "none"
    ? "none"
    : (opts.backend ?? answers.backend ?? "spring-boot");
  const rawFrontend = opts.frontend ?? answers.frontend;
  const frontend = (rawFrontend && rawFrontend !== "none") ? rawFrontend : undefined;
  const plugins = opts.plugins
    ? parsePluginSpecs(opts.plugins.split(",").map(p => p.trim()))
    : parsePluginSpecs(answers.plugins ?? []);

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
      // Init scripts (e.g. localstack/init/*.sh) must be executable for the
      // container to run them on ready. Node's fs.copyFile may strip the bit
      // on some platforms, so re-apply it here.
      await chmodInitScripts(pluginDir);
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

  // Update client config to include this service first so we can compute the
  // service's index for deterministic per-service port allocation.
  const clientConfigPath = path.join(clientDir, "blissful-infra.yaml");
  const clientConfig = await fs.readFile(clientConfigPath, "utf-8");
  const updatedConfig = appendServiceToClientConfig(clientConfig, serviceName);
  await fs.writeFile(clientConfigPath, updatedConfig);

  const allServicesPostAdd = parseExistingServices(updatedConfig);
  const serviceIndex = allServicesPostAdd.findIndex(s => s.name === serviceName);
  const servicePorts = computeServicePorts(ports.blockIndex, serviceIndex);

  // Generate service docker-compose.yaml joining the client's infra network
  const serviceCompose = generateServiceCompose(clientName, serviceName, backend, frontend, plugins, servicePorts);
  await fs.writeFile(path.join(serviceDir, "docker-compose.yaml"), serviceCompose);

  configSpinner.succeed("Service config written");

  // Update Prometheus scrape targets — use container_name so DNS resolves
  // across compose projects on the shared infra network.
  const promSpinner = ora("Updating Prometheus scrape config...").start();
  const targets = allServicesPostAdd.map(svc => ({
    name: `${clientName}-${svc.name}`,
    host: `${clientName}-${svc.name}-backend:8080`,
  }));
  await generatePrometheusConfig(clientDir, targets);

  // Reload Prometheus if running
  try {
    await execa("curl", ["-sf", "-XPOST", `http://localhost:${ports.prometheus}/-/reload`], { stdio: "pipe" });
    promSpinner.succeed("Prometheus config updated and reloaded");
  } catch {
    promSpinner.succeed("Prometheus config updated (reload on next start)");
  }

  // Regenerate the client's infra compose so it `include:`s this new service.
  // Then bring the unified project up — Compose will reconcile (add the new
  // service containers, leave existing ones running).
  await regenerateInfraCompose({ clientName, clientDir, ports });

  console.log(chalk.dim(`Starting ${serviceName} (via unified ${clientName} project)...`));
  console.log();

  try {
    await execa("docker", ["compose", "-f", "docker-compose.infra.yaml", "up", "-d", "--build"], {
      cwd: clientDir,
      stdio: "inherit",
    });
    console.log();
    console.log(chalk.green(`${serviceName} is running`));
    printServiceUrls(clientName, serviceName, frontend, servicePorts, plugins.some(p => p.type === "localstack"));
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

interface ServicePorts {
  backend: number;
  frontend: number;
  localstack: number;
}

function computeServicePorts(blockIndex: number, serviceIndex: number): ServicePorts {
  const base = 13000 + blockIndex * 100 + serviceIndex * 4;
  return { backend: base, frontend: base + 1, localstack: base + 2 };
}

function printServiceUrls(
  clientName: string,
  serviceName: string,
  frontend: string | undefined,
  ports: ServicePorts,
  hasLocalStack = false,
): void {
  console.log();
  console.log(chalk.dim(`  ${clientName}/${serviceName}`));
  console.log(chalk.dim("  Backend API: ") + chalk.cyan(`http://localhost:${ports.backend}`));
  if (frontend) {
    console.log(chalk.dim("  Frontend:    ") + chalk.cyan(`http://localhost:${ports.frontend}`));
  }
  if (hasLocalStack) {
    console.log(chalk.dim("  LocalStack:  ") + chalk.cyan(`http://localhost:${ports.localstack}`));
  }
}

function getServiceComposeKeys(serviceName: string, hasFrontend: boolean, hasLocalStack: boolean): string[] {
  const keys = [`${serviceName}-backend`];
  if (hasFrontend) keys.push(`${serviceName}-frontend`);
  if (hasLocalStack) keys.push(`${serviceName}-localstack`);
  return keys;
}

async function detectServiceFeatures(serviceDir: string): Promise<{ hasFrontend: boolean; hasLocalStack: boolean }> {
  try {
    const compose = await fs.readFile(path.join(serviceDir, "docker-compose.yaml"), "utf-8");
    return {
      hasFrontend: /-frontend:\s*$/m.test(compose),
      hasLocalStack: /-localstack:\s*$/m.test(compose),
    };
  } catch {
    return { hasFrontend: false, hasLocalStack: false };
  }
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

  const { hasFrontend, hasLocalStack } = await detectServiceFeatures(serviceDir);
  const keys = getServiceComposeKeys(serviceName, hasFrontend, hasLocalStack);

  await execa("docker", ["compose", "-f", "docker-compose.infra.yaml", "up", "-d", ...keys], {
    cwd: clientDir,
    stdio: "inherit",
  });
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

  const { hasFrontend, hasLocalStack } = await detectServiceFeatures(serviceDir);
  const keys = getServiceComposeKeys(serviceName, hasFrontend, hasLocalStack);

  await execa("docker", ["compose", "-f", "docker-compose.infra.yaml", "stop", ...keys], {
    cwd: clientDir,
    stdio: "inherit",
  });
  await execa("docker", ["compose", "-f", "docker-compose.infra.yaml", "rm", "-f", ...keys], {
    cwd: clientDir,
    stdio: "inherit",
  });
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

  const { hasFrontend, hasLocalStack } = await detectServiceFeatures(serviceDir);
  const keys = getServiceComposeKeys(serviceName, hasFrontend, hasLocalStack);

  await execa("docker", ["compose", "-f", "docker-compose.infra.yaml", "logs", "-f", "--tail", "100", ...keys], {
    cwd: clientDir,
    stdio: "inherit",
  });
}

// Generate a service docker-compose.yaml that joins the client's infra network
function generateServiceCompose(
  clientName: string,
  serviceName: string,
  _backend: string,
  frontend: string | undefined,
  plugins: { type: string; instance: string }[],
  ports: ServicePorts,
): string {
  const hasLocalStack = plugins.some(p => p.type === "localstack");
  const dbUser = clientName.replace(/-/g, "_");

  // This file is included by the client's docker-compose.infra.yaml via
  // `include:`, so all services + infra run as one Compose project named
  // after the client. Service keys are prefixed with the service name to
  // avoid collisions across multiple services in the same project. The
  // backend gets a network alias "backend" on the per-service internal
  // network so the React-Vite frontend's nginx (which proxies to
  // http://backend:8080/) keeps working without templating.
  const internalNet = `${serviceName}-internal`;
  const backendKey = `${serviceName}-backend`;
  const frontendKey = `${serviceName}-frontend`;
  const localstackKey = `${serviceName}-localstack`;

  // Note: do NOT mark \`infra\` as external here. This file is merged into the
  // parent client's compose project via \`include:\`, where the parent declares
  // \`infra\` as a non-external network. If the include declared external:true,
  // Compose's merge would inherit it and refuse to create the network — which
  // breaks every \`up\` until the network is manually created.
  let yaml = `networks:
  # Shared with the client's infra. Declared by the parent infra compose;
  # NOT external:true here, otherwise Compose's include merge inherits the
  # external flag and refuses to create the network.
  infra:
    name: ${clientName}_infra
  # Project-local per-service network for frontend <-> backend <-> localstack.
  ${internalNet}:
    driver: bridge

services:
  ${backendKey}:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: ${clientName}-${serviceName}-backend
    networks:
      ${internalNet}:
        aliases: [backend]
      infra: {}
    ports:
      - "${ports.backend}:8080"
    environment:
      KAFKA_BOOTSTRAP_SERVERS: "kafka:9094"
      OTEL_SERVICE_NAME: "${clientName}-${serviceName}-backend"
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://jaeger:4318"
      OTEL_TRACES_EXPORTER: otlp
      JAVA_TOOL_OPTIONS: "-javaagent:/otel-agent.jar"
      DATABASE_URL: "jdbc:postgresql://postgres:5432/${dbUser}"
      DB_USERNAME: "${dbUser}"
      DB_PASSWORD: localdev`;

  if (hasLocalStack) {
    yaml += `
      AWS_ENDPOINT_URL: "http://localstack:4566"
      AWS_PUBLIC_ENDPOINT_URL: "http://localhost:${ports.localstack}"
      AWS_ACCESS_KEY_ID: test
      AWS_SECRET_ACCESS_KEY: test
      AWS_DEFAULT_REGION: us-east-1`;
  }

  // depends_on works across all services in the same Compose project — that
  // includes the client's infra (kafka, postgres, jaeger) since we're now
  // unified via `include:`.
  yaml += `
    depends_on:
      kafka:
        condition: service_healthy
      postgres:
        condition: service_healthy`;

  if (hasLocalStack) {
    yaml += `
      ${localstackKey}:
        condition: service_healthy`;
  }

  yaml += `
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/actuator/health"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    restart: unless-stopped`;

  if (frontend) {
    yaml += `

  ${frontendKey}:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: ${clientName}-${serviceName}-frontend
    networks:
      - ${internalNet}
    ports:
      - "${ports.frontend}:80"
    depends_on:
      ${backendKey}:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost/ > /dev/null || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 30s`;
  }

  if (hasLocalStack) {
    // Find the localstack plugin instance — the init script lives at
    // <service>/<instance>/init relative to the service compose file.
    const localstackInstance = plugins.find(p => p.type === "localstack")?.instance ?? "localstack";

    yaml += `

  ${localstackKey}:
    image: localstack/localstack:3
    container_name: ${clientName}-${serviceName}-localstack
    networks:
      ${internalNet}:
        aliases: [localstack]
    ports:
      - "${ports.localstack}:4566"
    environment:
      SERVICES: "s3,sqs,dynamodb,sns,secretsmanager,lambda"
      DEFAULT_REGION: us-east-1
      LOCALSTACK_HOST: localstack
      # Allow browser preflight on presigned S3 URLs from any localhost frontend
      EXTRA_CORS_ALLOWED_ORIGINS: "*"
      EXTRA_CORS_ALLOWED_HEADERS: "*"
      DISABLE_CORS_CHECKS: "1"
    volumes:
      # Init scripts run when LocalStack is ready — creates buckets + sets CORS
      - ./${localstackInstance}/init:/etc/localstack/init/ready.d:ro
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:4566/_localstack/health"]
      interval: 5s
      timeout: 3s
      retries: 15
      start_period: 20s`;
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

async function chmodInitScripts(pluginDir: string): Promise<void> {
  const initDir = path.join(pluginDir, "init");
  try {
    const entries = await fs.readdir(initDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/\.(sh|bash)$/.test(entry.name)) continue;
      await fs.chmod(path.join(initDir, entry.name), 0o755);
    }
  } catch {
    // No init dir for this plugin — fine
  }
}
