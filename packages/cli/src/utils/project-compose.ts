import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import {
  ProjectConfigSchema,
  type ProjectConfig,
  type ProjectPortBlock,
} from "@blissful-infra/shared";
import { getProjectDir, getServiceDir } from "./tenant-registry.js";

/**
 * Generate the project-level docker-compose at the project directory.
 *
 * Per ADR-0017 the project owns the event bus (Kafka), the shared Postgres
 * instance (with per-service schemas), and the API gateway. Services inside
 * the project join the project's Docker network and address these by hostname.
 *
 * Two networks are referenced:
 *   - `<tenant>_<project>` (project-scoped) — Kafka, Postgres, gateway,
 *     services. This is the bounded-context wall.
 *   - `<tenant>_tenant` (tenant-scoped, external) — only the gateway joins it
 *     so observability + cross-project traffic can hit a single ingress.
 *
 * Service composes are included via `include:` so `docker compose up` from
 * the project dir brings up the project infra + every service in one go.
 */
export interface GenerateProjectComposeInput {
  config: ProjectConfig;
  ports: ProjectPortBlock;
  /** Paths (relative to the project dir) of each service's docker-compose.yaml. */
  serviceComposeIncludes: string[];
  /** Service names with auto-DB schemas, used to seed the init script. */
  databaseSchemas: string[];
}

export function buildProjectComposeYaml(input: GenerateProjectComposeInput): string {
  const { config, ports } = input;
  const projectNet = `${config.tenant}_${config.name}`;

  const services: Record<string, unknown> = {};
  const volumes: Record<string, null> = {};

  // Common labels stamped on every project-level infra container so Promtail
  // can tag log lines with the tenant/project path.
  const blissfulLabels = {
    "com.blissful.tenant":  config.tenant,
    "com.blissful.project": config.name,
  };

  if (config.infrastructure.kafka) {
    services[`kafka`] = {
      image: "confluentinc/cp-kafka:7.6.0",
      container_name: `${config.tenant}-${config.name}-kafka`,
      hostname: "kafka",
      networks: ["project"],
      ports: [`${ports.kafka}:9092`],
      environment: {
        // KRaft (no Zookeeper) — modern Kafka mode
        KAFKA_NODE_ID: "1",
        KAFKA_PROCESS_ROLES: "broker,controller",
        KAFKA_CONTROLLER_QUORUM_VOTERS: "1@kafka:29093",
        KAFKA_LISTENERS: "PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:29093",
        KAFKA_ADVERTISED_LISTENERS: `PLAINTEXT://kafka:9092`,
        KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: "PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT",
        KAFKA_INTER_BROKER_LISTENER_NAME: "PLAINTEXT",
        KAFKA_CONTROLLER_LISTENER_NAMES: "CONTROLLER",
        KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: "1",
        KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: "1",
        KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: "1",
        KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true",
        CLUSTER_ID: "MkU3OEVBNTcwNTJENDM2Qk",
      },
      healthcheck: {
        test: ["CMD-SHELL", "kafka-topics --bootstrap-server localhost:9092 --list || exit 1"],
        interval: "10s",
        timeout: "5s",
        retries: 10,
        start_period: "20s",
      },
      labels: { ...blissfulLabels, "com.blissful.service": "kafka" },
    };

    // kafka_exporter sidecar — broker / topic / consumer group metrics.
    // Uses the Kafka protocol (not JMX) so no agent wiring inside the broker.
    services[`kafka-exporter`] = {
      image: "danielqsj/kafka-exporter:v1.7.0",
      container_name: `${config.tenant}-${config.name}-kafka-exporter`,
      networks: ["project"],
      ports: [`${ports.kafkaExporter}:9308`],
      command: ["--kafka.server=kafka:9092"],
      depends_on: { kafka: { condition: "service_healthy" } },
      labels: {
        ...blissfulLabels,
        "com.blissful.service": "kafka-exporter",
        "com.blissful.metrics_port": String(ports.kafkaExporter),
        "com.blissful.metrics_path": "/metrics",
      },
    };
  }

  if (config.infrastructure.postgres) {
    const volName = `${config.tenant}_${config.name}_postgres_data`;
    services[`postgres`] = {
      image: "postgres:15-alpine",
      container_name: `${config.tenant}-${config.name}-postgres`,
      hostname: "postgres",
      networks: ["project"],
      ports: [`${ports.postgres}:5432`],
      environment: {
        POSTGRES_USER: "postgres",
        POSTGRES_PASSWORD: "postgres",
        POSTGRES_DB: "app",
      },
      volumes: [
        `${volName}:/var/lib/postgresql/data`,
        "./postgres/init:/docker-entrypoint-initdb.d:ro",
      ],
      healthcheck: {
        test: ["CMD-SHELL", "pg_isready -U postgres -d app"],
        interval: "5s",
        timeout: "3s",
        retries: 10,
        start_period: "10s",
      },
      labels: { ...blissfulLabels, "com.blissful.service": "postgres" },
    };
    volumes[volName] = null;

    // postgres_exporter sidecar — translates Postgres internals into
    // Prometheus metrics (connection counts, query timings, table sizes,
    // replication lag). Prometheus discovers it via the metrics_port label.
    services[`postgres-exporter`] = {
      image: "prometheuscommunity/postgres-exporter:v0.15.0",
      container_name: `${config.tenant}-${config.name}-postgres-exporter`,
      networks: ["project"],
      ports: [`${ports.postgresExporter}:9187`],
      environment: {
        DATA_SOURCE_NAME: "postgresql://postgres:postgres@postgres:5432/app?sslmode=disable",
      },
      depends_on: { postgres: { condition: "service_healthy" } },
      labels: {
        ...blissfulLabels,
        "com.blissful.service": "postgres-exporter",
        "com.blissful.metrics_port": String(ports.postgresExporter),
        "com.blissful.metrics_path": "/metrics",
      },
    };
  }

  if (config.infrastructure.redis) {
    const volName = `${config.tenant}_${config.name}_redis_data`;
    services[`redis`] = {
      image: "redis:7-alpine",
      container_name: `${config.tenant}-${config.name}-redis`,
      hostname: "redis",
      networks: ["project"],
      ports: [`${ports.redis}:6379`],
      command: ["redis-server", "--appendonly", "yes"],
      volumes: [
        `${volName}:/data`,
      ],
      healthcheck: {
        test: ["CMD", "redis-cli", "ping"],
        interval: "5s",
        timeout: "3s",
        retries: 10,
        start_period: "5s",
      },
      labels: { ...blissfulLabels, "com.blissful.service": "redis" },
    };
    volumes[volName] = null;

    // redis_exporter sidecar — translates Redis INFO output into Prometheus
    // metrics (memory usage, command rate, key count, hit/miss ratio, replication).
    services[`redis-exporter`] = {
      image: "oliver006/redis_exporter:v1.58.0",
      container_name: `${config.tenant}-${config.name}-redis-exporter`,
      networks: ["project"],
      ports: [`${ports.redisExporter}:9121`],
      environment: {
        REDIS_ADDR: "redis://redis:6379",
      },
      depends_on: { redis: { condition: "service_healthy" } },
      labels: {
        ...blissfulLabels,
        "com.blissful.service": "redis-exporter",
        "com.blissful.metrics_port": String(ports.redisExporter),
        "com.blissful.metrics_path": "/metrics",
      },
    };
  }

  if (config.infrastructure.gateway) {
    services[`gateway`] = {
      image: "caddy:2-alpine",
      container_name: `${config.tenant}-${config.name}-gateway`,
      hostname: "gateway",
      networks: ["project", "tenant"],
      ports: [`${ports.gateway}:80`],
      volumes: [
        "./gateway/Caddyfile:/etc/caddy/Caddyfile:ro",
      ],
      labels: { ...blissfulLabels, "com.blissful.service": "gateway" },
    };
  }

  const compose: Record<string, unknown> = {
    name: `${config.tenant}_${config.name}`,
    networks: {
      project: { name: projectNet },
      // The tenant network is referenced by name only — no `external: true`.
      // When this compose runs standalone (`project up`), Compose creates the
      // network if it doesn't already exist (idempotent — `tenant up` may have
      // already made it). When included from the tenant compose, the parent's
      // declaration wins on merge. Either way the gateway lands on the right
      // network. (Declaring external here would conflict on merge.)
      tenant: { name: `${config.tenant}_tenant` },
    },
    services,
  };
  if (Object.keys(volumes).length) compose.volumes = volumes;

  if (input.serviceComposeIncludes.length > 0) {
    compose.include = input.serviceComposeIncludes.map(p => ({ path: p }));
  }

  return yaml.dump(compose, { lineWidth: 120, noRefs: true });
}

/**
 * Build the postgres init SQL that creates one schema per service. Idempotent
 * via CREATE SCHEMA IF NOT EXISTS so re-running on an existing volume is safe.
 */
export function buildPostgresInitSql(schemas: string[]): string {
  if (schemas.length === 0) {
    return "-- No service schemas declared yet — services that opt into\n" +
           "-- database isolation get a CREATE SCHEMA appended when added.\n";
  }
  return [
    "-- Generated by blissful-infra. Per-service schema isolation (ADR-0017).",
    "-- Each service has its own schema; cross-service queries should go via",
    "-- the gateway or the event bus, not direct SQL joins.",
    "",
    ...schemas.map(s => `CREATE SCHEMA IF NOT EXISTS ${s};`),
    "",
  ].join("\n");
}

/** Minimal Caddyfile — placeholder ingress. Real routing comes in a follow-up ADR. */
export function buildCaddyfile(projectName: string): string {
  return [
    "# Generated by blissful-infra (project gateway).",
    `# Project: ${projectName}`,
    "# Real routing config lands when the API-gateway ADR ships. For now this",
    "# is a placeholder so the gateway container has something to serve.",
    "",
    ":80 {",
    "  respond \"blissful-infra gateway for project '" + projectName + "'. Configure routes in Caddyfile.\" 200",
    "}",
    "",
  ].join("\n");
}

/**
 * Write the project's docker-compose.project.yaml and supporting config files
 * (postgres init script, Caddyfile) to disk.
 */
export async function writeProjectCompose(
  tenant: string,
  project: string,
  config: ProjectConfig,
  ports: ProjectPortBlock,
  serviceComposeIncludes: string[],
  databaseSchemas: string[],
): Promise<void> {
  ProjectConfigSchema.parse(config); // belt-and-braces validation

  const projectDir = getProjectDir(tenant, project);
  await fs.mkdir(projectDir, { recursive: true });

  if (config.infrastructure.postgres) {
    const initDir = path.join(projectDir, "postgres", "init");
    await fs.mkdir(initDir, { recursive: true });
    await fs.writeFile(
      path.join(initDir, "01-schemas.sql"),
      buildPostgresInitSql(databaseSchemas),
    );
  }

  if (config.infrastructure.gateway) {
    const gatewayDir = path.join(projectDir, "gateway");
    await fs.mkdir(gatewayDir, { recursive: true });
    await fs.writeFile(path.join(gatewayDir, "Caddyfile"), buildCaddyfile(project));
  }

  const yamlOut = buildProjectComposeYaml({
    config, ports, serviceComposeIncludes, databaseSchemas,
  });
  await fs.writeFile(path.join(projectDir, "docker-compose.project.yaml"), yamlOut);
}

/** Service compose include paths relative to the project dir. */
export function serviceComposeIncludePath(serviceName: string): string {
  return `./services/${serviceName}/docker-compose.yaml`;
}

/** Resolve the absolute path to a service's compose file. Used by service.up. */
export function serviceComposePath(tenant: string, project: string, service: string): string {
  return path.join(getServiceDir(tenant, project, service), "docker-compose.yaml");
}
