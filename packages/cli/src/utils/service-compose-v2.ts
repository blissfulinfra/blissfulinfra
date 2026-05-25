import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import {
  ServiceConfigV2Schema,
  type ServiceConfigV2,
  type ServicePorts,
  type ProjectConfig,
} from "@blissful-infra/shared";
import { getServiceDir } from "./tenant-registry.js";

/**
 * Generate the per-service docker-compose.yaml. The service joins the
 * project's Docker network and reaches Kafka/Postgres/Gateway by hostname.
 *
 * Env vars injected by default:
 *   - DB_HOST=postgres, DB_PORT=5432, DB_USER/PASSWORD, DB_SCHEMA=<auto>
 *     (only when the service has a `database` block in service.yaml)
 *   - KAFKA_BOOTSTRAP_SERVERS=kafka:9092 (when project has kafka enabled)
 *
 * These match the DDD contract: a service touches its own schema + project
 * event bus, nothing else.
 */
export interface GenerateServiceComposeInput {
  service: ServiceConfigV2;
  project: ProjectConfig;
  ports: ServicePorts;
}

export function buildServiceComposeYaml(input: GenerateServiceComposeInput): string {
  const { service, project, ports } = input;
  const containerName = `${service.tenant}-${service.project}-${service.name}`;
  const projectNet = `${service.tenant}_${service.project}`;

  const environment: Record<string, string> = {};

  // Database injection — only services that opted into the project's Postgres.
  if (service.database && project.infrastructure.postgres) {
    environment.DB_HOST = "postgres";
    environment.DB_PORT = "5432";
    environment.DB_NAME = "app";
    environment.DB_USER = "postgres";
    environment.DB_PASSWORD = "postgres";
    environment.DB_SCHEMA = service.database.schema;
    environment.DB_URL = `jdbc:postgresql://postgres:5432/app?currentSchema=${service.database.schema}`;
  }

  // Project event bus — every service in the project can publish/consume.
  if (project.infrastructure.kafka) {
    environment.KAFKA_BOOTSTRAP_SERVERS = "kafka:9092";
  }

  // Project-level Redis — shared cache + pub/sub for every service.
  if (project.infrastructure.redis) {
    environment.REDIS_URL  = "redis://redis:6379";
    environment.REDIS_HOST = "redis";
    environment.REDIS_PORT = "6379";
  }

  // Identity — useful for logging, tracing, gateway routing.
  environment.SERVICE_NAME = service.name;
  environment.PROJECT_NAME = service.project;
  environment.TENANT_NAME = service.tenant;

  const depends: Record<string, { condition: string }> = {};
  if (service.database && project.infrastructure.postgres) {
    depends.postgres = { condition: "service_healthy" };
  }
  if (project.infrastructure.kafka && service.serviceType !== "frontend") {
    depends.kafka = { condition: "service_healthy" };
  }

  // Port mappings — backend/frontend expose HTTP; workers don't.
  const portMappings: string[] = [];
  if (ports.http && (service.serviceType === "backend" || service.serviceType === "frontend")) {
    portMappings.push(`${ports.http}:8080`);
  }

  const serviceDef: Record<string, unknown> = {
    container_name: containerName,
    build: { context: "." },
    networks: ["project"],
    environment,
    // Explicit blissful labels so Promtail can tag every log line and
    // Prometheus can discover scrape targets. We expose the HOST port +
    // metrics path so Prometheus (which lives on the tenant network) can
    // scrape via host.docker.internal regardless of the project's isolated
    // network. Only backends declare a scrape path — frontends + workers
    // don't expose Spring-style /actuator endpoints.
    labels: {
      "com.blissful.tenant":  service.tenant,
      "com.blissful.project": service.project,
      "com.blissful.service": service.name,
      ...(service.serviceType === "backend" && ports.http ? {
        "com.blissful.metrics_port": String(ports.http),
        "com.blissful.metrics_path": "/actuator/prometheus",
      } : {}),
    },
  };
  if (portMappings.length > 0) serviceDef.ports = portMappings;
  if (Object.keys(depends).length > 0) serviceDef.depends_on = depends;

  // The service compose is always included from the project compose, never
  // run standalone. The project compose declares `networks.project` and
  // creates it. We re-declare the same name here (without `external: true`)
  // so the YAML stands alone for validation, but the merged compose project
  // creates the network exactly once via the parent.
  const compose: Record<string, unknown> = {
    networks: {
      project: { name: projectNet },
    },
    services: {
      [service.name]: serviceDef,
    },
  };

  return yaml.dump(compose, { lineWidth: 120, noRefs: true });
}

export async function writeServiceCompose(
  service: ServiceConfigV2,
  project: ProjectConfig,
  ports: ServicePorts,
): Promise<void> {
  ServiceConfigV2Schema.parse(service);

  const serviceDir = getServiceDir(service.tenant, service.project, service.name);
  await fs.mkdir(serviceDir, { recursive: true });

  const yamlOut = buildServiceComposeYaml({ service, project, ports });
  await fs.writeFile(path.join(serviceDir, "docker-compose.yaml"), yamlOut);
}
