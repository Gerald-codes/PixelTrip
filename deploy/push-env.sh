#!/usr/bin/env bash
# Upload the backend's settings from backend/.env to AWS Parameter Store, encrypted.
# The server reads them on every deploy. Values are never printed.
#
# Run again whenever a key changes, then ./deploy/deploy.sh --restart to apply it.
#
# Local-only settings are replaced with production ones:
#   FRONTEND_URL          -> $FRONTEND_ORIGIN (the deployed frontend)
#   ENVIRONMENT           -> production
#   ENABLE_DEV_ENDPOINTS  -> false (the /dev test routes stay off)

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source ./config.sh

ENV_FILE="${1:-../backend/.env}"
[ -f "$ENV_FILE" ] || { echo "No $ENV_FILE to read." >&2; exit 1; }

put() {  # name value
  aws ssm put-parameter --name "${PARAM_PATH}/$1" --value "$2" \
    --type SecureString --overwrite >/dev/null
  echo "  set $1"
}

echo "==> Uploading settings to ${PARAM_PATH} in ${AWS_REGION}"
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|\#*) continue ;; esac
  key="${line%%=*}"
  value="${line#*=}"
  key="$(echo "$key" | tr -d '[:space:]')"
  # Drop surrounding quotes, as dotenv does.
  value="${value%\"}"; value="${value#\"}"; value="${value%\'}"; value="${value#\'}"
  case "$key" in
    HOST|PORT|APP_ENV|ENVIRONMENT|FRONTEND_URL|ENABLE_DEV_ENDPOINTS) continue ;;
  esac
  [ -n "$value" ] || continue   # Parameter Store refuses empty values; unset means default
  put "$key" "$value"
done < "$ENV_FILE"

put FRONTEND_URL "$FRONTEND_ORIGIN"
put ENVIRONMENT production
put ENABLE_DEV_ENDPOINTS false

echo "Done. Apply with: ./deploy/deploy.sh --restart"
