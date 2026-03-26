import { promises as fs } from "fs";
import path from "path";

/**
 * Deployment tracking storage using JSON Lines format.
 * Each line is a complete JSON object representing a deployment record.
 */

export interface DeploymentRecord {
  id: string;           // uuid or timestamp-based
  timestamp: number;    // Date.now()
  projectName: string;
  gitSha: string;
  status: "running" | "success" | "failed";
  latencyBefore?: number;  // P95 ms before deploy
  latencyAfter?: number;   // P95 ms after deploy (populated later)
  latencyDelta?: number;   // latencyAfter - latencyBefore
  regression: boolean;     // true if latencyDelta > 20%
  jaegerTraceUrl?: string; // link to Jaeger traces for the deploy window
}

const DATA_DIR = ".blissful-infra";
const DEPLOYMENTS_FILE = "deployments.jsonl";

/**
 * Get the data directory for a project
 */
function getDataDir(projectDir: string): string {
  return path.join(projectDir, DATA_DIR);
}

/**
 * Get the deployments file path for a project
 */
export function getDeploymentFilePath(projectDir: string): string {
  return path.join(getDataDir(projectDir), DEPLOYMENTS_FILE);
}

/**
 * Ensure the data directory exists
 */
async function ensureDataDir(projectDir: string): Promise<void> {
  const dataDir = getDataDir(projectDir);
  await fs.mkdir(dataDir, { recursive: true });
}

/**
 * Save a deployment record, appending to the JSONL file
 */
export async function saveDeployment(
  projectDir: string,
  record: DeploymentRecord
): Promise<void> {
  await ensureDataDir(projectDir);
  const filePath = getDeploymentFilePath(projectDir);
  const line = JSON.stringify(record) + "\n";
  await fs.appendFile(filePath, line, "utf8");
}

/**
 * Update an existing deployment record by rewriting the file
 */
export async function updateDeployment(
  projectDir: string,
  id: string,
  updates: Partial<DeploymentRecord>
): Promise<boolean> {
  const filePath = getDeploymentFilePath(projectDir);

  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    return false;
  }

  const lines = content.split("\n").filter((l) => l.trim());
  let found = false;

  const updatedLines = lines.map((line) => {
    try {
      const record = JSON.parse(line) as DeploymentRecord;
      if (record.id === id) {
        found = true;
        return JSON.stringify({ ...record, ...updates });
      }
    } catch {
      // Skip malformed lines unchanged
    }
    return line;
  });

  if (!found) {
    return false;
  }

  await fs.writeFile(filePath, updatedLines.join("\n") + "\n", "utf8");
  return true;
}

/**
 * Load the last N deployment records, returning newest first
 */
export async function loadDeployments(
  projectDir: string,
  limit = 50
): Promise<DeploymentRecord[]> {
  const filePath = getDeploymentFilePath(projectDir);

  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    return [];
  }

  const records: DeploymentRecord[] = [];

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as DeploymentRecord;
      records.push(record);
    } catch {
      // Skip invalid lines
    }
  }

  // Return newest first, limited to N records
  return records.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}
