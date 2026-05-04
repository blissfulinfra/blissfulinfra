import fs from "node:fs/promises";
import path from "node:path";
import type { ClientConfig, PortBlock } from "@blissful-infra/shared";

export interface ParsedClientConfig {
  infrastructure: NonNullable<ClientConfig["infrastructure"]>;
  serviceRefs: { name: string; path: string }[];
}

/**
 * Minimal parser for the client's blissful-infra.yaml — extracts the
 * infrastructure block and the services list. Used by `service add/down`
 * to regenerate the infra compose with the correct include list.
 */
export function parseClientConfigYaml(content: string): ParsedClientConfig {
  // Match flags at top level vs nested under observability:. The new
  // promoted-to-client-level flags (clickhouse/localstack/keycloak/mlflow/mage)
  // appear at the infrastructure root.
  const matchTopLevel = (key: string) =>
    new RegExp(`^  ${key}:\\s*true\\s*$`, "m").test(content);
  const infra: NonNullable<ClientConfig["infrastructure"]> = {
    kafka:      matchTopLevel("kafka")      || /kafka:\s*true/.test(content),
    postgres:   matchTopLevel("postgres")   || /postgres:\s*true/.test(content),
    jenkins:    matchTopLevel("jenkins")    || /jenkins:\s*true/.test(content),
    clickhouse: matchTopLevel("clickhouse"),
    localstack: matchTopLevel("localstack"),
    keycloak:   matchTopLevel("keycloak"),
    mlflow:     matchTopLevel("mlflow"),
    mage:       matchTopLevel("mage"),
    observability: {
      prometheus: /prometheus:\s*true/.test(content),
      grafana:    /grafana:\s*true/.test(content),
      jaeger:     /jaeger:\s*true/.test(content),
      loki:       /loki:\s*true/.test(content),
      clickhouse: /clickhouse:\s*true/.test(content),
    },
  };

  const refs: { name: string; path: string }[] = [];
  const lines = content.split("\n");
  let inServices = false;
  let current: Partial<{ name: string; path: string }> = {};
  for (const line of lines) {
    if (/^services:/.test(line)) { inServices = true; continue; }
    if (!inServices) continue;
    if (line.length > 0 && !/^\s/.test(line)) break;
    const nameMatch = line.match(/^\s+-\s+name:\s*(.+)$/);
    if (nameMatch) {
      if (current.name && current.path) refs.push(current as { name: string; path: string });
      current = { name: nameMatch[1].trim() };
      continue;
    }
    const pathMatch = line.match(/^\s+path:\s*(.+)$/);
    if (pathMatch) current.path = pathMatch[1].trim();
  }
  if (current.name && current.path) refs.push(current as { name: string; path: string });

  return { infrastructure: infra, serviceRefs: refs };
}

/**
 * Regenerate `docker-compose.infra.yaml` from the client's current state on
 * disk. Call this whenever the services list changes (add/remove).
 */
export async function regenerateInfraCompose(opts: { clientName: string; clientDir: string; ports: PortBlock }): Promise<void> {
  const { clientName, clientDir, ports } = opts;
  const configPath = path.join(clientDir, "blissful-infra.yaml");
  const content = await fs.readFile(configPath, "utf-8");
  const parsed = parseClientConfigYaml(content);
  const serviceIncludes = parsed.serviceRefs.map(s => `${s.path}/docker-compose.yaml`);
  await generateInfraCompose({ clientName, clientDir, ports, infrastructure: parsed.infrastructure, serviceIncludes });
}

interface InfraComposeOptions {
  clientName: string;
  clientDir: string;
  ports: PortBlock;
  infrastructure: NonNullable<ClientConfig["infrastructure"]>;
  /** Service paths (relative to clientDir) to include into the unified Compose project. */
  serviceIncludes?: string[];
}

export async function generateInfraCompose(opts: InfraComposeOptions): Promise<void> {
  const { clientName, clientDir, ports, infrastructure, serviceIncludes = [] } = opts;
  const obs = infrastructure.observability ?? {
    prometheus: true,
    grafana: true,
    jaeger: true,
    loki: true,
    clickhouse: false,
  };

  const services: Record<string, unknown> = {};
  const volumes: Record<string, null> = {};

  // Kafka
  if (infrastructure.kafka) {
    services.kafka = {
      image: "apache/kafka:3.7.0",
      container_name: `${clientName}-kafka`,
      hostname: "kafka",
      ports: [`${ports.kafka}:9094`],
      networks: ["infra"],
      // Pin "kafka" to loopback so the controller can self-resolve before
      // Docker's embedded DNS has registered the service. Single-node KRaft
      // kafka starts fast enough to lose that race under load — see commit
      // history for the integration-test failure that motivated this.
      extra_hosts: ["kafka:127.0.0.1"],
      environment: {
        KAFKA_NODE_ID: 1,
        KAFKA_PROCESS_ROLES: "broker,controller",
        KAFKA_LISTENERS: "PLAINTEXT://0.0.0.0:9094,CONTROLLER://0.0.0.0:9093",
        KAFKA_ADVERTISED_LISTENERS: `PLAINTEXT://kafka:9094`,
        KAFKA_CONTROLLER_QUORUM_VOTERS: "1@kafka:9093",
        KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: "CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT",
        KAFKA_CONTROLLER_LISTENER_NAMES: "CONTROLLER",
        KAFKA_INTER_BROKER_LISTENER_NAME: "PLAINTEXT",
        KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1,
        CLUSTER_ID: `blissful-${clientName}-kafka`,
      },
      healthcheck: {
        test: ["CMD-SHELL", "/opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server kafka:9094 || exit 1"],
        interval: "10s",
        timeout: "10s",
        retries: 10,
        start_period: "30s",
      },
    };
  }

  // Postgres
  if (infrastructure.postgres) {
    const dbUser = clientName.replace(/-/g, "_");
    services.postgres = {
      image: "postgres:16-alpine",
      container_name: `${clientName}-postgres`,
      ports: [`${ports.postgres}:5432`],
      networks: ["infra"],
      environment: {
        POSTGRES_USER: dbUser,
        POSTGRES_PASSWORD: "localdev",
        POSTGRES_DB: dbUser,
      },
      volumes: [`postgres-data:/var/lib/postgresql/data`],
      healthcheck: {
        test: ["CMD-SHELL", `pg_isready -U ${dbUser}`],
        interval: "5s",
        timeout: "3s",
        retries: 5,
      },
    };
    volumes["postgres-data"] = null;
  }

  // Jenkins
  if (infrastructure.jenkins) {
    services.jenkins = {
      image: "blissful-jenkins:latest",
      container_name: `${clientName}-jenkins`,
      ports: [`${ports.jenkins}:8080`],
      networks: ["infra"],
      volumes: [`jenkins-data:/var/jenkins_home`],
      healthcheck: {
        test: ["CMD", "curl", "-sf", "http://localhost:8080/login"],
        interval: "15s",
        timeout: "10s",
        retries: 10,
        start_period: "60s",
      },
    };
    volumes["jenkins-data"] = null;
  }

  // Jaeger
  if (obs.jaeger) {
    services.jaeger = {
      image: "jaegertracing/all-in-one:1.57",
      container_name: `${clientName}-jaeger`,
      ports: [`${ports.jaeger}:16686`],
      networks: ["infra"],
      environment: { COLLECTOR_OTLP_ENABLED: "true" },
      healthcheck: {
        test: ["CMD", "wget", "--spider", "-q", "http://localhost:16686/"],
        interval: "10s",
        timeout: "5s",
        retries: 3,
        start_period: "10s",
      },
    };
  }

  // Loki + Promtail
  if (obs.loki) {
    services.loki = {
      image: "grafana/loki:3.0.0",
      container_name: `${clientName}-loki`,
      networks: ["infra"],
      volumes: [
        "./loki/loki-config.yaml:/etc/loki/local-config.yaml:ro",
        `loki-data:/loki`,
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
    volumes["loki-data"] = null;

    services.promtail = {
      image: "grafana/promtail:3.0.0",
      container_name: `${clientName}-promtail`,
      networks: ["infra"],
      volumes: [
        "./loki/promtail-config.yaml:/etc/promtail/config.yaml:ro",
        "/var/run/docker.sock:/var/run/docker.sock",
      ],
      command: ["-config.file=/etc/promtail/config.yaml"],
      depends_on: {
        loki: { condition: "service_healthy" },
      },
    };
  }

  // Prometheus
  if (obs.prometheus) {
    services.prometheus = {
      image: "prom/prometheus:v2.51.0",
      container_name: `${clientName}-prometheus`,
      ports: [`${ports.prometheus}:9090`],
      networks: ["infra"],
      volumes: [
        "./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro",
        `prometheus-data:/prometheus`,
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
    volumes["prometheus-data"] = null;
  }

  // Grafana
  if (obs.grafana) {
    const grafanaDeps: Record<string, { condition: string }> = {};
    if (obs.prometheus) grafanaDeps.prometheus = { condition: "service_healthy" };
    if (obs.loki) grafanaDeps.loki = { condition: "service_healthy" };

    services.grafana = {
      image: "grafana/grafana:11.0.0",
      container_name: `${clientName}-grafana`,
      ports: [`${ports.grafana}:3000`],
      networks: ["infra"],
      environment: {
        GF_AUTH_ANONYMOUS_ENABLED: "true",
        GF_AUTH_ANONYMOUS_ORG_ROLE: "Admin",
        GF_AUTH_DISABLE_LOGIN_FORM: "true",
      },
      volumes: [
        "./grafana/provisioning:/etc/grafana/provisioning:ro",
        "./grafana/dashboards:/var/lib/grafana/dashboards:ro",
        `grafana-data:/var/lib/grafana`,
      ],
      ...(Object.keys(grafanaDeps).length > 0 ? { depends_on: grafanaDeps } : {}),
      healthcheck: {
        test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000/api/health"],
        interval: "10s",
        timeout: "5s",
        retries: 3,
      },
    };
    volumes["grafana-data"] = null;
  }

  // ClickHouse — client-level analytical warehouse (ADR-0008).
  // Reads top-level flag (preferred) OR the legacy nested observability flag
  // for backwards compat with existing client configs.
  if (infrastructure.clickhouse || obs.clickhouse) {
    services.clickhouse = {
      image: "clickhouse/clickhouse-server:24.3",
      container_name: `${clientName}-clickhouse`,
      ports: [`${ports.clickhouse ?? 8120 + ports.blockIndex}:8123`],
      networks: ["infra"],
      environment: {
        CLICKHOUSE_DB: "warehouse",
        CLICKHOUSE_USER: "default",
        CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: "1",
        // Required for ClickHouse's `s3()` table function to talk to LocalStack
        // (path-style URLs) — see ADR-0008 lakehouse pattern.
        CLICKHOUSE_S3_ENDPOINT: "http://localstack:4566",
      },
      volumes: [
        "clickhouse-data:/var/lib/clickhouse",
        "./clickhouse/init:/docker-entrypoint-initdb.d:ro",
      ],
      healthcheck: {
        test: ["CMD", "wget", "--spider", "-q", "http://localhost:8123/ping"],
        interval: "10s",
        timeout: "5s",
        retries: 5,
        start_period: "20s",
      },
    };
    volumes["clickhouse-data"] = null;
  }

  // LocalStack — client-level AWS emulator (ADR-0008).
  if (infrastructure.localstack) {
    services.localstack = {
      image: "localstack/localstack:3",
      container_name: `${clientName}-localstack`,
      ports: [`${ports.localstack ?? 4570 + ports.blockIndex}:4566`],
      networks: ["infra"],
      environment: {
        SERVICES: "s3,sqs,dynamodb,sns,secretsmanager,iam,lambda,logs",
        DEFAULT_REGION: "us-east-1",
        LOCALSTACK_HOST: "localstack",
        EXTRA_CORS_ALLOWED_ORIGINS: "*",
        EXTRA_CORS_ALLOWED_HEADERS: "*",
        DISABLE_CORS_CHECKS: "1",
        DOCKER_HOST: "unix:///var/run/docker.sock",
      },
      volumes: [
        "/var/run/docker.sock:/var/run/docker.sock",
        "./localstack/init:/etc/localstack/init/ready.d:ro",
        "localstack-data:/var/lib/localstack",
      ],
      healthcheck: {
        test: ["CMD", "curl", "-sf", "http://localhost:4566/_localstack/health"],
        interval: "5s",
        timeout: "3s",
        retries: 30,
        start_period: "30s",
      },
    };
    volumes["localstack-data"] = null;
  }

  // Keycloak — client-level identity provider (ADR-0009).
  if (infrastructure.keycloak) {
    services.keycloak = {
      image: "quay.io/keycloak/keycloak:24.0",
      container_name: `${clientName}-keycloak`,
      ports: [`${ports.keycloak ?? 8050 + ports.blockIndex}:8080`],
      networks: ["infra"],
      environment: {
        KEYCLOAK_ADMIN: "admin",
        KEYCLOAK_ADMIN_PASSWORD: "admin",
        KC_DB: "dev-file",
      },
      volumes: ["./keycloak/realm.json:/opt/keycloak/data/import/realm.json:ro"],
      command: ["start-dev", "--import-realm"],
      healthcheck: {
        test: ["CMD", "curl", "-sf", "http://localhost:8080/health/ready"],
        interval: "15s",
        timeout: "10s",
        retries: 20,
        start_period: "60s",
      },
    };
  }

  // MLflow — client-level model registry & experiment tracking (ADR-0010).
  if (infrastructure.mlflow) {
    services.mlflow = {
      image: "ghcr.io/mlflow/mlflow:v2.13.0",
      container_name: `${clientName}-mlflow`,
      ports: [`${ports.mlflow ?? 5050 + ports.blockIndex}:5000`],
      networks: ["infra"],
      command: [
        "mlflow", "server",
        "--host", "0.0.0.0",
        "--port", "5000",
        "--backend-store-uri", "sqlite:///mlflow/mlflow.db",
        "--default-artifact-root", "/mlflow/artifacts",
      ],
      volumes: ["mlflow-data:/mlflow"],
      healthcheck: {
        test: ["CMD-SHELL", "python -c 'import socket; socket.create_connection((\"localhost\", 5000), 3)' || exit 1"],
        interval: "10s",
        timeout: "10s",
        retries: 10,
        start_period: "30s",
      },
    };
    volumes["mlflow-data"] = null;
  }

  // Mage — client-level visual workflow orchestrator (ADR-0010).
  if (infrastructure.mage) {
    services.mage = {
      image: "mageai/mageai:latest",
      container_name: `${clientName}-mage`,
      ports: [`${ports.mage ?? 6750 + ports.blockIndex}:6789`],
      networks: ["infra"],
      environment: {
        PROJECT_NAME: `${clientName}_pipelines`,
        MAGE_DATA_DIR: "/home/src",
      },
      volumes: ["mage-data:/home/src"],
      healthcheck: {
        test: ["CMD", "wget", "--spider", "-q", "http://localhost:6789/"],
        interval: "15s",
        timeout: "10s",
        retries: 5,
        start_period: "30s",
      },
    };
    volumes["mage-data"] = null;
  }

  // Dashboard
  const linkEnv: Record<string, string> = {
    PROJECTS_DIR: "/projects",
    DASHBOARD_DIST_DIR: "/app/dashboard-dist",
    DASHBOARD_PORT: "3002",
    DOCKER_MODE: "true",
    CLIENT_NAME: clientName,
  };
  // Tool URLs use the client's allocated host ports so the dashboard's
  // header links and trace links point to the right place per-client.
  if (obs.jaeger) linkEnv.JAEGER_URL = `http://localhost:${ports.jaeger}`;
  if (obs.grafana) linkEnv.GRAFANA_URL = `http://localhost:${ports.grafana}`;
  if (obs.prometheus) linkEnv.PROMETHEUS_URL = `http://localhost:${ports.prometheus}`;
  if (infrastructure.jenkins) linkEnv.JENKINS_URL = `http://localhost:${ports.jenkins}`;
  if (infrastructure.clickhouse && ports.clickhouse) linkEnv.CLICKHOUSE_URL = `http://localhost:${ports.clickhouse}`;
  if (infrastructure.localstack && ports.localstack) linkEnv.LOCALSTACK_URL = `http://localhost:${ports.localstack}`;
  if (infrastructure.keycloak && ports.keycloak)     linkEnv.KEYCLOAK_URL   = `http://localhost:${ports.keycloak}`;
  if (infrastructure.mlflow && ports.mlflow)         linkEnv.MLFLOW_URL     = `http://localhost:${ports.mlflow}`;
  if (infrastructure.mage && ports.mage)             linkEnv.MAGE_URL       = `http://localhost:${ports.mage}`;

  services.dashboard = {
    image: "blissful-infra-dashboard:latest",
    container_name: `${clientName}-dashboard`,
    ports: [`${ports.dashboard}:3002`],
    networks: ["infra"],
    environment: linkEnv,
    volumes: [
      "/var/run/docker.sock:/var/run/docker.sock",
      `.:/projects/${clientName}`,
    ],
  };

  // Assemble full compose document.
  //
  // We emit `name:` to give the project a stable name (otherwise Compose uses the
  // working directory). `include:` pulls each service's docker-compose.yaml into
  // the SAME Compose project so everything (infra + services) lives under one
  // namespace and supports cross-service `depends_on`.
  const compose: Record<string, unknown> = {
    name: clientName,
    ...(serviceIncludes.length > 0
      ? { include: serviceIncludes.map(p => ({ path: p })) }
      : {}),
    networks: {
      infra: {
        name: `${clientName}_infra`,
      },
    },
    services,
  };

  if (Object.keys(volumes).length > 0) {
    compose.volumes = volumes;
  }

  const yaml = generateYaml(compose);
  await fs.writeFile(path.join(clientDir, "docker-compose.infra.yaml"), yaml);
}

export async function generatePrometheusConfig(clientDir: string, serviceTargets: { name: string; host: string }[] = []): Promise<void> {
  const scrapeConfigs = serviceTargets.map(t => `  - job_name: "${t.name}"
    metrics_path: /actuator/prometheus
    static_configs:
      - targets: ["${t.host}"]`);

  const content = `global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
${scrapeConfigs.length > 0 ? scrapeConfigs.join("\n\n") : "  []"}
`;

  const promDir = path.join(clientDir, "prometheus");
  await fs.mkdir(promDir, { recursive: true });
  await fs.writeFile(path.join(promDir, "prometheus.yml"), content);
}

export async function generateLokiConfig(clientDir: string): Promise<void> {
  const lokiDir = path.join(clientDir, "loki");
  await fs.mkdir(lokiDir, { recursive: true });

  const lokiConfig = `auth_enabled: false

server:
  http_listen_port: 3100

common:
  path_prefix: /loki
  storage:
    filesystem:
      chunks_directory: /loki/chunks
      rules_directory: /loki/rules
  replication_factor: 1
  ring:
    kvstore:
      store: inmemory

schema_config:
  configs:
    - from: 2020-10-24
      store: tsdb
      object_store: filesystem
      schema: v13
      index:
        prefix: index_
        period: 24h
`;

  const promtailConfig = `server:
  http_listen_port: 9080

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  - job_name: docker
    docker_sd_configs:
      - host: unix:///var/run/docker.sock
        refresh_interval: 5s
    relabel_configs:
      - source_labels: ["__meta_docker_container_name"]
        target_label: container
      - source_labels: ["__meta_docker_container_log_stream"]
        target_label: stream
`;

  await fs.writeFile(path.join(lokiDir, "loki-config.yaml"), lokiConfig);
  await fs.writeFile(path.join(lokiDir, "promtail-config.yaml"), promtailConfig);
}

export async function generateGrafanaConfig(clientDir: string): Promise<void> {
  const provDir = path.join(clientDir, "grafana", "provisioning", "datasources");
  const dashDir = path.join(clientDir, "grafana", "dashboards");
  await fs.mkdir(provDir, { recursive: true });
  await fs.mkdir(dashDir, { recursive: true });

  const datasources = `apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
  - name: Jaeger
    type: jaeger
    access: proxy
    url: http://jaeger:16686
`;

  await fs.writeFile(path.join(provDir, "datasources.yaml"), datasources);
  await fs.writeFile(path.join(dashDir, ".gitkeep"), "");
}

/**
 * ClickHouse init script — runs on first container start (mounted at
 * /docker-entrypoint-initdb.d). Creates the canonical `warehouse` database
 * and a sample `events` table to demonstrate the lakehouse pattern with
 * LocalStack S3.
 */
export async function generateClickHouseInit(clientDir: string): Promise<void> {
  const dir = path.join(clientDir, "clickhouse", "init");
  await fs.mkdir(dir, { recursive: true });
  const sql = `-- Created by blissful-infra (ADR-0008).
-- Plugins and services should write into the \`warehouse\` database. Schema
-- conventions for plugin-owned tables will be formalized in a future ADR;
-- for now, plugins create their own tables freely.
CREATE DATABASE IF NOT EXISTS warehouse;

-- Example: a generic events table that analytics-style plugins can use.
-- Plugins are free to create their own tables instead.
CREATE TABLE IF NOT EXISTS warehouse.events (
  ts          DateTime64(3) DEFAULT now64(),
  source      LowCardinality(String),
  event_name  LowCardinality(String),
  user_id     Nullable(String),
  session_id  Nullable(String),
  properties  String  -- JSON-encoded freeform props
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (source, ts);
`;
  await fs.writeFile(path.join(dir, "00_warehouse.sql"), sql);
}

/**
 * LocalStack init script for the client-level instance — runs when LocalStack
 * is ready. The script creates a default S3 bucket that ClickHouse can read
 * from via the s3() table function, demonstrating the lakehouse pattern.
 */
export async function generateClientLocalStackInit(clientDir: string, clientName: string): Promise<void> {
  const dir = path.join(clientDir, "localstack", "init");
  await fs.mkdir(dir, { recursive: true });
  const sh = `#!/bin/bash
# Created by blissful-infra (ADR-0008). Runs when LocalStack is ready.
# Creates a default bucket for the client. Services that need their own
# buckets should run their own init scripts.
set -e
echo "[localstack-init] creating client bucket for ${clientName}..."

awslocal s3 mb s3://${clientName}-data || true
awslocal s3api put-bucket-cors \\
  --bucket ${clientName}-data \\
  --cors-configuration '{"CORSRules":[{"AllowedMethods":["GET","PUT","POST"],"AllowedOrigins":["*"],"AllowedHeaders":["*"]}]}' \\
  || true

echo "[localstack-init] done"
`;
  const file = path.join(dir, "00_create_bucket.sh");
  await fs.writeFile(file, sh);
  await fs.chmod(file, 0o755);
}

/**
 * Generate a minimal Keycloak realm.json (ADR-0009). Imported on Keycloak
 * startup via --import-realm. Realm name = client name. Admin: admin/admin.
 */
export async function generateKeycloakRealm(clientDir: string, clientName: string): Promise<void> {
  const dir = path.join(clientDir, "keycloak");
  await fs.mkdir(dir, { recursive: true });
  const realm = {
    realm: clientName,
    enabled: true,
    sslRequired: "external",
    registrationAllowed: false,
    loginWithEmailAllowed: true,
    duplicateEmailsAllowed: false,
    resetPasswordAllowed: true,
    rememberMe: true,
    accessTokenLifespan: 3600,
    clients: [
      {
        clientId: `${clientName}-default`,
        enabled: true,
        publicClient: true,
        redirectUris: ["http://localhost:*", "https://*.localhost:*"],
        webOrigins: ["+"],
        directAccessGrantsEnabled: true,
        standardFlowEnabled: true,
      },
    ],
  };
  await fs.writeFile(path.join(dir, "realm.json"), JSON.stringify(realm, null, 2));
}

// Minimal YAML serializer (reused from start.ts pattern)
function generateYaml(obj: unknown, indent = 0): string {
  const spaces = "  ".repeat(indent);

  if (obj === null) return "";
  if (obj === undefined) return "null";

  if (typeof obj === "string") {
    // Always quote strings that contain YAML-significant characters or that
    // YAML would interpret as something other than a plain scalar. Notably:
    //   * starts an alias reference, & starts an anchor, leading - leads a
    //   sequence, leading ? leads a mapping key, leading | / > start a block
    //   scalar. Plain digits parse as numbers. Plain `true`/`false`/`null`
    //   parse as booleans/null. Empty strings would render as nothing.
    const needsQuoting =
      obj === "" ||
      obj.includes(":") || obj.includes("#") || obj.includes('"') || obj.includes("'") ||
      obj.startsWith("$") || obj.startsWith("*") || obj.startsWith("&") ||
      obj.startsWith("-") || obj.startsWith("?") || obj.startsWith("|") || obj.startsWith(">") ||
      obj.startsWith("@") || obj.startsWith("`") || obj.startsWith("%") ||
      /^\d+$/.test(obj) ||
      /^(true|false|null|yes|no|on|off|~)$/i.test(obj);
    if (needsQuoting) {
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
