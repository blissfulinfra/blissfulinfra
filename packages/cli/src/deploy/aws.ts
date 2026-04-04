import chalk from "chalk";
import ora from "ora";
import { execa } from "execa";
import { type ProjectConfig } from "@blissful-infra/shared";
import { PrereqMissingError } from "./errors.js";
import { type DeployOptions } from "./index.js";

async function checkAwsAvailable(): Promise<string> {
  try {
    const { stdout } = await execa("aws", ["--version"], { stdio: "pipe" });
    return stdout.trim();
  } catch {
    throw new PrereqMissingError(
      "aws",
      "Install with: brew install awscli\nDocs: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
    );
  }
}

async function checkCdkAvailable(): Promise<void> {
  try {
    await execa("cdk", ["--version"], { stdio: "pipe" });
  } catch {
    throw new PrereqMissingError(
      "cdk",
      "Install with: npm install -g aws-cdk\nDocs: https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html"
    );
  }
}

export async function deploy(
  config: ProjectConfig,
  projectDir: string,
  opts: DeployOptions
): Promise<void> {
  const { dryRun = false } = opts;

  console.log();
  console.log(
    chalk.bold("Deploying to AWS") + (dryRun ? chalk.yellow(" [dry run]") : "")
  );
  console.log();

  const awsVersion = await checkAwsAvailable();
  await checkCdkAvailable();
  console.log(chalk.dim(`✓ ${awsVersion}`));
  console.log(chalk.dim("✓ cdk found"));

  const region = config.deploy?.aws?.region ?? "us-east-1";
  const cluster = config.deploy?.aws?.cluster ?? `${config.name}-cluster`;

  if (dryRun) {
    console.log();
    console.log(chalk.dim(`[dry-run] Would deploy to AWS region: ${region}`));
    console.log(chalk.dim(`[dry-run] ECS cluster: ${cluster}`));
    if (config.frontend) {
      console.log(chalk.dim("[dry-run] Frontend: S3 bucket + CloudFront distribution"));
    }
    if (config.backend) {
      console.log(chalk.dim("[dry-run] Backend: ECS Fargate service"));
    }
    console.log(chalk.dim("[dry-run] Would run: cdk deploy --all"));
    console.log();
    console.log(chalk.yellow("Dry run complete — no changes were made."));
    return;
  }

  const spinner = ora(`Deploying CDK stacks to ${region}...`).start();
  try {
    await execa(
      "cdk",
      ["deploy", "--all", "--require-approval", "never"],
      { cwd: projectDir, stdio: "pipe" }
    );
    spinner.succeed("AWS CDK stacks deployed");
  } catch (err) {
    spinner.fail("CDK deploy failed");
    // Re-throw so the deploy command handler can format the error
    throw err;
  }

  console.log();
  console.log(chalk.green.bold("Deployment complete"));
  console.log(chalk.dim(`Region: ${region} | Cluster: ${cluster}`));
  console.log();
  console.log(
    chalk.dim("Run"),
    chalk.cyan("aws ecs list-services --cluster " + cluster),
    chalk.dim("to view running services.")
  );
}
