import { type ProjectConfig } from "@blissful-infra/shared";
import { DeployTargetError } from "./errors.js";

export interface DeployOptions {
  dryRun?: boolean;
}

export async function deployProject(
  config: ProjectConfig,
  projectDir: string,
  opts: DeployOptions
): Promise<void> {
  const target = config.deploy?.target ?? "local-only";

  switch (target) {
    case "cloudflare": {
      const { deploy } = await import("./cloudflare.js");
      return deploy(config, projectDir, opts);
    }
    case "vercel": {
      const { deploy } = await import("./vercel.js");
      return deploy(config, projectDir, opts);
    }
    case "aws": {
      const { deploy } = await import("./aws.js");
      return deploy(config, projectDir, opts);
    }
    case "local-only":
      throw new DeployTargetError(
        'deploy.target is "local-only". Set it to cloudflare, vercel, or aws in blissful-infra.yaml.'
      );
    default:
      throw new DeployTargetError(`Unknown deploy target: "${target}"`);
  }
}
