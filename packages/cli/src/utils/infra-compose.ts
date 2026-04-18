import fs from "node:fs/promises";
import path from "node:path";
import type { ClientConfig, PortBlock } from "@blissful-infra/shared";

interface InfraComposeOptions {
  clientName: string;
  clientDir: string;
  ports: PortBlock;
  infrastructure: NonNullable<ClientConfig["infrastructure"]>;
}

export async function generateInfraCompose(opts: InfraComposeOptions): Promise<void> {
  const { clientName, clientDir, ports, infrastructure } = opts;
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
      image: "blissful-infra-jenkins:latest",
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

  // ClickHouse (Phase 8+)
  if (obs.clickhouse) {
    services.clickhouse = {
      image: "clickhouse/clickhouse-server:24.3",
      container_name: `${clientName}-clickhouse`,
      ports: ["8123:8123"],
      networks: ["infra"],
      environment: {
        CLICKHOUSE_DB: "metrics_db",
        CLICKHOUSE_USER: "default",
        CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: "1",
      },
      volumes: [`clickhouse-data:/var/lib/clickhouse`],
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

  // Dashboard
  services.dashboard = {
    image: "blissful-infra-dashboard:latest",
    container_name: `${clientName}-dashboard`,
    ports: [`${ports.dashboard}:3002`],
    networks: ["infra"],
    environment: {
      PROJECTS_DIR: "/projects",
      DASHBOARD_DIST_DIR: "/app/dashboard-dist",
      DASHBOARD_PORT: "3002",
      DOCKER_MODE: "true",
      CLIENT_NAME: clientName,
    },
    volumes: [
      "/var/run/docker.sock:/var/run/docker.sock",
      `.:/projects/${clientName}`,
    ],
  };

  // Assemble full compose document
  const compose: Record<string, unknown> = {
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

// Minimal YAML serializer (reused from start.ts pattern)
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
