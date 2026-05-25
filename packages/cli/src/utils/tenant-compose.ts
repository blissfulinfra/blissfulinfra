import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import {
  TenantConfigSchema,
  type TenantConfig,
  type TenantPortBlock,
} from "@blissful-infra/shared";
import { getTenantDir } from "./tenant-registry.js";

/**
 * Generate the tenant-level docker-compose at the tenant directory.
 *
 * Per ADR-0017 the tenant owns: dashboard, optional Jenkins, observability
 * (Prometheus + Grafana + Tempo + Loki + Promtail). Each project's compose
 * file is included via `include:` so `docker compose up` from the tenant dir
 * brings up tenant infra + every project + every service in one go.
 *
 * Networks:
 *   - `<tenant>_tenant` — joined by tenant-level services. Each project
 *     gateway also joins this for cross-project / observability traffic.
 */
export interface GenerateTenantComposeInput {
  config: TenantConfig;
  ports: TenantPortBlock;
  /** Paths to each project's docker-compose.project.yaml, relative to the tenant dir. */
  projectComposeIncludes: string[];
}

export function buildTenantComposeYaml(input: GenerateTenantComposeInput): string {
  const { config, ports } = input;
  const tenantNet = `${config.name}_tenant`;
  const obs = config.infrastructure.observability;
  const hostBlissfulHome = process.env.BLISSFUL_HOME ?? path.join(os.homedir(), ".blissful-infra");

  const services: Record<string, unknown> = {};
  const volumes: Record<string, null> = {};

  // Dashboard — always on. Mounts the host registry + docker socket so the
  // dashboard's API server can shell out to the CLI for service add / wiring.
  services.dashboard = {
    image: "blissful-infra-dashboard:latest",
    container_name: `${config.name}-dashboard`,
    networks: ["tenant"],
    ports: [`${ports.dashboard}:3002`],
    environment: {
      TENANT_NAME: config.name,
      BLISSFUL_HOME: "/blissful-home",
      DASHBOARD_PORT: "3002",
      DASHBOARD_DIST_DIR: "/app/dashboard-dist",
      DOCKER_MODE: "true",
      PROJECTS_DIR: "/projects",
      // Deep link to the provisioned "Tenant Overview" dashboard so the
      // Grafana button in the dashboard header drops the user straight into
      // charts (HTTP rate, p95 latency, JVM heap, log volume) instead of
      // Grafana's empty home page.
      GRAFANA_URL: obs.grafana ? `http://localhost:${ports.grafana}/d/tenant-overview` : "",
      PROMETHEUS_URL: obs.prometheus ? `http://localhost:${ports.prometheus}` : "",
      TEMPO_URL: obs.tempo ? `http://localhost:${ports.grafana}/explore?left=${encodeURIComponent('{"datasource":"Tempo","queries":[{"refId":"A"}]}')}` : "",
    },
    volumes: [
      "/var/run/docker.sock:/var/run/docker.sock",
      `${hostBlissfulHome}:/blissful-home:rw`,
    ],
  };

  if (config.infrastructure.jenkins) {
    services.jenkins = {
      image: "blissful-jenkins:latest",
      container_name: `${config.name}-jenkins`,
      networks: ["tenant"],
      ports: [`${ports.jenkins}:8080`],
      environment: {
        JENKINS_OPTS: "--prefix=/",
        JAVA_OPTS: "-Djenkins.install.runSetupWizard=false",
      },
      volumes: [
        `${config.name}_jenkins_home:/var/jenkins_home`,
        "/var/run/docker.sock:/var/run/docker.sock",
      ],
    };
    volumes[`${config.name}_jenkins_home`] = null;
  }

  if (obs.prometheus) {
    services.prometheus = {
      image: "prom/prometheus:v2.51.0",
      container_name: `${config.name}-prometheus`,
      networks: ["tenant"],
      ports: [`${ports.prometheus}:9090`],
      volumes: [
        "./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro",
        "/var/run/docker.sock:/var/run/docker.sock",
        `${config.name}_prometheus_data:/prometheus`,
      ],
      // host-gateway lets Prometheus reach service containers (which live on
      // project networks) via their HOST-published ports, sidestepping the
      // cross-network problem. Docker Desktop already provides this; on
      // native Linux we need it explicit.
      extra_hosts: ["host.docker.internal:host-gateway"],
    };
    volumes[`${config.name}_prometheus_data`] = null;
  }

  if (obs.tempo) {
    services.tempo = {
      image: "grafana/tempo:2.5.0",
      container_name: `${config.name}-tempo`,
      networks: ["tenant"],
      ports: [
        `${ports.tempo}:3200`,
        "4317:4317",
        "4318:4318",
      ],
      command: ["-config.file=/etc/tempo.yaml"],
      volumes: [
        "./tempo/tempo.yaml:/etc/tempo.yaml:ro",
        `${config.name}_tempo_data:/var/tempo`,
      ],
    };
    volumes[`${config.name}_tempo_data`] = null;
  }

  if (obs.loki) {
    services.loki = {
      image: "grafana/loki:3.0.0",
      container_name: `${config.name}-loki`,
      networks: ["tenant"],
      ports: [`${ports.loki}:3100`],
      command: ["-config.file=/etc/loki/loki-config.yaml"],
      volumes: [
        "./loki/loki-config.yaml:/etc/loki/loki-config.yaml:ro",
        `${config.name}_loki_data:/loki`,
      ],
    };
    services.promtail = {
      image: "grafana/promtail:3.0.0",
      container_name: `${config.name}-promtail`,
      networks: ["tenant"],
      volumes: [
        "./loki/promtail-config.yaml:/etc/promtail/config.yaml:ro",
        "/var/run/docker.sock:/var/run/docker.sock",
        "/var/lib/docker/containers:/var/lib/docker/containers:ro",
      ],
      command: ["-config.file=/etc/promtail/config.yaml"],
    };
    volumes[`${config.name}_loki_data`] = null;
  }

  if (obs.grafana) {
    services.grafana = {
      image: "grafana/grafana:10.4.0",
      container_name: `${config.name}-grafana`,
      networks: ["tenant"],
      ports: [`${ports.grafana}:3000`],
      environment: {
        GF_AUTH_ANONYMOUS_ENABLED: "true",
        GF_AUTH_ANONYMOUS_ORG_ROLE: "Admin",
        GF_AUTH_DISABLE_LOGIN_FORM: "true",
      },
      volumes: [
        "./grafana/provisioning:/etc/grafana/provisioning:ro",
        "./grafana/dashboards:/var/lib/grafana/dashboards:ro",
        `${config.name}_grafana_data:/var/lib/grafana`,
      ],
    };
    volumes[`${config.name}_grafana_data`] = null;
  }

  const compose: Record<string, unknown> = {
    name: config.name,
    networks: {
      tenant: { name: tenantNet },
    },
    services,
  };
  if (Object.keys(volumes).length) compose.volumes = volumes;

  if (input.projectComposeIncludes.length > 0) {
    compose.include = input.projectComposeIncludes.map(p => ({ path: p }));
  }

  return yaml.dump(compose, { lineWidth: 120, noRefs: true });
}

// ─── Supporting config files ─────────────────────────────────────────────────

export function buildPrometheusYml(): string {
  // Service discovery: Prometheus watches the Docker socket and picks up
  // any container with a `com.blissful.metrics_port` label. The relabel
  // rules build the scrape URL as host.docker.internal:<host_port><path>,
  // which works because services publish their HTTP port to the host.
  return [
    "# Generated by blissful-infra.",
    "global:",
    "  scrape_interval: 15s",
    "  evaluation_interval: 15s",
    "scrape_configs:",
    "  - job_name: 'prometheus'",
    "    static_configs:",
    "      - targets: ['localhost:9090']",
    "",
    "  - job_name: 'blissful-services'",
    "    docker_sd_configs:",
    "      - host: unix:///var/run/docker.sock",
    "        refresh_interval: 15s",
    "    relabel_configs:",
    "      # Only keep containers that opted in via the metrics_port label.",
    "      - source_labels: [__meta_docker_container_label_com_blissful_metrics_port]",
    "        regex: .+",
    "        action: keep",
    "      # Carry through tenant / project / service labels.",
    "      - source_labels: [__meta_docker_container_label_com_blissful_tenant]",
    "        target_label: tenant",
    "      - source_labels: [__meta_docker_container_label_com_blissful_project]",
    "        target_label: project",
    "      - source_labels: [__meta_docker_container_label_com_blissful_service]",
    "        target_label: service",
    "      # Friendly instance label (container name without the leading slash).",
    "      - source_labels: [__meta_docker_container_name]",
    "        regex: '/(.+)'",
    "        target_label: instance",
    "      # Scrape via host.docker.internal:<host_port> — sidesteps the",
    "      # cross-network problem (Prometheus sits on the tenant network;",
    "      # services live on their project's isolated network).",
    "      - source_labels: [__meta_docker_container_label_com_blissful_metrics_port]",
    "        target_label: __address__",
    "        replacement: host.docker.internal:$1",
    "      - source_labels: [__meta_docker_container_label_com_blissful_metrics_path]",
    "        target_label: __metrics_path__",
    "        regex: (.+)",
    "        replacement: $1",
    "",
  ].join("\n");
}

export function buildTempoYaml(): string {
  return [
    "# Generated by blissful-infra (ADR-0016).",
    "server:",
    "  http_listen_port: 3200",
    "  log_level: warn",
    "distributor:",
    "  receivers:",
    "    otlp:",
    "      protocols:",
    "        grpc:",
    "          endpoint: 0.0.0.0:4317",
    "        http:",
    "          endpoint: 0.0.0.0:4318",
    "ingester:",
    "  trace_idle_period: 10s",
    "  max_block_duration: 5m",
    "compactor:",
    "  compaction:",
    "    block_retention: 24h",
    "storage:",
    "  trace:",
    "    backend: local",
    "    local:",
    "      path: /var/tempo/blocks",
    "    wal:",
    "      path: /var/tempo/wal",
    "",
  ].join("\n");
}

export function buildLokiConfig(): string {
  return [
    "auth_enabled: false",
    "server:",
    "  http_listen_port: 3100",
    "common:",
    "  path_prefix: /loki",
    "  storage:",
    "    filesystem:",
    "      chunks_directory: /loki/chunks",
    "      rules_directory: /loki/rules",
    "  replication_factor: 1",
    "  ring:",
    "    instance_addr: 127.0.0.1",
    "    kvstore:",
    "      store: inmemory",
    "schema_config:",
    "  configs:",
    "    - from: 2024-01-01",
    "      store: tsdb",
    "      object_store: filesystem",
    "      schema: v13",
    "      index:",
    "        prefix: index_",
    "        period: 24h",
    "",
  ].join("\n");
}

export function buildPromtailConfig(): string {
  // We control three explicit Docker labels in each service/project compose
  // (`com.blissful.tenant`, `com.blissful.project`, `com.blissful.service`)
  // so Promtail can tag log lines unambiguously, regardless of hyphens in any
  // of the names. The dashboard's log query relies on these labels.
  return [
    "server:",
    "  http_listen_port: 9080",
    "positions:",
    "  filename: /tmp/positions.yaml",
    "clients:",
    "  - url: http://loki:3100/loki/api/v1/push",
    "scrape_configs:",
    "  - job_name: docker",
    "    docker_sd_configs:",
    "      - host: unix:///var/run/docker.sock",
    "        refresh_interval: 5s",
    "    relabel_configs:",
    "      - source_labels: [\"__meta_docker_container_name\"]",
    "        regex: \"/?(.+)\"",
    "        target_label: container",
    "        replacement: \"$1\"",
    "      - source_labels: [\"__meta_docker_container_log_stream\"]",
    "        target_label: stream",
    "      - source_labels: [\"__meta_docker_container_label_com_blissful_tenant\"]",
    "        target_label: tenant",
    "      - source_labels: [\"__meta_docker_container_label_com_blissful_project\"]",
    "        target_label: project",
    "      - source_labels: [\"__meta_docker_container_label_com_blissful_service\"]",
    "        target_label: service",
    "",
  ].join("\n");
}

export function buildGrafanaDatasources(): string {
  return [
    "apiVersion: 1",
    "datasources:",
    "  - name: Prometheus",
    "    uid: prometheus",
    "    type: prometheus",
    "    access: proxy",
    "    url: http://prometheus:9090",
    "    isDefault: true",
    "  - name: Loki",
    "    uid: loki",
    "    type: loki",
    "    access: proxy",
    "    url: http://loki:3100",
    "  - name: Tempo",
    "    uid: tempo",
    "    type: tempo",
    "    access: proxy",
    "    url: http://tempo:3200",
    "",
  ].join("\n");
}

/**
 * The default "Tenant Overview" dashboard. Surfaces what's actually wired up
 * today — Prometheus scraping Spring Boot via host.docker.internal, plus
 * Loki log volume — so users see real data the moment they `tenant up`.
 *
 * Panels:
 *   1. Services scraped (count of `up == 1` from Prometheus)
 *   2. HTTP request rate per service (Spring Boot's http_server_requests_seconds_count)
 *   3. HTTP p95 latency per service
 *   4. JVM heap used per service
 *   5. Log volume per service (Loki, log lines / minute)
 *   6. Recent logs panel (Loki, all tenant services)
 */
export function buildTenantOverviewDashboard(tenantName: string): string {
  const dashboard = {
    title: `${tenantName} — Tenant Overview`,
    uid: "tenant-overview",
    tags: ["blissful-infra", "tenant", tenantName],
    timezone: "browser",
    schemaVersion: 39,
    version: 1,
    refresh: "30s",
    time: { from: "now-30m", to: "now" },
    panels: [
      {
        id: 1,
        type: "stat",
        title: "Services scraped",
        gridPos: { h: 4, w: 4, x: 0, y: 0 },
        datasource: { type: "prometheus", uid: "prometheus" },
        targets: [{ refId: "A", expr: "sum(up{tenant=~\".+\"})" }],
        options: { reduceOptions: { calcs: ["last"] }, colorMode: "value" },
        fieldConfig: { defaults: { color: { mode: "thresholds" }, thresholds: {
          mode: "absolute",
          steps: [{ color: "red", value: 0 }, { color: "green", value: 1 }],
        }}},
      },
      {
        id: 2,
        type: "timeseries",
        title: "HTTP request rate (req/s) by service",
        gridPos: { h: 8, w: 10, x: 4, y: 0 },
        datasource: { type: "prometheus", uid: "prometheus" },
        targets: [{
          refId: "A",
          expr: "sum by (service) (rate(http_server_requests_seconds_count[1m]))",
          legendFormat: "{{service}}",
        }],
      },
      {
        id: 3,
        type: "timeseries",
        title: "HTTP p95 latency by service (s)",
        gridPos: { h: 8, w: 10, x: 14, y: 0 },
        datasource: { type: "prometheus", uid: "prometheus" },
        targets: [{
          refId: "A",
          expr: "histogram_quantile(0.95, sum by (le, service) (rate(http_server_requests_seconds_bucket[5m])))",
          legendFormat: "{{service}}",
        }],
      },
      {
        id: 4,
        type: "timeseries",
        title: "JVM heap used (MB) by service",
        gridPos: { h: 8, w: 10, x: 0, y: 8 },
        datasource: { type: "prometheus", uid: "prometheus" },
        targets: [{
          refId: "A",
          expr: "jvm_memory_used_bytes{area=\"heap\"} / 1024 / 1024",
          legendFormat: "{{service}}",
        }],
      },
      {
        id: 5,
        type: "timeseries",
        title: "Log lines / minute by service",
        gridPos: { h: 8, w: 14, x: 10, y: 8 },
        datasource: { type: "loki", uid: "loki" },
        targets: [{
          refId: "A",
          expr: `sum by (service) (count_over_time({tenant="${tenantName}"}[1m]))`,
          legendFormat: "{{service}}",
        }],
      },
      {
        id: 6,
        type: "timeseries",
        title: "Postgres — active connections by project",
        gridPos: { h: 8, w: 12, x: 0, y: 16 },
        datasource: { type: "prometheus", uid: "prometheus" },
        targets: [{
          refId: "A",
          expr: "sum by (project, datname) (pg_stat_activity_count)",
          legendFormat: "{{project}} / {{datname}}",
        }],
      },
      {
        id: 7,
        type: "timeseries",
        title: "Postgres — transaction commit/rollback rate",
        gridPos: { h: 8, w: 12, x: 12, y: 16 },
        datasource: { type: "prometheus", uid: "prometheus" },
        targets: [
          {
            refId: "A",
            expr: "sum by (project) (rate(pg_stat_database_xact_commit[1m]))",
            legendFormat: "{{project}} commits/s",
          },
          {
            refId: "B",
            expr: "sum by (project) (rate(pg_stat_database_xact_rollback[1m]))",
            legendFormat: "{{project}} rollbacks/s",
          },
        ],
      },
      {
        id: 8,
        type: "timeseries",
        title: "Kafka — messages in / out per second",
        gridPos: { h: 8, w: 12, x: 0, y: 24 },
        datasource: { type: "prometheus", uid: "prometheus" },
        targets: [
          {
            refId: "A",
            expr: "sum by (project, topic) (rate(kafka_topic_partition_current_offset[1m]))",
            legendFormat: "{{project}}/{{topic}} offset/s",
          },
        ],
      },
      {
        id: 9,
        type: "timeseries",
        title: "Kafka — consumer group lag",
        gridPos: { h: 8, w: 12, x: 12, y: 24 },
        datasource: { type: "prometheus", uid: "prometheus" },
        targets: [{
          refId: "A",
          expr: "sum by (project, consumergroup, topic) (kafka_consumergroup_lag)",
          legendFormat: "{{project}}/{{consumergroup}}/{{topic}}",
        }],
      },
      {
        id: 10,
        type: "logs",
        title: "Recent logs (all services in tenant)",
        gridPos: { h: 10, w: 24, x: 0, y: 32 },
        datasource: { type: "loki", uid: "loki" },
        targets: [{
          refId: "A",
          expr: `{tenant="${tenantName}"}`,
        }],
        options: { showTime: true, wrapLogMessage: false, sortOrder: "Descending" },
      },
    ],
  };
  return JSON.stringify(dashboard, null, 2);
}

export function buildGrafanaDashboardProvider(): string {
  return [
    "apiVersion: 1",
    "providers:",
    "  - name: blissful-infra",
    "    orgId: 1",
    "    folder: ''",
    "    type: file",
    "    disableDeletion: false",
    "    updateIntervalSeconds: 10",
    "    allowUiUpdates: true",
    "    options:",
    "      path: /var/lib/grafana/dashboards",
    "",
  ].join("\n");
}

// ─── Top-level writer ────────────────────────────────────────────────────────

export async function writeTenantCompose(
  config: TenantConfig,
  ports: TenantPortBlock,
  projectComposeIncludes: string[],
): Promise<void> {
  TenantConfigSchema.parse(config);

  const tenantDir = getTenantDir(config.name);
  await fs.mkdir(tenantDir, { recursive: true });

  const obs = config.infrastructure.observability;

  if (obs.prometheus) {
    const dir = path.join(tenantDir, "prometheus");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "prometheus.yml"), buildPrometheusYml());
  }

  if (obs.tempo) {
    const dir = path.join(tenantDir, "tempo");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "tempo.yaml"), buildTempoYaml());
  }

  if (obs.loki) {
    const dir = path.join(tenantDir, "loki");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "loki-config.yaml"), buildLokiConfig());
    await fs.writeFile(path.join(dir, "promtail-config.yaml"), buildPromtailConfig());
  }

  if (obs.grafana) {
    const provDS = path.join(tenantDir, "grafana", "provisioning", "datasources");
    const provDash = path.join(tenantDir, "grafana", "provisioning", "dashboards");
    const dashDir = path.join(tenantDir, "grafana", "dashboards");
    await fs.mkdir(provDS, { recursive: true });
    await fs.mkdir(provDash, { recursive: true });
    await fs.mkdir(dashDir, { recursive: true });
    await fs.writeFile(path.join(provDS, "datasources.yaml"), buildGrafanaDatasources());
    await fs.writeFile(path.join(provDash, "dashboards.yaml"), buildGrafanaDashboardProvider());
    // The tenant overview dashboard ships pre-populated so the user lands
    // on real charts the moment they open Grafana.
    await fs.writeFile(path.join(dashDir, "tenant-overview.json"), buildTenantOverviewDashboard(config.name));
  }

  const yamlOut = buildTenantComposeYaml({ config, ports, projectComposeIncludes });
  await fs.writeFile(path.join(tenantDir, "docker-compose.tenant.yaml"), yamlOut);
}

export function projectComposeIncludePath(projectName: string): string {
  return `./projects/${projectName}/docker-compose.project.yaml`;
}
