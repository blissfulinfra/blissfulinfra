import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import path from "node:path";
import fs from "node:fs/promises";
import { execa } from "execa";
import { resolveOrExit } from "../utils/context.js";
import { getTenant, ensureClusterPorts, getClusterDir } from "../utils/tenant-registry.js";
import { ensureKind, ensureKubectl, clusterExists, clusterName, kubeContext, writeKubeconfig } from "../utils/kind.js";
import {
  ensureTerraform,
  renderClusterWorkspace,
  terraformInit,
  terraformApply,
  terraformDestroy,
} from "../utils/terraform.js";
import { PrereqMissingError } from "../deploy/errors.js";
import { toExecError } from "../utils/errors.js";

async function ensurePrereqs(): Promise<void> {
  await ensureTerraform();
  await ensureKind();
  await ensureKubectl();
  try {
    await execa("docker", ["info"], { stdio: "pipe" });
  } catch {
    throw new PrereqMissingError("docker", "Docker must be running (start Docker Desktop).");
  }
}

async function readArgoCDPassword(tenant: string): Promise<string | null> {
  try {
    const { stdout } = await execa("kubectl", [
      "--context", kubeContext(tenant),
      "-n", "argocd", "get", "secret", "argocd-initial-admin-secret",
      "-o", "jsonpath={.data.password}",
    ], { stdio: "pipe", timeout: 10000 });
    return Buffer.from(stdout, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

export async function clusterUpAction(tenantName: string): Promise<void> {
  console.log();
  console.log(chalk.bold("blissful-infra cluster up"), chalk.cyan(tenantName));
  console.log();

  const tenant = await getTenant(tenantName);
  if (!tenant) {
    console.error(chalk.red(`Tenant '${tenantName}' not found.`));
    console.error(chalk.cyan(`  blissful-infra tenant create ${tenantName}`));
    process.exit(1);
  }

  try {
    await ensurePrereqs();
  } catch (err) {
    if (err instanceof PrereqMissingError) {
      console.error(chalk.red(err.message));
      process.exit(1);
    }
    throw err;
  }

  const ports = await ensureClusterPorts(tenantName);
  const workspace = await renderClusterWorkspace(tenantName, ports);

  console.log(chalk.dim(`Terraform workspace: ${workspace}`));
  console.log(chalk.dim("Provisioning kind cluster + ArgoCD + Argo Rollouts + Gitea."));
  console.log(chalk.dim("First run downloads providers and helm charts — expect 3-5 minutes.\n"));

  try {
    await terraformInit(workspace);
    await terraformApply(workspace);
  } catch (err) {
    const e = toExecError(err);
    console.error(chalk.red("\nTerraform failed."));
    if (e.stderr) console.error(chalk.dim(e.stderr.slice(-2000)));
    console.error(chalk.dim(`Inspect / retry: terraform -chdir=${workspace} apply`));
    process.exit(1);
  }

  const kubeconfigFile = path.join(workspace, "kubeconfig");
  await writeKubeconfig(tenantName, kubeconfigFile);

  const argocdPassword = await readArgoCDPassword(tenantName);

  console.log();
  console.log(chalk.green.bold(`✓ Cluster '${clusterName(tenantName)}' is up.`));
  console.log();
  console.log(chalk.dim("  Kube API:    ") + chalk.cyan(`https://127.0.0.1:${ports.kubeApi}`) + chalk.dim(`  (context ${kubeContext(tenantName)})`));
  console.log(chalk.dim("  ArgoCD UI:   ") + chalk.cyan(`http://localhost:${ports.argocd}`) + chalk.dim(`  admin / ${argocdPassword ?? "(kubectl -n argocd get secret argocd-initial-admin-secret)"}`));
  console.log(chalk.dim("  Gitea:       ") + chalk.cyan(`http://localhost:${ports.gitea}`) + chalk.dim("  blissful / blissful-dev-pw"));
  console.log(chalk.dim("  Kubeconfig:  ") + chalk.cyan(kubeconfigFile));
  console.log();
  console.log(chalk.dim("Deploy a service:"));
  console.log(chalk.cyan("  blissful-infra project create <project> --runtime kubernetes"));
  console.log(chalk.cyan("  blissful-infra service add <service> --type backend"));
  console.log(chalk.cyan("  blissful-infra deploy <service>"));
  console.log();
}

export async function clusterDownAction(tenantName: string): Promise<void> {
  const workspace = getClusterDir(tenantName);
  try {
    await fs.access(path.join(workspace, "main.tf"));
  } catch {
    console.error(chalk.red(`No cluster workspace for tenant '${tenantName}' (${workspace}).`));
    process.exit(1);
  }
  await ensureTerraform();
  const spinner = ora(`Destroying cluster '${clusterName(tenantName)}'...`).start();
  spinner.stopAndPersist();
  try {
    await terraformDestroy(workspace);
    console.log(chalk.green(`✓ Cluster '${clusterName(tenantName)}' destroyed.`));
  } catch (err) {
    const e = toExecError(err);
    console.error(chalk.red("Terraform destroy failed."));
    if (e.stderr) console.error(chalk.dim(e.stderr.slice(-2000)));
    process.exit(1);
  }
}

export async function clusterStatusAction(tenantName: string): Promise<void> {
  await ensureKind();
  const exists = await clusterExists(tenantName);
  console.log();
  console.log(chalk.bold(`Cluster: ${clusterName(tenantName)}`));
  if (!exists) {
    console.log(chalk.dim("  Status: not provisioned"));
    console.log(chalk.cyan(`  blissful-infra cluster up ${tenantName}`));
    console.log();
    return;
  }
  console.log(chalk.green("  Status: running"));
  const tenant = await getTenant(tenantName);
  if (tenant?.portBlock.argocd) {
    console.log(chalk.dim("  ArgoCD: ") + chalk.cyan(`http://localhost:${tenant.portBlock.argocd}`));
    console.log(chalk.dim("  Gitea:  ") + chalk.cyan(`http://localhost:${tenant.portBlock.gitea}`));
  }
  console.log();
  try {
    const { stdout } = await execa("kubectl", [
      "--context", kubeContext(tenantName),
      "get", "pods", "-A",
      "--field-selector", "status.phase!=Succeeded",
    ], { stdio: "pipe", timeout: 15000 });
    console.log(chalk.dim(stdout));
  } catch {
    console.log(chalk.yellow("  Could not reach the cluster (is Docker running?)"));
  }
  console.log();
}

export const clusterCommand = new Command("cluster")
  .description("Manage the tenant's local Kubernetes cluster (kind + ArgoCD + Argo Rollouts + Gitea, via Terraform)");

clusterCommand
  .command("up")
  .description("Provision the tenant's kind cluster with ArgoCD, Argo Rollouts and Gitea")
  .argument("[tenant]", "Tenant name (uses current context if omitted)")
  .action(async (tenantArg?: string) => {
    const { tenant } = await resolveOrExit([tenantArg], ["tenant"]);
    await clusterUpAction(tenant!);
  });

clusterCommand
  .command("down")
  .description("Destroy the tenant's cluster (terraform destroy)")
  .argument("[tenant]", "Tenant name (uses current context if omitted)")
  .action(async (tenantArg?: string) => {
    const { tenant } = await resolveOrExit([tenantArg], ["tenant"]);
    await clusterDownAction(tenant!);
  });

clusterCommand
  .command("status")
  .description("Show cluster status and platform pods")
  .argument("[tenant]", "Tenant name (uses current context if omitted)")
  .action(async (tenantArg?: string) => {
    const { tenant } = await resolveOrExit([tenantArg], ["tenant"]);
    await clusterStatusAction(tenant!);
  });
