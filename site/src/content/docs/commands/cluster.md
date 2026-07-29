---
title: blissful-infra cluster
description: Manage the tenant's local Kubernetes cluster. kind provisioned by Terraform, with ArgoCD, Argo Rollouts and Gitea installed by Helm.
---

A tenant can own a local Kubernetes cluster. `cluster` provisions it with Terraform: a [kind](https://kind.sigs.k8s.io/) cluster running ArgoCD, Argo Rollouts and Gitea.

```bash
blissful-infra cluster up
```

## Prerequisites

```bash
brew install kind kubectl hashicorp/tap/terraform argoproj/tap/kubectl-argo-rollouts
```

Plus Docker Desktop, running. These are only needed for the kubernetes runtime. The default compose runtime needs none of them.

## Subcommands

| Command | What it does |
|---|---|
| `cluster up [tenant]` | Provision the cluster with ArgoCD, Argo Rollouts and Gitea |
| `cluster down [tenant]` | Destroy the cluster (`terraform destroy`) |
| `cluster status [tenant]` | Show cluster status and platform pods |

The tenant resolves from your [`use`](/commands/use) context when omitted.

## cluster up

```bash
blissful-infra cluster up
```

Expect **3-5 minutes** on the first run: Terraform downloads providers and Helm pulls the ArgoCD, Argo Rollouts and Gitea charts. Subsequent runs are much faster.

When it finishes it prints the ArgoCD and Gitea URLs and their credentials. The cluster is named `blissful-<tenant>`, and the Terraform workspace lives at `~/.blissful-infra/tenants/<tenant>/cluster/`.

### What gets installed

| Component | Role |
|---|---|
| **kind** | The cluster itself, one Docker container per node |
| **ArgoCD** | Watches the Gitea repo and syncs manifests into the cluster |
| **Argo Rollouts** | Runs the canary rollout: traffic weights, pauses, promotion |
| **Gitea** | The in-cluster git server holding the gitops repo |

Gitea is what makes the GitOps loop real rather than simulated: `deploy` pushes rendered manifests as a commit, and ArgoCD syncs from that commit. Every deploy is an auditable commit you can inspect or revert.

## cluster status

```bash
blissful-infra cluster status
```

Shows whether the cluster is up and lists the platform pods, so you can tell an ArgoCD problem from an application problem.

## cluster down

```bash
blissful-infra cluster down
```

Runs `terraform destroy`. The kind cluster and everything in it goes away, including the Gitea repo and its deploy history. The tenant's compose-side infrastructure is untouched.

## Ports

Cluster ports come from the tenant's block. The first tenant gets:

| Component | Port |
|---|---|
| Gitea | 3300 |
| Kubernetes API | 6550 |
| ArgoCD | 8440 |

These bases were chosen clear of every other range in use, and of Docker Desktop's own 6443.

## See also

- [The golden path](/guides/golden-path): the full flow end to end
- [`deploy`](/commands/deploy): ship a service to the cluster
- [`canary`](/commands/canary): drive the rollout
