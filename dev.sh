#!/usr/bin/env bash
# Bring up the local development environment used to dogfood blissful-infra.
#
# `dev-app` was migrated to the client model on 2026-04-30. The development
# environment now lives at ~/.blissful-infra/clients/dev/ as a regular client
# created by the CLI. This script:
#   1. Rebuilds the CLI + dashboard so changes are picked up
#   2. Brings the `dev` client up (creates it if it doesn't exist yet)
#
# To recreate from scratch:    blissful-infra client remove dev && ./dev.sh
# Daily up/down:                blissful-infra client up dev / down dev
# Logs for the app service:     blissful-infra service logs dev app
set -e

CLI="node packages/cli/dist/index.js"

echo "→ Rebuilding shared + cli + dashboard..."
npm run build > /dev/null

if ! $CLI client list 2>/dev/null | grep -q "^  dev "; then
  echo "→ 'dev' client not found, creating with backend + frontend + localstack..."
  # LocalStack is now client-level infra (ADR-0008), not a per-service plugin.
  $CLI client create dev --yes --localstack
  $CLI service add dev app --backend spring-boot --frontend react-vite
else
  echo "→ Bringing up 'dev' client..."
  $CLI client up dev
fi

echo
echo "Dev environment ready. Useful commands:"
echo "  blissful-infra client status dev"
echo "  blissful-infra service logs dev app"
echo "  blissful-infra client down dev"
