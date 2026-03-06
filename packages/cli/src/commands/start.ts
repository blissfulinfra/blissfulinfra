import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { copyTemplate, copyPlugin, getAvailableTemplates, getAvailablePlugins } from "../utils/template.js";
import { checkPorts, getRequiredPorts } from "../utils/ports.js";
import { toExecError } from "../utils/errors.js";
import { parsePluginSpecs, serializePluginSpecs, type PluginInstance } from "../utils/config.js";
import { isJenkinsRunning, startJenkins, registerProjectWithJenkins } from "./jenkins.js";

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
}

const DEFAULTS = {
  backend: "spring-boot",
  frontend: "react-vite",
  database: "none",
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
    environment: {
      KAFKA_BOOTSTRAP_SERVERS: "kafka:9094",
      OTEL_SERVICE_NAME: `${name}-backend`,
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://jaeger:4317",
      OTEL_TRACES_EXPORTER: "otlp",
      JAVA_TOOL_OPTIONS: "-javaagent:/otel-agent.jar",
      ...(database === "postgres" || database === "postgres-redis"
        ? { DATABASE_URL: `postgresql://${name.replace(/-/g, "_")}:localdev@postgres:5432/${name.replace(/-/g, "_")}` }
        : {}),
      ...(database === "redis" || database === "postgres-redis"
        ? { REDIS_URL: "redis://redis:6379" }
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
  const backendPaths = [
    "/hello", "/health", "/ready", "/live", "/startup",
    "/echo", "/greetings", "/ws/", "/actuator",
  ];

  const locationBlocks = backendPaths
    .map((p) => `    location ${p} {\n        proxy_pass http://backend:8080;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }`)
    .join("\n\n");

  const wsBlock = `    location /ws/ {
        proxy_pass http://backend:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }`;

  const defaultLocation = `    location / {
        proxy_pass http://frontend:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }`;

  const serverBlock = `server {
    listen 80;
    server_name localhost;

${locationBlocks}

${wsBlock}

${defaultLocation}
}`;

  await fs.writeFile(path.join(projectDir, "nginx.conf"), serverBlock + "\n");
}

export const startCommand = new Command("start")
  .description("Create and run a fullstack app in one command")
  .argument("<name>", "Project name")
  .option("-b, --backend <backend>", `Backend framework (default: ${DEFAULTS.backend})`)
  .option("-f, --frontend <frontend>", `Frontend framework (default: ${DEFAULTS.frontend})`)
  .option("-d, --database <database>", `Database (none, postgres, redis, postgres-redis)`)
  .option("-l, --link", "Link to templates instead of copying (for template development)")
  .option("-p, --plugins <plugins>", "Comma-separated plugins (e.g. ai-pipeline)")
  .option("--no-monitoring", "Disable Prometheus + Grafana monitoring stack")
  .action(async (name: string, opts: StartOptions) => {
    console.log();
    console.log(chalk.bold("⚡ blissful-infra start"), chalk.dim("- Create and run fullstack app"));
    console.log();

    // Validate name
    if (!/^[a-z0-9-]+$/.test(name)) {
      console.error(chalk.red("Project name must be lowercase alphanumeric with hyphens"));
      process.exit(1);
    }

    // Check Docker first
    if (!(await checkDockerRunning())) {
      console.error(chalk.red("Docker is not running."));
      console.error(chalk.dim("Please start Docker and try again."));
      process.exit(1);
    }

    // Ensure Jenkins is running (shared CI/CD server)
    if (!(await isJenkinsRunning())) {
      console.log(chalk.dim("Starting Jenkins CI/CD server..."));
      await startJenkins({});
    }

    const backend = opts.backend || DEFAULTS.backend;
    const frontend = opts.frontend || DEFAULTS.frontend;
    const database = opts.database || DEFAULTS.database;
    const linkMode = opts.link || false;
    const plugins = opts.plugins ? parsePluginSpecs(opts.plugins.split(",").map(p => p.trim())) : [];
    const monitoring = opts.monitoring === false ? "default" : "prometheus";

    // Check for port conflicts before creating anything
    const requiredPorts = getRequiredPorts({ deployTarget: "local-only", name:"gg", type: "fullstack", database, plugins, monitoring });
    const portResults = await checkPorts(requiredPorts);
    const conflicts = portResults.filter((p) => p.inUse);

    if (conflicts.length > 0) {
      console.error(chalk.red("Port conflicts detected:"));
      for (const conflict of conflicts) {
        console.error(chalk.dim(`  • Port ${conflict.port} (${conflict.service}) is already in use`));
      }
      console.error();
      console.error(chalk.dim("Stop the conflicting services or use different ports."));
      process.exit(1);
    }

    const projectDir = path.resolve(process.cwd(), name);

    // Check if directory exists
    try {
      await fs.access(projectDir);
      console.error(chalk.red(`Directory ${name} already exists`));
      process.exit(1);
    } catch {
      // Good - doesn't exist
    }

    const availableTemplates = getAvailableTemplates();
    const availablePlugins = getAvailablePlugins();

    // Step 1: Scaffold
    const scaffoldSpinner = ora("Creating fullstack project...").start();

    await fs.mkdir(projectDir, { recursive: true });

    // Copy template files (link mode no longer symlinks — templates contain
    // conditional blocks like {{#IF_POSTGRES}} that must be processed)
    await fs.mkdir(path.join(projectDir, "backend"), { recursive: true });
    await fs.mkdir(path.join(projectDir, "frontend"), { recursive: true });

    // Copy backend
    if (availableTemplates.includes(backend)) {
      scaffoldSpinner.text = `Copying ${backend} backend...`;
      await copyTemplate(backend, path.join(projectDir, "backend"), {
        projectName: name,
        database,
        deployTarget: "local-only",
      });
    } else {
      scaffoldSpinner.warn(`Backend '${backend}' not yet available, using placeholder`);
      await fs.writeFile(path.join(projectDir, "backend", ".gitkeep"), `# ${backend} coming soon\n`);
    }

    // Copy frontend
    if (availableTemplates.includes(frontend)) {
      scaffoldSpinner.text = `Copying ${frontend} frontend...`;
      await copyTemplate(frontend, path.join(projectDir, "frontend"), {
        projectName: name,
        database,
        deployTarget: "local-only",
      });
    } else {
      scaffoldSpinner.warn(`Frontend '${frontend}' not yet available, using placeholder`);
      await fs.writeFile(path.join(projectDir, "frontend", ".gitkeep"), `# ${frontend} coming soon\n`);
    }

    // Copy plugin templates
    for (const plugin of plugins) {
      if (availablePlugins.includes(plugin.type)) {
        scaffoldSpinner.text = `Copying ${plugin.instance} plugin...`;
        const pluginDir = path.join(projectDir, plugin.instance);
        await fs.mkdir(pluginDir, { recursive: true });
        const index = plugins.filter(p => p.type === plugin.type).indexOf(plugin);
        await copyPlugin(plugin.type, pluginDir, {
          projectName: name,
          database,
          deployTarget: "local-only",
          instanceName: plugin.instance,
          apiPort: 8090 + index,
        });
      }
    }

    // Copy Loki config (always included)
    scaffoldSpinner.text = "Copying Loki config...";
    await copyTemplate("loki", path.join(projectDir, "loki"), {
      projectName: name,
      database,
      deployTarget: "local-only",
    });

    // Copy monitoring templates
    if (monitoring === "prometheus") {
      scaffoldSpinner.text = "Copying Prometheus + Grafana config...";
      await copyTemplate("prometheus", path.join(projectDir, "prometheus"), {
        projectName: name,
        database,
        deployTarget: "local-only",
      });
      await copyTemplate("grafana", path.join(projectDir, "grafana"), {
        projectName: name,
        database,
        deployTarget: "local-only",
      });
    }

    // Create config
    const configLines = [
      "# Blissful Infra Configuration",
      `name: ${name}`,
      "type: fullstack",
      `backend: ${backend}`,
      `frontend: ${frontend}`,
      `database: ${database}`,
      "deploy_target: local-only",
    ];
    if (monitoring === "default") {
      configLines.push("monitoring: default");
    }
    if (plugins.length > 0) {
      configLines.push(`plugins: ${serializePluginSpecs(plugins)}`);
    }
    await fs.writeFile(
      path.join(projectDir, "blissful-infra.yaml"),
      configLines.join("\n") + "\n"
    );

    // Create .gitignore
    await fs.writeFile(
      path.join(projectDir, ".gitignore"),
      `node_modules/
dist/
build/
.gradle/
target/
.idea/
.vscode/
.env
.env.local
.DS_Store
docker-compose.override.yaml
`
    );

    if (linkMode) {
      scaffoldSpinner.succeed(`Created ${name}/ (linked to templates)`);
    } else {
      scaffoldSpinner.succeed(`Created ${name}/`);
    }

    // Step 2: Generate docker-compose
    const composeSpinner = ora("Generating docker-compose.yaml...").start();
    await generateDockerCompose(projectDir, name, database, plugins, monitoring);
    composeSpinner.succeed("Generated docker-compose.yaml");

    // Step 3: Build dashboard image and start containers
    await ensureDashboardImage();
    const startSpinner = ora("Building and starting containers...").start();

    try {
      await execa("docker", ["compose", "up", "-d", "--build"], {
        cwd: projectDir,
        stdio: "pipe",
      });
      startSpinner.succeed("Containers started");

      // Register project with Jenkins (best-effort, non-fatal)
      try {
        await registerProjectWithJenkins(projectDir, name);
      } catch {
        console.log(chalk.dim("  (Jenkins registration skipped — run `blissful-infra jenkins add-project " + name + "` manually if needed)"));
      }
    } catch (error) {
      startSpinner.fail("Failed to start containers");
      const execError = toExecError(error);
      if (execError.stderr) {
        console.error(chalk.red(execError.stderr));
      }
      console.log();
      console.log(chalk.yellow("Project created but failed to start. Try:"));
      console.log(chalk.cyan(`  cd ${name}`));
      console.log(chalk.cyan("  docker compose up --build"));
      process.exit(1);
    }

    // Success!
    console.log();
    console.log(chalk.green.bold("✓ Your fullstack app is running!"));
    if (linkMode) {
      console.log(chalk.yellow("  (Link mode: editing templates will affect this project)"));
    }
    console.log();
    console.log(chalk.dim("  Frontend:    ") + chalk.cyan("http://localhost:3000"));
    console.log(chalk.dim("  Backend API: ") + chalk.cyan("http://localhost:8080"));
    console.log(chalk.dim("  Nginx:       ") + chalk.cyan("http://localhost"));
    console.log(chalk.dim("  Kafka:       ") + chalk.cyan("localhost:9092"));
    if (database === "postgres" || database === "postgres-redis") {
      console.log(chalk.dim("  PostgreSQL:  ") + chalk.cyan("localhost:5432"));
    }
    if (database === "redis" || database === "postgres-redis") {
      console.log(chalk.dim("  Redis:       ") + chalk.cyan("localhost:6379"));
    }
    const aiPipelinesOut = plugins.filter(p => p.type === "ai-pipeline");
    aiPipelinesOut.forEach((plugin, index) => {
      const port = 8090 + index;
      const label = aiPipelinesOut.length > 1 ? `AI Pipeline (${plugin.instance})` : "AI Pipeline";
      console.log(chalk.dim(`  ${label}: `.padEnd(16)) + chalk.cyan(`http://localhost:${port}`));
    });
    if (aiPipelinesOut.length > 0) {
      console.log(chalk.dim("  ClickHouse:  ") + chalk.cyan("http://localhost:8123"));
      console.log(chalk.dim("  MLflow:      ") + chalk.cyan("http://localhost:5001"));
      console.log(chalk.dim("  Mage:        ") + chalk.cyan("http://localhost:6789"));
    }
    const agentServicesOut = plugins.filter(p => p.type === "agent-service");
    agentServicesOut.forEach((plugin, index) => {
      const port = 8095 + index;
      const label = agentServicesOut.length > 1 ? `Agent (${plugin.instance})` : "Agent Service";
      console.log(chalk.dim(`  ${label}: `.padEnd(16)) + chalk.cyan(`http://localhost:${port}`));
    });
    console.log(chalk.dim("  Jaeger:      ") + chalk.cyan("http://localhost:16686"));
    console.log(chalk.dim("  Loki:        ") + chalk.cyan("http://localhost:3100"));
    if (monitoring === "prometheus") {
      console.log(chalk.dim("  Prometheus:  ") + chalk.cyan("http://localhost:9090"));
      console.log(chalk.dim("  Grafana:     ") + chalk.cyan("http://localhost:3001"));
    }
    console.log(chalk.dim("  Jenkins:     ") + chalk.cyan("http://localhost:8081"));
    console.log(chalk.dim("  Registry:    ") + chalk.cyan("localhost:5050"));
    console.log(chalk.dim("  Dashboard:   ") + chalk.cyan("http://localhost:3002"));
    console.log();

    // Open browser tabs
    await openBrowser("http://localhost:3000");
    await openBrowser("http://localhost:3002");

    console.log(chalk.dim("Commands:"));
    console.log(chalk.dim("  cd ") + chalk.cyan(name));
    console.log(chalk.dim("  blissful-infra logs     ") + chalk.dim("# View logs"));
    console.log(chalk.dim("  blissful-infra dev      ") + chalk.dim("# Hot reload mode"));
    console.log(chalk.dim("  blissful-infra down     ") + chalk.dim("# Stop everything"));
    console.log();
  });
