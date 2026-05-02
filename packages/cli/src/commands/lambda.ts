import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { getClientDir } from "../utils/client-registry.js";

interface LambdaCommonArgs {
  client: string;
  service: string;
}

async function ensureService(clientName: string, serviceName: string): Promise<string> {
  const serviceDir = path.join(getClientDir(clientName), serviceName);
  try {
    await fs.access(path.join(serviceDir, "lambda.yaml"));
  } catch {
    console.error(chalk.red(`No lambda.yaml at ${serviceDir} — is '${serviceName}' a lambda service?`));
    console.error(chalk.dim(`Create one with: blissful-infra service add ${clientName} ${serviceName} --backend lambda-python`));
    process.exit(1);
  }
  return serviceDir;
}

async function findLocalstackContainer(clientName: string, serviceName: string): Promise<string> {
  const expected = `${clientName}-${serviceName}-localstack`;
  const r = await execa("docker", ["ps", "--filter", `name=^${expected}$`, "--format", "{{.Names}}"], { reject: false });
  if (r.stdout.trim() !== expected) {
    console.error(chalk.red(`LocalStack container '${expected}' is not running.`));
    console.error(chalk.dim(`Run: blissful-infra service up ${clientName} ${serviceName}`));
    process.exit(1);
  }
  return expected;
}

async function lambdaDeployAction(args: LambdaCommonArgs): Promise<void> {
  const { client, service } = args;
  const serviceDir = await ensureService(client, service);
  const localstack = await findLocalstackContainer(client, service);

  const spinner = ora(`Deploying ${client}/${service} to LocalStack...`).start();

  // Re-run the deployer container against the running LocalStack. The compose
  // file already has the right env vars + volume mounts, so just compose-run it.
  const clientDir = getClientDir(client);
  try {
    await execa(
      "docker",
      [
        "compose",
        "-f", "docker-compose.infra.yaml",
        "run", "--rm",
        `${service}-deployer`,
      ],
      { cwd: clientDir, stdio: "inherit" },
    );
    spinner.succeed(`${client}/${service} redeployed`);
  } catch (e) {
    spinner.fail("Deploy failed — see output above");
    process.exit(1);
  }

  // Best-effort: print a hint
  console.log(chalk.dim(`  Invoke with: `) + chalk.cyan(`blissful-infra lambda invoke ${client} ${service}`));
  void serviceDir; void localstack;
}

async function lambdaInvokeAction(
  args: LambdaCommonArgs & { payload?: string },
): Promise<void> {
  const { client, service, payload } = args;
  await ensureService(client, service);
  const localstack = await findLocalstackContainer(client, service);

  const payloadJson = payload ?? "{}";
  // Validate JSON early — friendlier than a stack trace from awslocal
  try {
    JSON.parse(payloadJson);
  } catch (e) {
    console.error(chalk.red(`Invalid JSON in --payload: ${(e as Error).message}`));
    process.exit(1);
  }

  // Use docker exec so we run inside the LocalStack container's network and
  // its baked-in awslocal helper.
  const tmpOut = "/tmp/lambda-out.json";
  const r = await execa(
    "docker",
    [
      "exec", localstack,
      "awslocal", "lambda", "invoke",
      "--function-name", service,
      "--payload", payloadJson,
      "--cli-binary-format", "raw-in-base64-out",
      tmpOut,
    ],
    { reject: false, stdio: "pipe" },
  );

  if (r.exitCode !== 0) {
    console.error(chalk.red("Invoke failed:"));
    console.error(r.stderr || r.stdout);
    process.exit(r.exitCode ?? 1);
  }

  // Read the response payload from the container
  const cat = await execa("docker", ["exec", localstack, "cat", tmpOut], { reject: false });
  if (cat.exitCode === 0) {
    console.log(chalk.bold("Response:"));
    try {
      console.log(JSON.stringify(JSON.parse(cat.stdout), null, 2));
    } catch {
      console.log(cat.stdout);
    }
  }
  if (r.stdout.trim()) {
    // Status info from the invoke call (StatusCode, ExecutedVersion)
    console.log(chalk.dim("\nMetadata:"));
    try {
      console.log(JSON.stringify(JSON.parse(r.stdout), null, 2));
    } catch {
      console.log(r.stdout);
    }
  }
}

async function lambdaLogsAction(
  args: LambdaCommonArgs & { last?: boolean },
): Promise<void> {
  const { client, service, last } = args;
  await ensureService(client, service);
  const localstack = await findLocalstackContainer(client, service);

  const logGroup = `/aws/lambda/${service}`;

  if (last) {
    // Just the most recent stream
    const streams = await execa(
      "docker",
      [
        "exec", localstack,
        "awslocal", "logs", "describe-log-streams",
        "--log-group-name", logGroup,
        "--order-by", "LastEventTime",
        "--descending",
        "--limit", "1",
      ],
      { reject: false, stdio: "pipe" },
    );
    if (streams.exitCode !== 0) {
      console.error(chalk.dim("(no logs yet — invoke the function first)"));
      return;
    }
    const data = JSON.parse(streams.stdout);
    const streamName = data.logStreams?.[0]?.logStreamName;
    if (!streamName) {
      console.error(chalk.dim("(no log streams yet)"));
      return;
    }
    const events = await execa(
      "docker",
      [
        "exec", localstack,
        "awslocal", "logs", "get-log-events",
        "--log-group-name", logGroup,
        "--log-stream-name", streamName,
      ],
      { reject: false, stdio: "pipe" },
    );
    const eventData = JSON.parse(events.stdout);
    for (const e of eventData.events || []) {
      console.log(e.message);
    }
    return;
  }

  // Default: tail-style — show all events from all streams
  await execa(
    "docker",
    [
      "exec", localstack,
      "awslocal", "logs", "tail",
      logGroup,
      "--follow",
    ],
    { reject: false, stdio: "inherit" },
  );
}

export const lambdaCommand = new Command("lambda")
  .description("Manage AWS Lambda functions running locally on LocalStack");

lambdaCommand
  .command("deploy")
  .description("Re-package and deploy the function to the service's LocalStack")
  .argument("<client>", "Client name")
  .argument("<service>", "Service name (must be a lambda-python service)")
  .action(async (client: string, service: string) => {
    await lambdaDeployAction({ client, service });
  });

lambdaCommand
  .command("invoke")
  .description("Invoke the function and print the response")
  .argument("<client>", "Client name")
  .argument("<service>", "Service name")
  .option("-p, --payload <json>", "JSON payload to send as the event", "{}")
  .action(async (client: string, service: string, opts: { payload?: string }) => {
    await lambdaInvokeAction({ client, service, payload: opts.payload });
  });

lambdaCommand
  .command("logs")
  .description("Tail Lambda logs (CloudWatch logs emulated by LocalStack)")
  .argument("<client>", "Client name")
  .argument("<service>", "Service name")
  .option("--last", "Show only the most recent invocation's logs and exit", false)
  .action(async (client: string, service: string, opts: { last?: boolean }) => {
    await lambdaLogsAction({ client, service, last: opts.last });
  });
