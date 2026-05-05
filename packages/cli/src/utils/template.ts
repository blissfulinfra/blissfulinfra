import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface TemplateVariables {
  projectName: string;
  database: string;
  deployTarget: string;
  // Phase 2 additions
  registryUrl?: string;
  namespace?: string;
  environment?: string;
  // Plugin instance variables
  instanceName?: string;
  apiPort?: number;
  // Active per-service plugin types (used for {{#IF_KEYCLOAK}} etc. conditionals).
  // Most of these were promoted to client-level (see clientInfra below) — kept
  // for backwards compatibility on legacy flat-model service-scoped plugins.
  plugins?: string[];
  // Client-level infrastructure components enabled on the parent client.
  // After ADRs 0008/0009/0010 promoted localstack/keycloak/clickhouse/mlflow/
  // mage to client level, the IF_<COMPONENT> template guards must also fire
  // when the *client* has them enabled — not just when the *service* does.
  clientInfra?: {
    keycloak?: boolean;
    localstack?: boolean;
    clickhouse?: boolean;
    mlflow?: boolean;
    mage?: boolean;
  };
  // Used to template the Keycloak realm name (= client name) into Spring
  // Boot's application.yaml and the React-Vite keycloak.ts default URL.
  clientName?: string;
}

export async function copyTemplate(
  templateName: string,
  destDir: string,
  variables: TemplateVariables
): Promise<void> {
  const templateDir = path.join(__dirname, "..", "..", "templates", templateName);

  // Check if template exists
  try {
    await fs.access(templateDir);
  } catch {
    throw new Error(`Template '${templateName}' not found at ${templateDir}`);
  }

  await copyDir(templateDir, destDir, variables);
}

// Directories that should never be copied out of a template
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "target", ".gradle"]);

async function copyDir(
  srcDir: string,
  destDir: string,
  variables: TemplateVariables
): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });

  const entries = await fs.readdir(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath, variables);
    } else {
      await copyFile(srcPath, destPath, variables);
    }
  }
}

// Binary file extensions that should not be processed for template variables
const BINARY_EXTENSIONS = new Set([
  '.jar', '.class', '.war', '.ear',
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.zip', '.tar', '.gz', '.bz2', '.7z',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.exe', '.dll', '.so', '.dylib',
  '.mp3', '.mp4', '.wav', '.avi', '.mov',
]);

function isBinaryFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

async function copyFile(
  srcPath: string,
  destPath: string,
  variables: TemplateVariables
): Promise<void> {
  if (isBinaryFile(srcPath)) {
    // Copy binary files directly without processing
    await fs.copyFile(srcPath, destPath);
  } else {
    // Process text files for template variables
    const content = await fs.readFile(srcPath, "utf-8");
    const processed = replaceVariables(content, variables);
    await fs.writeFile(destPath, processed);
  }
}

function replaceVariables(content: string, variables: TemplateVariables): string {
  let result = content;

  // Database conditionals
  const hasPostgres = variables.database === "postgres" || variables.database === "postgres-redis";
  const hasRedis = variables.database === "redis" || variables.database === "postgres-redis";
  const noDatabase = variables.database === "none";

  // Deploy target conditionals
  const isKubernetes = variables.deployTarget === "kubernetes" || variables.deployTarget === "cloud";
  const isCloud = variables.deployTarget === "cloud";
  const isLocalOnly = variables.deployTarget === "local-only";

  // Handle conditional blocks: {{#IF_POSTGRES}}...{{/IF_POSTGRES}}
  result = result.replace(
    /\{\{#IF_POSTGRES\}\}([\s\S]*?)\{\{\/IF_POSTGRES\}\}/g,
    hasPostgres ? "$1" : ""
  );

  // Handle conditional blocks: {{#IF_REDIS}}...{{/IF_REDIS}}
  result = result.replace(
    /\{\{#IF_REDIS\}\}([\s\S]*?)\{\{\/IF_REDIS\}\}/g,
    hasRedis ? "$1" : ""
  );

  // Handle negative conditional: {{#IF_NO_DATABASE}}...{{/IF_NO_DATABASE}}
  result = result.replace(
    /\{\{#IF_NO_DATABASE\}\}([\s\S]*?)\{\{\/IF_NO_DATABASE\}\}/g,
    noDatabase ? "$1" : ""
  );

  // Handle no postgres conditional: {{#IF_NO_POSTGRES}}...{{/IF_NO_POSTGRES}}
  result = result.replace(
    /\{\{#IF_NO_POSTGRES\}\}([\s\S]*?)\{\{\/IF_NO_POSTGRES\}\}/g,
    hasPostgres ? "" : "$1"
  );

  // Handle no redis conditional: {{#IF_NO_REDIS}}...{{/IF_NO_REDIS}}
  result = result.replace(
    /\{\{#IF_NO_REDIS\}\}([\s\S]*?)\{\{\/IF_NO_REDIS\}\}/g,
    hasRedis ? "" : "$1"
  );

  // Phase 2: Kubernetes/Cloud conditionals
  // Handle {{#IF_KUBERNETES}}...{{/IF_KUBERNETES}} - true for kubernetes or cloud targets
  result = result.replace(
    /\{\{#IF_KUBERNETES\}\}([\s\S]*?)\{\{\/IF_KUBERNETES\}\}/g,
    isKubernetes ? "$1" : ""
  );

  // Handle {{#IF_CLOUD}}...{{/IF_CLOUD}} - true only for cloud target
  result = result.replace(
    /\{\{#IF_CLOUD\}\}([\s\S]*?)\{\{\/IF_CLOUD\}\}/g,
    isCloud ? "$1" : ""
  );

  // Handle {{#IF_LOCAL_ONLY}}...{{/IF_LOCAL_ONLY}} - true only for local-only target
  result = result.replace(
    /\{\{#IF_LOCAL_ONLY\}\}([\s\S]*?)\{\{\/IF_LOCAL_ONLY\}\}/g,
    isLocalOnly ? "$1" : ""
  );

  // Plugin conditionals — fire when EITHER the per-service plugin is set
  // (legacy / power-user path) OR the parent client has the promoted client-
  // level component enabled (the recommended path post ADR-0008/0009).
  const hasKeycloak =
    (variables.plugins?.includes("keycloak") ?? false) ||
    (variables.clientInfra?.keycloak ?? false);
  result = result.replace(
    /\{\{#IF_KEYCLOAK\}\}([\s\S]*?)\{\{\/IF_KEYCLOAK\}\}/g,
    hasKeycloak ? "$1" : ""
  );

  const hasLocalStack =
    (variables.plugins?.includes("localstack") ?? false) ||
    (variables.clientInfra?.localstack ?? false);
  result = result.replace(
    /\{\{#IF_LOCALSTACK\}\}([\s\S]*?)\{\{\/IF_LOCALSTACK\}\}/g,
    hasLocalStack ? "$1" : ""
  );

  // Replace simple variables
  result = result
    .replace(/\{\{PROJECT_NAME\}\}/g, variables.projectName)
    .replace(/\{\{DATABASE\}\}/g, variables.database)
    .replace(/\{\{DEPLOY_TARGET\}\}/g, variables.deployTarget);

  // Phase 2 variables (with defaults)
  result = result
    .replace(/\{\{REGISTRY_URL\}\}/g, variables.registryUrl || "localhost:5050")
    .replace(/\{\{NAMESPACE\}\}/g, variables.namespace || variables.projectName)
    .replace(/\{\{ENVIRONMENT\}\}/g, variables.environment || "local");

  // Plugin instance variables
  result = result
    .replace(/\{\{INSTANCE_NAME\}\}/g, variables.instanceName || variables.projectName)
    .replace(/\{\{API_PORT\}\}/g, String(variables.apiPort || 8090));

  // Client-level identifiers — Keycloak realm name is the client name
  // (one realm per client; see generateKeycloakRealm).
  result = result
    .replace(/\{\{CLIENT_NAME\}\}/g, variables.clientName || variables.projectName)
    .replace(/\{\{KEYCLOAK_REALM\}\}/g, variables.clientName || variables.projectName);

  return result;
}

/** Exposed for template-watch mode in dev.ts */
export { replaceVariables, isBinaryFile };

/** Core project templates (backend / frontend scaffolding). */
export function getAvailableTemplates(): string[] {
  return ["spring-boot", "react-vite", "lambda-python"];
}

/** Built-in plugin types that live under templates/plugins/.
 *
 * NOTE: localstack and keycloak templates still exist on disk but are no
 * longer advertised as service-scoped plugins (ADRs 0008/0009). They were
 * promoted to client-level infrastructure. The templates remain so the
 * decommission doesn't break old service configs that still reference
 * `plugins: localstack` — those configs are filtered at read time
 * instead. New service scaffolding should not pick these up.
 */
export function getAvailablePlugins(): string[] {
  return ["ai-pipeline", "agent-service", "gatling"];
}

/** Plugin types that have been promoted to client-level infrastructure
 *  and should NOT be scaffolded as per-service plugins, even if a user
 *  passes them via `--plugins` or has them in an old config. */
export const PROMOTED_TO_CLIENT_LEVEL_PLUGINS = new Set([
  "localstack",
  "keycloak",
  // ai-pipeline isn't fully decomposed yet (ADR-0010 implementation pending),
  // so it stays as a per-service plugin for now.
]);

export function getTemplateDir(templateName: string): string {
  return path.join(__dirname, "..", "..", "templates", templateName);
}

/**
 * Copy a built-in plugin template into destDir.
 * Resolves to templates/plugins/<pluginType>/.
 */
export async function copyPlugin(
  pluginType: string,
  destDir: string,
  variables: TemplateVariables
): Promise<void> {
  return copyTemplate(`plugins/${pluginType}`, destDir, variables);
}

export async function linkTemplate(
  templateName: string,
  destDir: string
): Promise<void> {
  const templateDir = getTemplateDir(templateName);

  // Check if template exists
  try {
    await fs.access(templateDir);
  } catch {
    throw new Error(`Template '${templateName}' not found at ${templateDir}`);
  }

  // Create symlink to template directory
  await fs.symlink(templateDir, destDir, "dir");
}
