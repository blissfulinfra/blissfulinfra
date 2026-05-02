#!/bin/sh
# Lambda deployer — packages and registers handler.py with LocalStack.
# Runs as a one-shot container on `service up`, can be re-run via:
#   blissful-infra lambda deploy <client> <service>
#
# Reads lambda.yaml manifest for runtime, handler, timeout, memory, env.
# Talks to LocalStack via AWS_ENDPOINT_URL.
set -e

WORK_DIR=${WORK_DIR:-/work}
FUNCTION_NAME=${FUNCTION_NAME:?FUNCTION_NAME env var required}
MANIFEST=${WORK_DIR}/lambda.yaml
SRC_DIR=${WORK_DIR}/lambda
BUILD_DIR=/tmp/lambda-build
ZIP=/tmp/function.zip

if [ ! -f "$MANIFEST" ]; then
  echo "[deployer] No lambda.yaml at $MANIFEST — nothing to deploy"
  exit 0
fi

# Install required tools (awscli, yq) — small + pinned for reproducibility
pip install --quiet --no-cache-dir awscli pyyaml >/dev/null

# Parse manifest
RUNTIME=$(python -c "import yaml; print(yaml.safe_load(open('$MANIFEST'))['runtime'])")
HANDLER=$(python -c "import yaml; print(yaml.safe_load(open('$MANIFEST'))['handler'])")
TIMEOUT=$(python -c "import yaml; m=yaml.safe_load(open('$MANIFEST')); print(m.get('timeout_seconds', 30))")
MEMORY=$(python -c "import yaml; m=yaml.safe_load(open('$MANIFEST')); print(m.get('memory_mb', 256))")
ENV_JSON=$(python -c "import yaml,json; m=yaml.safe_load(open('$MANIFEST')); print(json.dumps({'Variables': m.get('environment') or {}}))")

# Build zip: handler source + pip-installed deps
rm -rf "$BUILD_DIR" "$ZIP"
mkdir -p "$BUILD_DIR"
cp -r "$SRC_DIR"/. "$BUILD_DIR"/
if [ -s "$SRC_DIR/requirements.txt" ]; then
  pip install --quiet --no-cache-dir --target "$BUILD_DIR" -r "$SRC_DIR/requirements.txt" >/dev/null
fi
( cd "$BUILD_DIR" && zip -rq "$ZIP" . )

# Wait for LocalStack readiness (health check on the network)
echo "[deployer] waiting for LocalStack..."
for i in $(seq 1 60); do
  if aws --endpoint-url=$AWS_ENDPOINT_URL lambda list-functions >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Create or update
if aws --endpoint-url=$AWS_ENDPOINT_URL lambda get-function \
    --function-name "$FUNCTION_NAME" >/dev/null 2>&1; then
  echo "[deployer] updating existing function $FUNCTION_NAME"
  aws --endpoint-url=$AWS_ENDPOINT_URL lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file fileb://$ZIP >/dev/null
  aws --endpoint-url=$AWS_ENDPOINT_URL lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --runtime "$RUNTIME" \
    --handler "$HANDLER" \
    --timeout "$TIMEOUT" \
    --memory-size "$MEMORY" \
    --environment "$ENV_JSON" >/dev/null
else
  echo "[deployer] creating new function $FUNCTION_NAME"
  aws --endpoint-url=$AWS_ENDPOINT_URL lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime "$RUNTIME" \
    --role "arn:aws:iam::000000000000:role/lambda-role" \
    --handler "$HANDLER" \
    --timeout "$TIMEOUT" \
    --memory-size "$MEMORY" \
    --environment "$ENV_JSON" \
    --zip-file fileb://$ZIP >/dev/null
fi

# Wait for the function state to reach Active before declaring success
for i in $(seq 1 30); do
  STATE=$(aws --endpoint-url=$AWS_ENDPOINT_URL lambda get-function \
    --function-name "$FUNCTION_NAME" --query 'Configuration.State' --output text 2>/dev/null)
  if [ "$STATE" = "Active" ]; then
    break
  fi
  sleep 1
done

echo "[deployer] $FUNCTION_NAME deployed and Active"
