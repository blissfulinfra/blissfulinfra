#!/usr/bin/env bash
# Clean-rebuild script for blissful-infra (post ADR-0017).
#
# 1. Tears down every running tenant via the CLI (graceful)
# 2. Force-removes any stale containers/networks/volumes that match the
#    naming patterns blissful-infra uses, in case the CLI couldn't reach them
# 3. Wipes the registry + scaffolded directories
# 4. Rebuilds shared, CLI, dashboard, and the dashboard Docker image
# 5. Verifies nothing's left behind before exiting

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOME_DIR="${BLISSFUL_HOME:-$HOME/.blissful-infra}"

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
dim()   { printf '\033[2m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }

docker --version >/dev/null || { red "Docker not running"; exit 1; }

# ─── 1. Collect tenant names from the registry while it still exists ────────
TENANTS=()
if [[ -f "$HOME_DIR/registry.json" ]]; then
  TENANTS=($(node -e "
    try {
      const r = JSON.parse(require('fs').readFileSync('$HOME_DIR/registry.json', 'utf-8'));
      (r.tenants || []).forEach(t => console.log(t.name));
    } catch { /* registry missing or malformed */ }
  " 2>/dev/null || true))
fi

# ─── 2. Graceful CLI teardown ────────────────────────────────────────────────
if [[ ${#TENANTS[@]+x} && ${#TENANTS[@]} -gt 0 ]]; then
  bold "Removing tenants via CLI: ${TENANTS[*]}"
  for t in "${TENANTS[@]+"${TENANTS[@]}"}"; do
    dim "  tenant remove $t"
    if [[ -x "$REPO_ROOT/packages/cli/dist/index.js" ]]; then
      "$REPO_ROOT/packages/cli/dist/index.js" tenant remove "$t" --skip-prompts 2>/dev/null || true
    else
      # CLI not built yet — fall through to the docker-direct path below
      dim "    (CLI dist not built; will clean via docker)"
    fi
  done
else
  dim "No tenants in registry."
fi

# ─── 3. Force-remove any leftovers, per known tenant name ───────────────────
# Works as a safety net for tenants whose CLI removal failed (broken compose,
# stuck containers, registry desync, etc.).
bold "Force-removing leftover containers, networks, volumes..."
for t in "${TENANTS[@]+"${TENANTS[@]}"}"; do
  # Containers (project + service containers are named "<tenant>-..." or
  # "<tenant>-<project>-...")
  docker ps -a --filter "name=^${t}-" --format "{{.Names}}" 2>/dev/null \
    | xargs -r docker rm -f >/dev/null 2>&1 || true

  # Networks (tenant networks are "<tenant>_tenant", project networks are
  # "<tenant>_<project>")
  docker network ls --filter "name=^${t}_" --format "{{.Name}}" 2>/dev/null \
    | xargs -r docker network rm >/dev/null 2>&1 || true

  # Volumes (Postgres / Grafana / Jenkins all named "<tenant>_*")
  docker volume ls --filter "name=^${t}_" --format "{{.Name}}" 2>/dev/null \
    | xargs -r docker volume rm >/dev/null 2>&1 || true

  # Service images built by docker compose (named "<tenant>-<service>")
  docker images --filter "reference=${t}-*" --format "{{.Repository}}:{{.Tag}}" 2>/dev/null \
    | xargs -r docker rmi -f >/dev/null 2>&1 || true
done

# Legacy / client-model containers from earlier phases
docker rm -f blissful-jenkins blissful-registry 2>/dev/null || true

# ─── 4. Wipe the registry + scaffolded files ────────────────────────────────
bold "Wiping ${HOME_DIR}..."
rm -rf "$HOME_DIR"

# ─── 5. Optionally rebuild the dashboard / Jenkins images ───────────────────
# Comment these out to keep the cached images (saves ~3 min on first `tenant up`).
if [[ "${REBUILD_IMAGES:-1}" == "1" ]]; then
  bold "Rebuilding dashboard + Jenkins images..."
  docker rmi blissful-infra-dashboard:latest blissful-jenkins:latest 2>/dev/null || true
fi

# ─── 6. Rebuild the workspace ───────────────────────────────────────────────
bold "Building shared + CLI + dashboard..."
cd "$REPO_ROOT"
npm run build

if [[ "${REBUILD_IMAGES:-1}" == "1" ]]; then
  bold "Building blissful-infra-dashboard:latest..."
  docker build --no-cache -f Dockerfile.dashboard -t blissful-infra-dashboard:latest . >/dev/null
fi

# ─── 7. Verification ────────────────────────────────────────────────────────
echo
bold "Verifying clean state..."
ERRORS=0

verify() {
  local label="$1" cmd="$2" expected="$3"
  local actual; actual="$(eval "$cmd" | wc -l | tr -d ' ')"
  if [[ "$actual" == "$expected" ]]; then
    green "  ✓ $label  ($actual)"
  else
    red   "  ✗ $label  (expected $expected, got $actual)"
    ERRORS=$((ERRORS + 1))
  fi
}

# Containers / networks / volumes matching any prior tenant must be gone.
LEFTOVER_CONTAINERS=0
LEFTOVER_NETWORKS=0
LEFTOVER_VOLUMES=0
for t in "${TENANTS[@]+"${TENANTS[@]}"}"; do
  LEFTOVER_CONTAINERS=$((LEFTOVER_CONTAINERS + $(docker ps -a --filter "name=^${t}-" --format '{{.Names}}' 2>/dev/null | wc -l | tr -d ' ')))
  LEFTOVER_NETWORKS=$((LEFTOVER_NETWORKS + $(docker network ls --filter "name=^${t}_" --format '{{.Name}}' 2>/dev/null | wc -l | tr -d ' ')))
  LEFTOVER_VOLUMES=$((LEFTOVER_VOLUMES + $(docker volume ls --filter "name=^${t}_" --format '{{.Name}}' 2>/dev/null | wc -l | tr -d ' ')))
done

if [[ $LEFTOVER_CONTAINERS -eq 0 ]]; then green "  ✓ no leftover containers (0)"; else red "  ✗ $LEFTOVER_CONTAINERS leftover containers"; ERRORS=$((ERRORS + 1)); fi
if [[ $LEFTOVER_NETWORKS -eq 0 ]];   then green "  ✓ no leftover networks (0)";   else red "  ✗ $LEFTOVER_NETWORKS leftover networks";   ERRORS=$((ERRORS + 1)); fi
if [[ $LEFTOVER_VOLUMES -eq 0 ]];    then green "  ✓ no leftover volumes (0)";    else red "  ✗ $LEFTOVER_VOLUMES leftover volumes";    ERRORS=$((ERRORS + 1)); fi

# Registry must be gone
if [[ ! -e "$HOME_DIR" ]]; then
  green "  ✓ $HOME_DIR removed"
else
  red "  ✗ $HOME_DIR still exists"
  ERRORS=$((ERRORS + 1))
fi

# CLI dist must exist
if [[ -x "$REPO_ROOT/packages/cli/dist/index.js" ]]; then
  green "  ✓ CLI built (packages/cli/dist/index.js)"
else
  red "  ✗ CLI dist missing"
  ERRORS=$((ERRORS + 1))
fi

# Dashboard image must exist
if docker image inspect blissful-infra-dashboard:latest >/dev/null 2>&1; then
  green "  ✓ blissful-infra-dashboard:latest is present"
else
  yellow "  ! blissful-infra-dashboard:latest missing (will build on first tenant up)"
fi

echo
if [[ $ERRORS -eq 0 ]]; then
  green "✓ Clean rebuild complete. Try: blissful-infra init"
else
  red "✗ $ERRORS check(s) failed — see above"
  exit 1
fi
