#!/usr/bin/env bash
set -e

# Stop and remove all running blissful-infra project containers
echo "Bringing down blissful-infra projects..."
for dir in */; do
  if [ -f "${dir}docker-compose.yaml" ]; then
    echo "  stopping ${dir%/}"
    docker compose -f "${dir}docker-compose.yaml" down 2>/dev/null || true
  fi
done

# Stop Jenkins and registry
echo "Stopping Jenkins..."
docker rm -f blissful-jenkins blissful-registry 2>/dev/null || true

npm --prefix packages/cli run build
npm --prefix packages/dashboard run build
docker build --no-cache -f Dockerfile.dashboard -t blissful-infra-dashboard:latest .
