import { setTimeout as sleep } from "node:timers/promises";

/**
 * Gitea REST client for the tenant's in-cluster GitOps origin. Dev-grade
 * fixed credentials — they match templates/cluster/terraform/gitea-values.yaml
 * and only ever bind to localhost.
 */
export const GITEA_USER = "blissful";
export const GITEA_PASSWORD = "blissful-dev-pw";
/**
 * Repos live under the admin user (an org named like an existing user is a
 * Gitea name collision), so the owner segment of every repo URL is the user.
 */
export const GITEA_OWNER = GITEA_USER;

/** In-cluster URL ArgoCD's repo-server uses (gitea chart's http Service). */
export function giteaInClusterRepoUrl(tenant: string): string {
  return `http://gitea-http.gitea.svc.cluster.local:3000/${GITEA_OWNER}/${tenant}-gitops.git`;
}

/** Host-side push URL with embedded credentials (NodePort mapping). */
export function giteaPushUrl(tenant: string, giteaPort: number): string {
  return `http://${GITEA_USER}:${GITEA_PASSWORD}@localhost:${giteaPort}/${GITEA_OWNER}/${tenant}-gitops.git`;
}

function authHeader(): string {
  return "Basic " + Buffer.from(`${GITEA_USER}:${GITEA_PASSWORD}`).toString("base64");
}

async function giteaFetch(
  giteaPort: number,
  apiPath: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`http://localhost:${giteaPort}/api/v1${apiPath}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(10000),
  });
}

/**
 * Wait for Gitea to answer authenticated API calls. Right after `cluster up`
 * the pod can lag the helm release by a minute while sqlite migrates.
 */
export async function ensureGiteaReachable(giteaPort: number, timeoutMs = 120000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "unreachable";
  while (Date.now() < deadline) {
    try {
      const res = await giteaFetch(giteaPort, "/version");
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = (err as Error).message;
    }
    await sleep(3000);
  }
  throw new Error(
    `Gitea did not become reachable on http://localhost:${giteaPort} (${lastError}).\n` +
    `Is the cluster up?  blissful-infra cluster status`,
  );
}

/**
 * Ensure the tenant's gitops repo exists under the admin user. Idempotent —
 * 409/422 responses (already exists) are success.
 */
export async function ensureOrgRepo(
  tenant: string,
  giteaPort: number,
): Promise<{ pushUrl: string; inClusterUrl: string }> {
  const repoName = `${tenant}-gitops`;
  const repoRes = await giteaFetch(giteaPort, "/user/repos", {
    method: "POST",
    body: JSON.stringify({
      name: repoName,
      // auto_init gives the repo a main branch so the first clone works.
      auto_init: true,
      default_branch: "main",
      private: false,
    }),
  });
  if (!repoRes.ok && repoRes.status !== 409 && repoRes.status !== 422) {
    throw new Error(`Gitea repo create failed: HTTP ${repoRes.status} ${await repoRes.text().catch(() => "")}`);
  }

  return {
    pushUrl: giteaPushUrl(tenant, giteaPort),
    inClusterUrl: giteaInClusterRepoUrl(tenant),
  };
}

/**
 * Source repo for a service — where CI runs (ADR-0023). Distinct from the
 * tenant's single gitops repo, which holds rendered manifests.
 */
export function sourceRepoName(tenant: string, project: string, service: string): string {
  return `${tenant}-${project}-${service}`;
}

export function sourcePushUrl(tenant: string, project: string, service: string, giteaPort: number): string {
  return `http://${GITEA_USER}:${GITEA_PASSWORD}@localhost:${giteaPort}/${GITEA_OWNER}/${sourceRepoName(tenant, project, service)}.git`;
}

export function sourceWebUrl(tenant: string, project: string, service: string, giteaPort: number): string {
  return `http://localhost:${giteaPort}/${GITEA_OWNER}/${sourceRepoName(tenant, project, service)}`;
}

/** Create the service's source repo if absent. Idempotent. */
export async function ensureSourceRepo(
  tenant: string,
  project: string,
  service: string,
  giteaPort: number,
): Promise<string> {
  const res = await giteaFetch(giteaPort, "/user/repos", {
    method: "POST",
    body: JSON.stringify({
      name: sourceRepoName(tenant, project, service),
      auto_init: false,
      default_branch: "main",
      private: false,
    }),
  });
  if (!res.ok && res.status !== 409 && res.status !== 422) {
    throw new Error(`Gitea source repo create failed: HTTP ${res.status} ${await res.text().catch(() => "")}`);
  }
  return sourcePushUrl(tenant, project, service, giteaPort);
}

/**
 * A registration token for a new Actions runner. Gitea moved this between
 * GET and POST across versions, so try both.
 */
export async function getRunnerRegistrationToken(giteaPort: number): Promise<string> {
  for (const method of ["GET", "POST"] as const) {
    const res = await giteaFetch(giteaPort, "/admin/runners/registration-token", { method });
    if (res.ok) {
      const body = await res.json() as { token?: string };
      if (body.token) return body.token;
    }
  }
  throw new Error(
    "Could not get an Actions runner registration token from Gitea.\n" +
    "Is Actions enabled? (cluster up provisions it; recreate the cluster if this tenant predates ADR-0023)",
  );
}

/** Workflow runs for a service's source repo, newest first. */
export async function listWorkflowRuns(
  tenant: string,
  project: string,
  service: string,
  giteaPort: number,
): Promise<Array<{ status: string; conclusion: string | null; name: string; run_number: number; created_at: string }>> {
  const repo = sourceRepoName(tenant, project, service);
  const res = await giteaFetch(giteaPort, `/repos/${GITEA_OWNER}/${repo}/actions/tasks`);
  if (!res.ok) return [];
  const body = await res.json() as {
    workflow_runs?: Array<{ status: string; conclusion: string | null; name: string; run_number: number; created_at: string }>;
  };
  return body.workflow_runs ?? [];
}
