import chalk from "chalk";
import ora from "ora";
import { execa } from "execa";
import type { ProjectConfig } from "./config.js";

const LOCAL_REGISTRY_PORT = 5050;
const LOCAL_REGISTRY_NAME = "blissful-registry";

/**
 * Check if local Docker registry is running
 */
export async function isLocalRegistryRunning(): Promise<boolean> {
  try {
    const { stdout } = await execa("docker", [
      "ps",
      "--filter",
      `name=${LOCAL_REGISTRY_NAME}`,
      "--format",
      "{{.Status}}",
    ], { stdio: "pipe" });

    return stdout.includes("Up");
  } catch {
    return false;
  }
}

/**
 * Start local Docker registry
 */
export async function startLocalRegistry(): Promise<void> {
  const spinner = ora("Starting local registry...").start();

  try {
    // Check if already running
    if (await isLocalRegistryRunning()) {
      spinner.info("Local registry already running");
      return;
    }

    // Check if container exists but stopped
    const { stdout: existingContainer } = await execa("docker", [
      "ps",
      "-a",
      "--filter",
      `name=${LOCAL_REGISTRY_NAME}`,
      "--format",
      "{{.ID}}",
    ], { stdio: "pipe" });

    if (existingContainer.trim()) {
      // Start existing container
      await execa("docker", ["start", LOCAL_REGISTRY_NAME], { stdio: "pipe" });
    } else {
      // Create and start new container
      await execa("docker", [
        "run",
        "-d",
        "-p",
        `${LOCAL_REGISTRY_PORT}:5000`,
        "--name",
        LOCAL_REGISTRY_NAME,
        "--restart",
        "unless-stopped",
        "registry:2",
      ], { stdio: "pipe" });
    }

    spinner.succeed(`Local registry running at localhost:${LOCAL_REGISTRY_PORT}`);
  } catch (error) {
    spinner.fail("Failed to start local registry");
    throw error;
  }
}

/**
 * Stop local Docker registry
 */
export async function stopLocalRegistry(): Promise<void> {
  const spinner = ora("Stopping local registry...").start();

  try {
    await execa("docker", ["stop", LOCAL_REGISTRY_NAME], { stdio: "pipe" });
    spinner.succeed("Local registry stopped");
  } catch {
    spinner.info("Local registry not running");
  }
}

/**
 * Get registry URL from config
 */
export function getRegistryUrl(config: ProjectConfig): string {
  if (config.deploy?.aws?.registry) {
    return config.deploy.aws.registry.url;
  }

  // Default to local registry
  return `localhost:${LOCAL_REGISTRY_PORT}`;
}

/**
 * Get full image name with registry
 */
export function getImageName(config: ProjectConfig, tag = "latest"): string {
  const registryUrl = getRegistryUrl(config);
  return `${registryUrl}/${config.name}:${tag}`;
}

/**
 * Login to container registry
 */
export async function loginToRegistry(config: ProjectConfig): Promise<void> {
  const registry = config.deploy?.aws?.registry;

  if (!registry || registry.type === "local") {
    // Local registry doesn't require login
    return;
  }

  const spinner = ora(`Logging into ${registry.type}...`).start();

  try {
    switch (registry.type) {
      case "ecr": {
        // AWS ECR login
        const region = config.deploy?.aws?.region || "us-east-1";
        const { stdout: token } = await execa("aws", [
          "ecr",
          "get-login-password",
          "--region",
          region,
        ], { stdio: "pipe" });

        await execa("docker", [
          "login",
          "--username",
          "AWS",
          "--password-stdin",
          registry.url,
        ], {
          input: token,
          stdio: "pipe",
        });
        break;
      }

      case "gcr": {
        // Google Container Registry login
        await execa("gcloud", [
          "auth",
          "configure-docker",
          registry.url.split("/")[0],
          "--quiet",
        ], { stdio: "pipe" });
        break;
      }

      case "acr": {
        // Azure Container Registry login
        const acrName = registry.url.split(".")[0];
        await execa("az", [
          "acr",
          "login",
          "--name",
          acrName,
        ], { stdio: "pipe" });
        break;
      }
    }

    spinner.succeed(`Logged into ${registry.type}`);
  } catch (error) {
    spinner.fail(`Failed to login to ${registry.type}`);
    throw error;
  }
}

/**
 * Push image to registry
 */
export async function pushImage(imageName: string): Promise<void> {
  const spinner = ora(`Pushing ${imageName}...`).start();

  try {
    await execa("docker", ["push", imageName], { stdio: "pipe" });
    spinner.succeed(`Pushed ${imageName}`);
  } catch (error) {
    spinner.fail(`Failed to push ${imageName}`);
    throw error;
  }
}

/**
 * Tag image for registry
 */
export async function tagImage(sourceImage: string, targetImage: string): Promise<void> {
  await execa("docker", ["tag", sourceImage, targetImage], { stdio: "pipe" });
}

/**
 * Check if image exists in registry
 */
export async function imageExists(imageName: string): Promise<boolean> {
  try {
    await execa("docker", ["manifest", "inspect", imageName], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get available tags for an image in registry
 */
export async function getImageTags(config: ProjectConfig): Promise<string[]> {
  const registry = config.deploy?.aws?.registry;

  if (!registry || registry.type === "local") {
    // Query local registry
    try {
      const { stdout } = await execa("curl", [
        "-s",
        `http://localhost:${LOCAL_REGISTRY_PORT}/v2/${config.name}/tags/list`,
      ], { stdio: "pipe" });

      const response = JSON.parse(stdout);
      return response.tags || [];
    } catch {
      return [];
    }
  }

  // For cloud registries, use their CLI tools
  switch (registry.type) {
    case "ecr": {
      try {
        const { stdout } = await execa("aws", [
          "ecr",
          "list-images",
          "--repository-name",
          config.name,
          "--query",
          "imageIds[*].imageTag",
          "--output",
          "json",
        ], { stdio: "pipe" });
        return JSON.parse(stdout).filter((t: string | null) => t !== null);
      } catch {
        return [];
      }
    }

    case "gcr": {
      try {
        const { stdout } = await execa("gcloud", [
          "container",
          "images",
          "list-tags",
          `${registry.url}/${config.name}`,
          "--format",
          "json",
        ], { stdio: "pipe" });
        const tags = JSON.parse(stdout);
        return tags.flatMap((t: { tags: string[] }) => t.tags || []);
      } catch {
        return [];
      }
    }

    default:
      return [];
  }
}

/**
 * Print registry info
 */
export function printRegistryInfo(config: ProjectConfig): void {
  const registryUrl = getRegistryUrl(config);
  const registryType = config.deploy?.aws?.registry?.type || "local";

  console.log();
  console.log(chalk.bold("Registry Configuration:"));
  console.log(chalk.dim("  Type:"), registryType);
  console.log(chalk.dim("  URL:"), registryUrl);
  console.log(chalk.dim("  Image:"), getImageName(config));
  console.log();
}
