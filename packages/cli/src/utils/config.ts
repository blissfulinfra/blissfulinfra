import fs from "node:fs/promises";
import path from "node:path";
import {
  ProjectConfigSchema,
  PluginInstanceSchema,
  type ProjectConfig,
  type PluginInstance,
  type PluginConfig,
} from "@blissful-infra/shared";

export type {
  ProjectConfig,
  PluginInstance,
  PluginConfig,
  PipelineConfig,
} from "@blissful-infra/shared";

/**
 * Parse plugin specs like "ai-pipeline", "ai-pipeline:classifier" into PluginInstance objects.
 */
export function parsePluginSpecs(specs: string[]): PluginInstance[] {
  return specs.map(spec => {
    const colonIndex = spec.indexOf(":");
    if (colonIndex === -1) {
      return PluginInstanceSchema.parse({ type: spec, instance: spec });
    }
    return PluginInstanceSchema.parse({
      type: spec.substring(0, colonIndex),
      instance: spec.substring(colonIndex + 1),
    });
  });
}

/**
 * Serialize plugin instances back to spec strings for YAML storage.
 */
export function serializePluginSpecs(plugins: PluginInstance[]): string {
  return plugins
    .map(p => p.type === p.instance ? p.type : `${p.type}:${p.instance}`)
    .join(",");
}

export async function loadConfig(projectDir?: string): Promise<ProjectConfig | null> {
  const configPath = path.join(projectDir || process.cwd(), "blissful-infra.yaml");

  try {
    const content = await fs.readFile(configPath, "utf-8");
    return parseYaml(content);
  } catch {
    return null;
  }
}

/**
 * Find a project directory by name, or use cwd if it contains blissful-infra.yaml.
 */
export async function findProjectDir(name?: string): Promise<string | null> {
  if (name) {
    const projectDir = path.join(process.cwd(), name);
    try {
      await fs.access(path.join(projectDir, "blissful-infra.yaml"));
      return projectDir;
    } catch {
      return null;
    }
  }

  try {
    await fs.access(path.join(process.cwd(), "blissful-infra.yaml"));
    return process.cwd();
  } catch {
    return null;
  }
}

function parseYaml(content: string): ProjectConfig {
  const config: Record<string, string> = {};

  for (const line of content.split("\n")) {
    if (line.trim().startsWith("#") || !line.trim()) {
      continue;
    }

    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      config[key] = value.trim();
    }
  }

  const raw = {
    name: config.name || "unnamed",
    backend: config.backend,
    frontend: config.frontend,
    database: config.database || "none",
    deploy: config.deploy_target ? { target: config.deploy_target } : undefined,
    monitoring: (config.monitoring === "default" ? "default" : "prometheus") as "default" | "prometheus",
    plugins: config.plugins ? parsePluginSpecs(config.plugins.split(",").map(p => p.trim()).filter(Boolean)) : undefined,
    pluginConfigs: parsePluginConfigs(content),
  };

  return ProjectConfigSchema.parse(raw);
}

function parsePluginConfigs(content: string): Record<string, PluginConfig> | undefined {
  const configs: Record<string, PluginConfig> = {};
  const lines = content.split("\n");
  let inPluginConfig = false;
  let currentInstance: string | null = null;

  for (const line of lines) {
    if (/^plugin_config:\s*$/.test(line)) {
      inPluginConfig = true;
      continue;
    }

    if (!inPluginConfig) continue;

    if (line.length > 0 && !line.startsWith(" ") && !line.startsWith("\t")) {
      break;
    }

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const instanceMatch = line.match(/^ {2}(\w[\w-]*):\s*$/);
    if (instanceMatch) {
      currentInstance = instanceMatch[1];
      configs[currentInstance] = {};
      continue;
    }

    const valueMatch = line.match(/^ {4}(\w[\w_]*):\s*(.+)$/);
    if (valueMatch && currentInstance && configs[currentInstance]) {
      const [, key, value] = valueMatch;
      const trimVal = value.trim();
      if (key === "port") {
        configs[currentInstance].port = parseInt(trimVal, 10);
      } else if (key === "mode") {
        configs[currentInstance].mode = trimVal;
      } else if (key === "events_topic") {
        configs[currentInstance].events_topic = trimVal;
      } else if (key === "predictions_topic") {
        configs[currentInstance].predictions_topic = trimVal;
      }
    }
  }

  return Object.keys(configs).length > 0 ? configs : undefined;
}
