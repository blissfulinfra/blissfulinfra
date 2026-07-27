#!/usr/bin/env bash
# Rebuild the CLI + dashboard and bring up the host control-plane dashboard.
# Tenant lifecycle is driven by the CLI directly:
#   blissful-infra tenant create <name> && blissful-infra use <name>
#   blissful-infra project create <project>
#   blissful-infra service add <service> --type backend
set -e

echo "→ Rebuilding shared + cli + dashboard..."
npm run build > /dev/null

echo "→ Starting the control-plane dashboard..."
node packages/cli/dist/index.js dashboard up

echo
echo "Dashboard: http://localhost:3002"
