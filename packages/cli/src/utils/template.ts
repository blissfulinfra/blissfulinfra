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

  return result;
}

/** Exposed for template-watch mode in dev.ts */
export { replaceVariables, isBinaryFile };

/** Core project templates (backend / frontend scaffolding). */
export function getAvailableTemplates(): string[] {
  return ["spring-boot", "react-vite"];
}

/** Built-in plugin types that live under templates/plugins/. */
export function getAvailablePlugins(): string[] {
  return ["ai-pipeline", "agent-service"];
}

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
