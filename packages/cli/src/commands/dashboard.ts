import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import path from "node:path";
import os from "node:os";
import { execa } from "execa";
import { writeHostDashboardCompose, HOST_DASHBOARD_PORT, HOST_DASHBOARD_CONTAINER } from "../utils/host-dashboard-compose.js";
import { ensureDashboardImage } from "../utils/infra-images.js";
import { toExecError } from "../utils/errors.js";

/**
 * Dashboard lifecycle (ADR-0017 update, 2026-05-26): one host-level control
 * plane manages every tenant. Lives at `~/.blissful-infra/docker-compose.dashboard.yaml`
 * on port 3002, separate from any tenant's network.
 */

function getBlissfulHome(): string {
  return process.env.BLISSFUL_HOME ?? path.join(os.homedir(), ".blissful-infra");
}

async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  try {
    if (platform === "darwin") await execa("open", [url]);
    else if (platform === "win32") await execa("cmd", ["/c", "start", url]);
    else await execa("xdg-open", [url]);
  } catch { /* silent */ }
}

async function isDashboardRunning(): Promise<boolean> {
  try {
    const { stdout } = await execa("docker", [
      "ps", "--filter", `name=${HOST_DASHBOARD_CONTAINER}`, "--format", "{{.Status}}",
    ], { stdio: "pipe" });
    return stdout.includes("Up");
  } catch {
    return false;
  }
}

async function dashboardUpAction(opts: { open?: boolean }): Promise<void> {
  await ensureDashboardImage();
  const composePath = await writeHostDashboardCompose();
  const spinner = ora("Starting dashboard...").start();
  try {
    await execa("docker", [
      "compose", "-f", composePath, "up", "-d",
    ], { stdio: "pipe" });
    spinner.succeed(`Dashboard running at http://localhost:${HOST_DASHBOARD_PORT}`);
  } catch (err) {
    spinner.fail("Failed to start dashboard");
    const e = toExecError(err);
    if (e.stderr) console.error(chalk.red(e.stderr));
    process.exit(1);
  }
  if (opts.open !== false) {
    await openBrowser(`http://localhost:${HOST_DASHBOARD_PORT}`);
  }
}

async function dashboardDownAction(): Promise<void> {
  const composePath = path.join(getBlissfulHome(), "docker-compose.dashboard.yaml");
  const spinner = ora("Stopping dashboard...").start();
  try {
    await execa("docker", ["compose", "-f", composePath, "down"], { stdio: "pipe" });
    spinner.succeed("Dashboard stopped");
  } catch (err) {
    spinner.fail("Failed to stop dashboard");
    const e = toExecError(err);
    if (e.stderr) console.error(chalk.red(e.stderr));
    process.exit(1);
  }
}

async function dashboardStatusAction(): Promise<void> {
  const up = await isDashboardRunning();
  if (up) {
    console.log(chalk.green(`✓ Dashboard running at http://localhost:${HOST_DASHBOARD_PORT}`));
  } else {
    console.log(chalk.dim("Dashboard is not running."));
    console.log(chalk.dim("Start with: ") + chalk.cyan("blissful-infra dashboard up"));
  }
}

async function dashboardOpenAction(): Promise<void> {
  if (!(await isDashboardRunning())) {
    console.error(chalk.red("Dashboard is not running."));
    console.error(chalk.dim("Start with: ") + chalk.cyan("blissful-infra dashboard up"));
    process.exit(1);
  }
  await openBrowser(`http://localhost:${HOST_DASHBOARD_PORT}`);
}

export const dashboardCommand = new Command("dashboard")
  .description("Host-level dashboard (single control plane for every tenant)");

dashboardCommand
  .command("up")
  .description("Start the dashboard and open it in your browser")
  .option("--no-open", "Skip opening the browser")
  .action(dashboardUpAction);

dashboardCommand
  .command("down")
  .description("Stop the dashboard")
  .action(dashboardDownAction);

dashboardCommand
  .command("status")
  .description("Show dashboard status")
  .action(dashboardStatusAction);

dashboardCommand
  .command("open")
  .description("Open the running dashboard in your browser")
  .action(dashboardOpenAction);
