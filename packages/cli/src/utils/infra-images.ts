import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ora from "ora";
import { execa } from "execa";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..", "..", "..");
const JENKINS_TEMPLATE_DIR = path.join(__dirname, "..", "..", "templates", "jenkins");
const JENKINS_BUILD_DIR = path.join(os.homedir(), ".blissful-infra", "jenkins");

async function imageExists(image: string): Promise<boolean> {
  try {
    await execa("docker", ["image", "inspect", image], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export async function ensureDashboardImage(): Promise<void> {
  if (await imageExists("blissful-infra-dashboard:latest")) return;

  const spinner = ora("Building dashboard image (first time only)...").start();
  try {
    await execa("docker", [
      "build", "-f", "Dockerfile.dashboard",
      "-t", "blissful-infra-dashboard:latest", ".",
    ], { cwd: REPO_ROOT, stdio: "pipe" });
    spinner.succeed("Dashboard image built");
  } catch (error) {
    spinner.fail("Failed to build dashboard image");
    throw error;
  }
}

export async function ensureJenkinsImage(): Promise<void> {
  if (await imageExists("blissful-jenkins:latest")) return;

  await fs.mkdir(JENKINS_BUILD_DIR, { recursive: true });

  // Copy the Jenkins template files (Dockerfile + JCasC config) into the build dir
  const files = await fs.readdir(JENKINS_TEMPLATE_DIR);
  for (const file of files) {
    const src = path.join(JENKINS_TEMPLATE_DIR, file);
    const dest = path.join(JENKINS_BUILD_DIR, file);
    const stat = await fs.stat(src);
    if (stat.isFile()) {
      await fs.copyFile(src, dest);
    }
  }

  const spinner = ora("Building Jenkins image with plugins (first time only, ~2 min)...").start();
  try {
    await execa("docker", ["build", "-t", "blissful-jenkins:latest", "."], {
      cwd: JENKINS_BUILD_DIR,
      stdio: "pipe",
    });
    spinner.succeed("Jenkins image built");
  } catch (error) {
    spinner.fail("Failed to build Jenkins image");
    throw error;
  }
}
