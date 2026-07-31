#!/usr/bin/env bash
# One command from a fresh clone to the full Kubernetes golden path demo:
#   git clone https://github.com/cavanpage/blissful-infra.git && cd blissful-infra && ./demo.sh
#
# Installs workspace deps, builds the CLI + dashboard, then runs
# `blissful-infra demo`: kind cluster (Terraform) + ArgoCD + Argo Rollouts +
# Gitea, a hono service deployed via GitOps, and the dashboard on :3002.
#
# Prereqs (checked, not installed): Docker Desktop running, plus
#   brew install kind kubectl hashicorp/tap/terraform argoproj/tap/kubectl-argo-rollouts
set -e
cd "$(dirname "$0")"

echo "→ Installing dependencies..."
npm install --silent

echo "→ Building shared + cli + dashboard..."
npm run build > /dev/null

node packages/cli/dist/index.js demo
