#!/usr/bin/env bash
# Deploy the backend: build the image, push it to ECR, restart it on the server.
#
#   ./deploy/deploy.sh             build from backend/ and deploy
#   ./deploy/deploy.sh --restart   no build: restart with the current image and fresh settings
#
# Needs: Docker running, and the AWS CLI logged in. Run aws-setup.sh and push-env.sh first.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source ./config.sh

INSTANCE_ID="$(instance_id)"
[ -n "$INSTANCE_ID" ] || { echo "No server found. Run ./deploy/aws-setup.sh first." >&2; exit 1; }
HOST="$(backend_host)"
REGISTRY="$(ecr_registry)"
TAG="$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"

if [ "${1:-}" != "--restart" ]; then
  if [ -n "$(git status --porcelain ../backend 2>/dev/null)" ]; then
    echo "Note: backend/ has uncommitted changes; they are included in this image."
  fi
  echo "==> Building ${APP_NAME}:${TAG} for ARM and pushing to ECR"
  aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
  docker buildx build --platform linux/arm64 \
    -t "${REGISTRY}/${APP_NAME}:${TAG}" -t "${REGISTRY}/${APP_NAME}:latest" \
    --push ../backend
else
  TAG=latest
fi

echo "==> Restarting the backend on ${INSTANCE_ID}"
COMMAND_ID="$(aws ssm send-command --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript --comment "deploy ${APP_NAME}:${TAG}" \
  --parameters "commands=[\"/opt/pixeltrip/update.sh ${TAG}\"]" \
  --query Command.CommandId --output text)"
STATUS=Pending
for _ in $(seq 1 90); do   # up to 6 minutes: the first pull is the slow one
  sleep 4
  STATUS="$(aws ssm get-command-invocation --command-id "$COMMAND_ID" \
    --instance-id "$INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)"
  case "$STATUS" in Pending|InProgress|Delayed) ;; *) break ;; esac
done
aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
  --query '[StandardOutputContent, StandardErrorContent]' --output text | tail -n 25
[ "$STATUS" = "Success" ] || { echo "Deploy failed (${STATUS})." >&2; exit 1; }

echo "==> Checking https://${HOST}/health"
for _ in $(seq 1 20); do
  if curl -fsS --max-time 5 "https://${HOST}/health" >/dev/null 2>&1; then
    echo "Live: https://${HOST}"
    exit 0
  fi
  sleep 3   # the first deploy waits for Caddy to get its certificate
done
echo "The container is running but https://${HOST}/health did not answer yet." >&2
echo "On a first deploy the certificate can take a minute; try the URL again shortly." >&2
exit 1
