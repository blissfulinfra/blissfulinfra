import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import {
  normalizePostgresInstances,
  type ClientConfig,
  type PortBlock,
  type PostgresInstance,
} from "@blissful-infra/shared";

export interface ParsedClientConfig {
  infrastructure: NonNullable<ClientConfig["infrastructure"]>;
  serviceRefs: { name: string; path: string }[];
}

/**
 * Parse a client's blissful-infra.yaml — extracts the infrastructure block
 * and the services list. Used by `service add/down` to regenerate the infra
 * compose with the correct include list. Forgiving: missing fields default
 * to false / empty rather than throwing.
 */
export function parseClientConfigYaml(content: string): ParsedClientConfig {
  const doc = (yaml.load(content) ?? {}) as Record<string, unknown>;
  const infraIn = (doc.infrastructure ?? {}) as Record<string, unknown>;
  const obsIn = (infraIn.observability ?? {}) as Record<string, unknown>;
  const asBool = (v: unknown): boolean => v === true;

  // Postgres can be boolean shorthand or array of instances (ADR-0014).
  // We pass the on-disk shape through; downstream calls
  // normalizePostgresInstances() to get the canonical array form.
  const postgresRaw = infraIn.postgres;
  const postgres =
    Array.isArray(postgresRaw)
      ? (postgresRaw as PostgresInstance[])
      : asBool(postgresRaw);

  const infra: NonNullable<ClientConfig["infrastructure"]> = {
    kafka:      asBool(infraIn.kafka),
    postgres,
    jenkins:    asBool(infraIn.jenkins),
    clickhouse: asBool(infraIn.clickhouse),
    localstack: asBool(infraIn.localstack),
    keycloak:   asBool(infraIn.keycloak),
    mlflow:     asBool(infraIn.mlflow),
    mage:       asBool(infraIn.mage),
    observability: {
      prometheus: asBool(obsIn.prometheus),
      grafana:    asBool(obsIn.grafana),
      // ADR-0016: tempo is canonical; jaeger is a deprecated alias still
      // accepted on disk so existing client YAMLs keep working.
      tempo:      asBool(obsIn.tempo) || asBool(obsIn.jaeger),
      jaeger:     asBool(obsIn.jaeger),
      loki:       asBool(obsIn.loki),
      clickhouse: asBool(obsIn.clickhouse),
    },
  };

  const servicesRaw = Array.isArray(doc.services) ? doc.services : [];
  const refs: { name: string; path: string }[] = [];
  for (const entry of servicesRaw) {
    if (entry && typeof entry === "object") {
      const e = entry as Record<string, unknown>;
      if (typeof e.name === "string" && typeof e.path === "string") {
        refs.push({ name: e.name, path: e.path });
      }
    }
  }

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
    tempo: true,
    jaeger: false,
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

  // Postgres — N instances (ADR-0014). The instance named `default` keeps
  // back-compat names (service key `postgres`, volume `postgres-data`,
  // container `${clientName}-postgres`, host port `ports.postgres`). Other
  // instances get suffixed names and ports from the expansion range stored
  // in `ports.postgresInstances`.
  const postgresInstances = normalizePostgresInstances(infrastructure.postgres);
  for (const instance of postgresInstances) {
    const isDefault = instance.name === "default";
    const dbUser = clientName.replace(/-/g, "_");
    const dbName = isDefault ? dbUser : `${dbUser}_${instance.name.replace(/-/g, "_")}`;
    const serviceKey = isDefault ? "postgres" : `postgres-${instance.name}`;
    const containerName = isDefault ? `${clientName}-postgres` : `${clientName}-postgres-${instance.name}`;
    const volumeName = isDefault ? "postgres-data" : `postgres-data-${instance.name}`;
    const hostPort = isDefault ? ports.postgres : ports.postgresInstances?.[instance.name];
    if (hostPort === undefined) {
      throw new Error(`No host port allocated for postgres instance "${instance.name}"`);
    }

    const env: Record<string, string> = {
      POSTGRES_USER: dbUser,
      POSTGRES_PASSWORD: "localdev",
      POSTGRES_DB: dbName,
    };
    if (instance.tuning) {
      // Postgres image supports POSTGRES_INITDB_ARGS but not arbitrary GUCs
      // via env. The community pattern is to mount postgresql.conf or pass
      // -c flags. We pass tuning as `-c key=value` command args so they
      // apply to the running server. Common keys: shared_buffers,
      // max_connections, work_mem.
      const cmdArgs: string[] = ["postgres"];
      for (const [k, v] of Object.entries(instance.tuning)) {
        cmdArgs.push("-c", `${toSnakeCase(k)}=${v}`);
      }
      services[serviceKey] = {
        image: `postgres:${instance.version}-alpine`,
        container_name: containerName,
        ports: [`${hostPort}:5432`],
        networks: ["infra"],
        environment: env,
        volumes: [`${volumeName}:/var/lib/postgresql/data`],
        command: cmdArgs,
        healthcheck: {
          test: ["CMD-SHELL", `pg_isready -U ${dbUser}`],
          interval: "5s",
          timeout: "3s",
          retries: 5,
        },
      };
    } else {
      services[serviceKey] = {
        image: `postgres:${instance.version}-alpine`,
        container_name: containerName,
        ports: [`${hostPort}:5432`],
        networks: ["infra"],
        environment: env,
        volumes: [`${volumeName}:/var/lib/postgresql/data`],
        healthcheck: {
          test: ["CMD-SHELL", `pg_isready -U ${dbUser}`],
          interval: "5s",
          timeout: "3s",
          retries: 5,
        },
      };
    }
    volumes[volumeName] = null;
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

  // Tempo (ADR-0016 replaced Jaeger). The legacy `obs.jaeger: true` flag is
  // treated as an alias for tempo: existing client configs continue to work
  // and get a Tempo container instead. Backends send OTLP to tempo:4318.
  const wantsTracing = obs.tempo || obs.jaeger;
  if (wantsTracing) {
    services.tempo = {
      image: "grafana/tempo:2.5.0",
      container_name: `${clientName}-tempo`,
      // Map only the HTTP query API to a host port (Grafana queries via
      // the in-network hostname). 4317/4318 (OTLP receivers) are
      // in-network only, services reach them via `tempo:4318`.
      ports: [`${ports.tempo}:3200`],
      networks: ["infra"],
      command: ["-config.file=/etc/tempo/tempo.yaml"],
      volumes: [
        "./tempo/tempo.yaml:/etc/tempo/tempo.yaml:ro",
        "tempo-data:/var/tempo",
      ],
      healthcheck: {
        // Tempo's image is alpine-based with BusyBox sh (no /dev/tcp), but
        // wget is in /usr/bin. /ready returns 200 once the receivers are
        // listening. wget exits 0 on 2xx, non-zero otherwise.
        test: ["CMD", "wget", "--quiet", "--spider", "http://localhost:3200/ready"],
        interval: "10s",
        timeout: "5s",
        retries: 5,
        start_period: "15s",
      },
    };
    volumes["tempo-data"] = null;
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

  // LocalStack-compatible AWS emulator — engine is floci/floci (drop-in
  // replacement, ADR-0008). FLOCI_HOSTNAME=localstack so URLs returned by
  // the emulator (e.g. presigned S3 URLs, SQS queue URLs) resolve to the
  // service name other containers reach it by.
  if (infrastructure.localstack) {
    services.localstack = {
      image: "floci/floci:latest",
      container_name: `${clientName}-localstack`,
      ports: [`${ports.localstack ?? 4570 + ports.blockIndex}:4566`],
      networks: ["infra"],
      environment: {
        SERVICES: "s3,sqs,dynamodb,sns,secretsmanager,iam,lambda,logs",
        DEFAULT_REGION: "us-east-1",
        FLOCI_HOSTNAME: "localstack",
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
      // The Keycloak image is UBI9-minimal, no curl/wget. Use bash's
      // built-in /dev/tcp redirect to probe the HTTP endpoint, then grep
      // for any HTTP status line. /realms/master returns 200 once the
      // realm import has finished and the listener is fully serving.
      healthcheck: {
        test: [
          "CMD-SHELL",
          "exec 3<>/dev/tcp/localhost/8080 && printf 'GET /realms/master HTTP/1.0\\r\\n\\r\\n' >&3 && grep -q HTTP <&3",
        ],
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
  // ADR-0016: Tempo replaced Jaeger as the tracing backend. The trace
  // explorer link points at Grafana's Explore tab with the Tempo
  // datasource preselected, since users view traces inside Grafana now.
  if ((obs.tempo || obs.jaeger) && obs.grafana) {
    linkEnv.TEMPO_URL = `http://localhost:${ports.grafana}/explore?left=` +
      encodeURIComponent(JSON.stringify({ datasource: "Tempo", queries: [{ refId: "A" }] }));
  } else if (obs.tempo || obs.jaeger) {
    linkEnv.TEMPO_URL = `http://localhost:${ports.tempo}`;
  }
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

  // ADR-0016: Tempo replaces Jaeger. The Tempo datasource is configured
  // with `tracesToLogsV2` so clicking a span in Grafana's trace explorer
  // jumps straight to the matching Loki log lines. This is the killer
  // observability feature the swap was made for.
  const datasources = `apiVersion: 1
datasources:
  - name: Prometheus
    uid: prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
  - name: Loki
    uid: loki
    type: loki
    access: proxy
    url: http://loki:3100
  - name: Tempo
    uid: tempo
    type: tempo
    access: proxy
    url: http://tempo:3200
    jsonData:
      tracesToLogsV2:
        datasourceUid: loki
        spanStartTimeShift: '-1h'
        spanEndTimeShift: '1h'
        filterByTraceID: true
        filterBySpanID: false
      tracesToMetrics:
        datasourceUid: prometheus
      serviceMap:
        datasourceUid: prometheus
      nodeGraph:
        enabled: true
`;

  await fs.writeFile(path.join(provDir, "datasources.yaml"), datasources);
  await fs.writeFile(path.join(dashDir, ".gitkeep"), "");
}

/**
 * Generate the client-level Tempo config (ADR-0016). Tempo wants its own
 * config file mounted in (unlike Jaeger all-in-one). This config:
 *   - Listens for OTLP on 4317 (gRPC) and 4318 (HTTP) on all interfaces
 *   - Stores trace blocks on the local filesystem at /var/tempo
 *   - Serves the HTTP query API on :3200 (mapped to a host port for Grafana)
 *
 * For cloud deploys the storage backend should switch to S3/GCS/Azure;
 * that's a deploy-adapter concern, not local dev.
 */
export async function generateTempoConfig(clientDir: string): Promise<void> {
  const dir = path.join(clientDir, "tempo");
  await fs.mkdir(dir, { recursive: true });
  const config = `# Generated by blissful-infra (ADR-0016).
# Local-dev defaults: filesystem storage, no auth, OTLP on 4317/4318.

server:
  http_listen_port: 3200
  log_level: warn

distributor:
  receivers:
    otlp:
      protocols:
        grpc:
          endpoint: 0.0.0.0:4317
        http:
          endpoint: 0.0.0.0:4318

ingester:
  trace_idle_period: 10s
  max_block_duration: 5m

compactor:
  compaction:
    block_retention: 24h

storage:
  trace:
    backend: local
    local:
      path: /var/tempo/blocks
    wal:
      path: /var/tempo/wal

metrics_generator:
  registry:
    external_labels:
      source: tempo
  storage:
    path: /var/tempo/generator/wal

# Required for trace-to-metrics + service map in Grafana (ADR-0016).
# Tempo generates RED metrics from spans and exposes them as
# Prometheus remote-write to a target; we keep them in-memory only for
# local dev (no remote_write block configured).
overrides:
  defaults:
    metrics_generator:
      processors: [service-graphs, span-metrics]
`;
  await fs.writeFile(path.join(dir, "tempo.yaml"), config);
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

// camelCase → snake_case for Postgres GUC names. Tuning keys like
// `sharedBuffers` are written by users; Postgres expects `shared_buffers`.
function toSnakeCase(s: string): string {
  return s.replace(/[A-Z]/g, m => `_${m.toLowerCase()}`);
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
