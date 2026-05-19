import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { copyTemplate, copyPlugin, getAvailableTemplates, getAvailablePlugins } from "../utils/template.js";
import { checkPorts, getRequiredPorts } from "../utils/ports.js";
import { toExecError } from "../utils/errors.js";
import { parsePluginSpecs, serializePluginSpecs, loadConfig, type PluginInstance } from "../utils/config.js";
import { isJenkinsRunning, startJenkins, registerProjectWithJenkins } from "./jenkins.js";
import { runCodegen } from "../codegen/index.js";
import { serviceAddAction } from "./service.js";
import { clientCreateAction } from "./client.js";
import { getClientDir, listClients } from "../utils/client-registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..", "..", "..");

async function ensureDashboardImage(): Promise<void> {
  try {
    await execa("docker", ["image", "inspect", "blissful-infra-dashboard:latest"], { stdio: "pipe" });
  } catch {
    const spinner = ora("Building dashboard image (first time only)...").start();
    try {
      await execa("docker", [
        "build", "-f", "Dockerfile.dashboard",
        "-t", "blissful-infra-dashboard:latest", ".",
      ], { cwd: REPO_ROOT, stdio: "pipe" });
      spinner.succeed("Dashboard image built");
    } catch (error) {
      spinner.fail("Failed to build dashboard image");
      const execError = toExecError(error);
      if (execError.stderr) {
        console.error(chalk.dim(execError.stderr));
      }
      throw error;
    }
  }
}

interface StartOptions {
  backend?: string;
  frontend?: string;
  database?: string;
  link?: boolean;
  plugins?: string;
  monitoring?: boolean;
  deployTarget?: string;
  client?: string;
  yes?: boolean;
}

const DEFAULTS = {
  backend: "spring-boot",
  frontend: "react-vite",
  database: "postgres",
};

async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  try {
    await execa(cmd, [url], { stdio: "pipe" });
  } catch {
    // Silently ignore if browser can't be opened
  }
}

async function checkDockerRunning(): Promise<boolean> {
  try {
    await execa("docker", ["info"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export async function generateDockerCompose(projectDir: string, name: string, database: string, plugins: PluginInstance[] = [], monitoring = "default"): Promise<void> {
  const services: Record<string, unknown> = {};
  const hasLocalStack = plugins.some(p => p.type === "localstack");

  // Kafka service
  services.kafka = {
    image: "apache/kafka:3.7.0",
    container_name: `${name}-kafka`,
    hostname: "kafka",
    ports: ["9092:9092", "9094:9094"],
    environment: {
      KAFKA_NODE_ID: 1,
      KAFKA_PROCESS_ROLES: "broker,controller",
      KAFKA_LISTENERS: "PLAINTEXT://0.0.0.0:9094,CONTROLLER://0.0.0.0:9093,EXTERNAL://0.0.0.0:9092",
      KAFKA_ADVERTISED_LISTENERS: "PLAINTEXT://kafka:9094,EXTERNAL://localhost:9092",
      KAFKA_CONTROLLER_QUORUM_VOTERS: "1@kafka:9093",
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: "CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,EXTERNAL:PLAINTEXT",
      KAFKA_CONTROLLER_LISTENER_NAMES: "CONTROLLER",
      KAFKA_INTER_BROKER_LISTENER_NAME: "PLAINTEXT",
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1,
      CLUSTER_ID: "blissful-infra-kafka-cluster",
    },
    healthcheck: {
      test: ["CMD-SHELL", "/opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server kafka:9094 || exit 1"],
      interval: "10s",
      timeout: "10s",
      retries: 10,
      start_period: "30s",
    },
  };

  // PostgreSQL
  if (database === "postgres" || database === "postgres-redis") {
    services.postgres = {
      image: "postgres:16-alpine",
      container_name: `${name}-postgres`,
      ports: ["5432:5432"],
      environment: {
        POSTGRES_USER: name.replace(/-/g, "_"),
        POSTGRES_PASSWORD: "localdev",
        POSTGRES_DB: name.replace(/-/g, "_"),
      },
      volumes: [`${name}-postgres-data:/var/lib/postgresql/data`],
      healthcheck: {
        test: ["CMD-SHELL", `pg_isready -U ${name.replace(/-/g, "_")}`],
        interval: "5s",
        timeout: "3s",
        retries: 5,
      },
    };
  }

  // Redis
  if (database === "redis" || database === "postgres-redis") {
    services.redis = {
      image: "redis:7-alpine",
      container_name: `${name}-redis`,
      ports: ["6379:6379"],
      healthcheck: {
        test: ["CMD", "redis-cli", "ping"],
        interval: "5s",
        timeout: "3s",
        retries: 5,
      },
    };
  }

  // Backend app
  services.backend = {
    build: {
      context: "./backend",
      dockerfile: "Dockerfile",
    },
    container_name: `${name}-backend`,
    ports: ["8080:8080"],
    healthcheck: {
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/actuator/health"],
      interval: "10s",
      timeout: "5s",
      retries: 5,
      start_period: "30s",
    },
    environment: {
      KAFKA_BOOTSTRAP_SERVERS: "kafka:9094",
      OTEL_SERVICE_NAME: `${name}-backend`,
      // Port 4318 = OTLP/HTTP (default for OTel Java agent v2.x)
      // Port 4317 = OTLP/gRPC — do NOT use with the HTTP exporter
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://jaeger:4318",
      OTEL_TRACES_EXPORTER: "otlp",
      JAVA_TOOL_OPTIONS: "-javaagent:/otel-agent.jar",
      ...(database === "postgres" || database === "postgres-redis"
        ? {
            DATABASE_URL: `jdbc:postgresql://postgres:5432/${name.replace(/-/g, "_")}`,
            DB_USERNAME: name.replace(/-/g, "_"),
            DB_PASSWORD: "localdev",
          }
        : {}),
      ...(database === "redis" || database === "postgres-redis"
        ? { REDIS_URL: "redis://redis:6379" }
        : {}),
      ...(hasLocalStack
        ? {
            AWS_ENDPOINT_URL: "http://localstack:4566",
            AWS_ACCESS_KEY_ID: "test",
            AWS_SECRET_ACCESS_KEY: "test",
            AWS_DEFAULT_REGION: "us-east-1",
          }
        : {}),
    },
    depends_on: {
      kafka: { condition: "service_healthy" },
      jaeger: { condition: "service_healthy" },
      ...(database === "postgres" || database === "postgres-redis"
        ? { postgres: { condition: "service_healthy" } }
        : {}),
      ...(database === "redis" || database === "postgres-redis"
        ? { redis: { condition: "service_healthy" } }
        : {}),
      ...(hasLocalStack
        ? { localstack: { condition: "service_healthy" } }
        : {}),
    },
  };

  // Frontend
  services.frontend = {
    build: {
      context: "./frontend",
      dockerfile: "Dockerfile",
    },
    container_name: `${name}-frontend`,
    ports: ["3000:80"],
    depends_on: ["backend"],
    healthcheck: {
      test: ["CMD-SHELL", "curl -sf http://localhost/ > /dev/null || exit 1"],
      interval: "10s",
      timeout: "5s",
      retries: 3,
      start_period: "30s",
    },
  };

  // Nginx reverse proxy
  services.nginx = {
    image: "nginx:alpine",
    container_name: `${name}-nginx`,
    ports: ["80:80"],
    volumes: ["./nginx.conf:/etc/nginx/conf.d/default.conf:ro"],
    depends_on: ["backend", "frontend"],
  };

  // Generate nginx.conf
  await generateNginxConf(projectDir);

  // AI Pipeline plugins + data platform stack (ClickHouse, MLflow, Mage)
  const aiPipelines = plugins.filter(p => p.type === "ai-pipeline");
  if (aiPipelines.length > 0) {
    // ClickHouse — columnar OLAP store for predictions at scale
    services.clickhouse = {
      image: "clickhouse/clickhouse-server:24.3",
      container_name: `${name}-clickhouse`,
      ports: ["8123:8123"],
      environment: {
        CLICKHOUSE_DB: "pipeline_db",
        CLICKHOUSE_USER: "default",
        CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: "1",
      },
      volumes: [`${name}-clickhouse-data:/var/lib/clickhouse`],
      healthcheck: {
        test: ["CMD", "wget", "--spider", "-q", "http://localhost:8123/ping"],
        interval: "10s",
        timeout: "5s",
        retries: 5,
        start_period: "20s",
      },
    };

    // MLflow — experiment tracking + model registry
    services.mlflow = {
      image: "ghcr.io/mlflow/mlflow:v2.13.0",
      container_name: `${name}-mlflow`,
      ports: ["5001:5000"],
      command: [
        "mlflow", "server",
        "--host", "0.0.0.0",
        "--port", "5000",
        "--backend-store-uri", "sqlite:///mlflow/mlflow.db",
        "--default-artifact-root", "/mlflow/artifacts",
      ],
      volumes: [`${name}-mlflow-data:/mlflow`],
      healthcheck: {
        test: ["CMD-SHELL", "python -c 'import socket; socket.create_connection((\"localhost\", 5000), 3)' || exit 1"],
        interval: "10s",
        timeout: "10s",
        retries: 10,
        start_period: "30s",
      },
    };

    // Mage — visual data pipeline orchestrator
    services.mage = {
      image: "mageai/mageai:latest",
      container_name: `${name}-mage`,
      ports: ["6789:6789"],
      environment: {
        PROJECT_NAME: `${name}_pipelines`,
        MAGE_DATA_DIR: "/home/src",
      },
      volumes: [`${name}-mage-data:/home/src`],
      healthcheck: {
        test: ["CMD", "wget", "--spider", "-q", "http://localhost:6789/"],
        interval: "15s",
        timeout: "10s",
        retries: 5,
        start_period: "30s",
      },
    };
  }

  aiPipelines.forEach((plugin, index) => {
    const port = 8090 + index;
    services[plugin.instance] = {
      build: {
        context: `./${plugin.instance}`,
        dockerfile: "Dockerfile",
      },
      container_name: `${name}-${plugin.instance}`,
      ports: [`${port}:${port}`],
      environment: {
        PROJECT_NAME: name,
        INSTANCE_NAME: plugin.instance,
        KAFKA_BOOTSTRAP_SERVERS: "kafka:9094",
        PIPELINE_MODE: "streaming",
        SPARK_MASTER: "local[*]",
        API_PORT: String(port),
        EVENTS_TOPIC: "events",
        PREDICTIONS_TOPIC: aiPipelines.length > 1 ? `predictions-${plugin.instance}` : "predictions",
        MLFLOW_TRACKING_URI: "http://mlflow:5000",
        MLFLOW_EXPERIMENT: `${name}-pipeline`,
        CLICKHOUSE_HOST: "clickhouse",
        CLICKHOUSE_PORT: "8123",
        CLICKHOUSE_DB: "pipeline_db",
      },
      depends_on: {
        kafka: { condition: "service_healthy" },
        clickhouse: { condition: "service_healthy" },
        mlflow: { condition: "service_healthy" },
      },
    };
  });

  // Agent service plugins
  const agentServices = plugins.filter(p => p.type === "agent-service");
  agentServices.forEach((plugin, index) => {
    const port = 8095 + index;
    services[plugin.instance] = {
      build: {
        context: `./${plugin.instance}`,
        dockerfile: "Dockerfile",
      },
      container_name: `${name}-${plugin.instance}`,
      ports: [`${port}:${port}`],
      environment: {
        PROJECT_NAME: name,
        INSTANCE_NAME: plugin.instance,
        API_PORT: String(port),
        ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY:-}",
        AI_PROVIDER: "${AI_PROVIDER:-claude}",
        AI_MODEL: "${AI_MODEL:-claude-sonnet-4-20250514}",
        WORKSPACE_DIR: "/workspace",
        STATE_DIR: "/data/agent-state",
      },
      volumes: [
        ".:/workspace:rw",
        `${name}-agent-state:/data/agent-state`,
      ],
    };
  });

  // Keycloak plugins (OAuth2/OIDC IAM server)
  const keycloaks = plugins.filter(p => p.type === "keycloak");
  keycloaks.forEach((plugin, index) => {
    const port = 8001 + index;
    services[plugin.instance] = {
      image: "quay.io/keycloak/keycloak:24.0",
      container_name: `${name}-${plugin.instance}`,
      ports: [`${port}:8080`],
      environment: {
        KEYCLOAK_ADMIN: "admin",
        KEYCLOAK_ADMIN_PASSWORD: "admin",
        KC_DB: "dev-file",
      },
      volumes: [
        `./${plugin.instance}/keycloak-realm.json:/opt/keycloak/data/import/realm.json:ro`,
      ],
      command: ["start-dev", "--import-realm"],
      healthcheck: {
        test: ["CMD", "curl", "-sf", "http://localhost:8080/health/ready"],
        interval: "15s",
        timeout: "10s",
        retries: 10,
        start_period: "45s",
      },
    };
  });

  // LocalStack — AWS cloud service emulator
  const localStacks = plugins.filter(p => p.type === "localstack");
  localStacks.forEach((plugin) => {
    services[plugin.instance] = {
      image: "localstack/localstack:3",
      container_name: `${name}-localstack`,
      ports: ["4566:4566"],
      environment: {
        SERVICES: "s3,sqs,dynamodb,sns,secretsmanager,lambda",
        DEFAULT_REGION: "us-east-1",
        DOCKER_HOST: "unix:///var/run/docker.sock",
        LOCALSTACK_HOST: "localstack",
      },
      volumes: [
        `./${plugin.instance}/init:/etc/localstack/init/ready.d`,
        "/var/run/docker.sock:/var/run/docker.sock",
        `${name}-localstack-data:/var/lib/localstack`,
      ],
      healthcheck: {
        test: ["CMD", "curl", "-sf", "http://localhost:4566/_localstack/health"],
        interval: "5s",
        timeout: "3s",
        retries: 15,
        start_period: "20s",
      },
    };
  });

  // Scraper plugins (Scrapy-based web scrapers → Kafka)
  const scrapers = plugins.filter(p => p.type === "scraper");
  scrapers.forEach((plugin) => {
    services[plugin.instance] = {
      build: {
        context: `./${plugin.instance}`,
        dockerfile: "Dockerfile",
      },
      container_name: `${name}-${plugin.instance}`,
      environment: {
        KAFKA_BOOTSTRAP_SERVERS: "kafka:9094",
        SCRAPED_TOPIC: "scraped-articles",
        SCRAPE_INTERVAL_MINUTES: "15",
      },
      depends_on: { kafka: { condition: "service_healthy" } },
      restart: "unless-stopped",
    };
  });

  // Jaeger — always-on distributed tracing
  services.jaeger = {
    image: "jaegertracing/all-in-one:1.57",
    container_name: `${name}-jaeger`,
    ports: ["16686:16686"],
    environment: { COLLECTOR_OTLP_ENABLED: "true" },
    healthcheck: {
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:16686/"],
      interval: "10s",
      timeout: "5s",
      retries: 3,
      start_period: "10s",
    },
  };

  // Loki + Promtail — always-on log aggregation
  services.loki = {
    image: "grafana/loki:3.0.0",
    container_name: `${name}-loki`,
    ports: ["3100:3100"],
    volumes: [
      "./loki/loki-config.yaml:/etc/loki/local-config.yaml:ro",
      `${name}-loki-data:/loki`,
    ],
    command: ["-config.file=/etc/loki/local-config.yaml"],
    healthcheck: {
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3100/ready"],
      interval: "10s",
      timeout: "5s",
      retries: 5,
      start_period: "15s",
    },
  };

  services.promtail = {
    image: "grafana/promtail:3.0.0",
    container_name: `${name}-promtail`,
    volumes: [
      "./loki/promtail-config.yaml:/etc/promtail/config.yaml:ro",
      "/var/run/docker.sock:/var/run/docker.sock",
    ],
    command: ["-config.file=/etc/promtail/config.yaml"],
    depends_on: {
      loki: { condition: "service_healthy" },
    },
  };

  // Prometheus + Grafana (opt-in monitoring stack)
  if (monitoring === "prometheus") {
    services.prometheus = {
      image: "prom/prometheus:v2.51.0",
      container_name: `${name}-prometheus`,
      ports: ["9090:9090"],
      volumes: [
        "./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro",
        `${name}-prometheus-data:/prometheus`,
      ],
      command: [
        "--config.file=/etc/prometheus/prometheus.yml",
        "--storage.tsdb.retention.time=15d",
        "--web.enable-lifecycle",
      ],
      healthcheck: {
        test: ["CMD", "wget", "--spider", "-q", "http://localhost:9090/-/healthy"],
        interval: "10s",
        timeout: "5s",
        retries: 3,
      },
    };

    services.grafana = {
      image: "grafana/grafana:11.0.0",
      container_name: `${name}-grafana`,
      ports: ["3001:3000"],
      environment: {
        GF_AUTH_ANONYMOUS_ENABLED: "true",
        GF_AUTH_ANONYMOUS_ORG_ROLE: "Admin",
        GF_AUTH_DISABLE_LOGIN_FORM: "true",
      },
      volumes: [
        "./grafana/provisioning:/etc/grafana/provisioning:ro",
        "./grafana/dashboards:/var/lib/grafana/dashboards:ro",
        `${name}-grafana-data:/var/lib/grafana`,
      ],
      depends_on: {
        prometheus: { condition: "service_healthy" },
        loki: { condition: "service_healthy" },
      },
      healthcheck: {
        test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000/api/health"],
        interval: "10s",
        timeout: "5s",
        retries: 3,
      },
    };
  }

  // Dashboard service
  services.dashboard = {
    image: "blissful-infra-dashboard:latest",
    container_name: `${name}-dashboard`,
    ports: ["3002:3002"],
    environment: {
      PROJECTS_DIR: "/projects",
      DASHBOARD_DIST_DIR: "/app/dashboard-dist",
      DASHBOARD_PORT: "3002",
      DOCKER_MODE: "true",
    },
    volumes: [
      "/var/run/docker.sock:/var/run/docker.sock",
      `.:/projects/${name}`,
    ],
  };

  // Build volumes object
  const volumes: Record<string, null> = {};
  if (database === "postgres" || database === "postgres-redis") {
    volumes[`${name}-postgres-data`] = null;
  }
  if (agentServices.length > 0) {
    volumes[`${name}-agent-state`] = null;
  }
  volumes[`${name}-loki-data`] = null;
  if (monitoring === "prometheus") {
    volumes[`${name}-prometheus-data`] = null;
    volumes[`${name}-grafana-data`] = null;
  }
  if (aiPipelines.length > 0) {
    volumes[`${name}-clickhouse-data`] = null;
    volumes[`${name}-mlflow-data`] = null;
    volumes[`${name}-mage-data`] = null;
  }
  if (localStacks.length > 0) {
    volumes[`${name}-localstack-data`] = null;
  }

  const compose: Record<string, unknown> = { services };
  if (Object.keys(volumes).length > 0) {
    compose.volumes = volumes;
  }

  const yaml = generateYaml(compose);
  await fs.writeFile(path.join(projectDir, "docker-compose.yaml"), yaml);
}

function generateYaml(obj: unknown, indent = 0): string {
  const spaces = "  ".repeat(indent);

  if (obj === null) return "";
  if (obj === undefined) return "null";

  if (typeof obj === "string") {
    if (obj.includes(":") || obj.includes("#") || obj.startsWith("$") || /^\d+$/.test(obj) || obj.includes('"')) {
      return `"${obj.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
    return obj;
  }

  if (typeof obj === "number" || typeof obj === "boolean") {
    return String(obj);
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return obj.map((item) => `${spaces}- ${generateYaml(item, indent + 1).trimStart()}`).join("\n");
  }

  if (typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return "{}";

    return entries
      .map(([key, value]) => {
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          return `${spaces}${key}:\n${generateYaml(value, indent + 1)}`;
        }
        if (Array.isArray(value)) {
          return `${spaces}${key}:\n${generateYaml(value, indent + 1)}`;
        }
        return `${spaces}${key}: ${generateYaml(value, indent)}`;
      })
      .join("\n");
  }

  return String(obj);
}

async function generateNginxConf(projectDir: string): Promise<void> {
  const serverBlock = `server {
    listen 80;
    server_name localhost;

    client_max_body_size 100m;

    location /api/ {
        proxy_pass http://backend:8080/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # SSE support
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
    }

    location /ws/ {
        proxy_pass http://backend:8080/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    location / {
        proxy_pass http://frontend:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}`;

  await fs.writeFile(path.join(projectDir, "nginx.conf"), serverBlock + "\n");
}

export const startCommand = new Command("start")
  .description("Create and run a fullstack app in one command")
  .argument("<name>", "Project name")
  .option("-b, --backend <backend>", `Backend framework (default: ${DEFAULTS.backend})`)
  .option("-f, --frontend <frontend>", `Frontend framework (default: ${DEFAULTS.frontend})`)
  .option("-d, --database <database>", `Database (none, postgres, redis, postgres-redis) (default: postgres)`)
  .option("-l, --link", "Link to templates instead of copying (for template development)")
  .option("-p, --plugins <plugins>", "Comma-separated plugins (e.g. ai-pipeline)")
  .option("--no-monitoring", "Disable Prometheus + Grafana monitoring stack")
  .option("--deploy-target <target>", "Cloud deploy target: cloudflare, vercel, aws (default: local-only)")
  .option("-c, --client <client>", "Client to add this service to (skips the prompt)")
  .option("-y, --yes", "Skip prompts; accept defaults for new client infra")
  .action(async (name: string, opts: StartOptions) => {
    console.log();
    console.log(chalk.bold("⚡ blissful-infra start"), chalk.cyan(name));
    console.log();

    if (!/^[a-z0-9-]+$/.test(name)) {
      console.error(chalk.red("Service name must be lowercase alphanumeric with hyphens"));
      process.exit(1);
    }

    // Determine which client to use
    let clientName: string;
    const existingClients = await listClients();

    if (opts.client) {
      clientName = opts.client;
    } else if (existingClients.length === 0) {
      console.log(chalk.dim("No client environments found. A client is needed to hold your services."));
      console.log();
      const { newName } = await inquirer.prompt([
        {
          type: "input",
          name: "newName",
          message: "Name for new client environment:",
          default: "dev",
          validate: (v: string) => /^[a-z0-9-]+$/.test(v) || "Lowercase alphanumeric and hyphens only",
        },
      ] as never) as { newName: string };
      clientName = newName;
    } else {
      const { selected } = await inquirer.prompt([
        {
          type: "list",
          name: "selected",
          message: "Add to which client?",
          choices: [
            ...existingClients.map(c => ({ name: c.clientName, value: c.clientName })),
            { name: "Create new client...", value: "__new__" },
          ],
        },
      ] as never) as { selected: string };

      if (selected === "__new__") {
        const { newName } = await inquirer.prompt([
          {
            type: "input",
            name: "newName",
            message: "Name for new client environment:",
            default: "dev",
            validate: (v: string) => /^[a-z0-9-]+$/.test(v) || "Lowercase alphanumeric and hyphens only",
          },
        ] as never) as { newName: string };
        clientName = newName;
      } else {
        clientName = selected;
      }
    }

    // Create the client if it doesn't exist yet
    const clientDir = getClientDir(clientName);
    let clientExists = false;
    try {
      await fs.access(clientDir);
      clientExists = true;
    } catch { /* doesn't exist */ }

    if (!clientExists) {
      await clientCreateAction(clientName, { yes: opts.yes });
    }

    // Add the service
    await serviceAddAction(clientName, name, {
      backend: opts.backend,
      frontend: opts.frontend,
      plugins: opts.plugins,
      yes: opts.yes,
    });
  });



