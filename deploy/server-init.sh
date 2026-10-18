#!/bin/bash
# Runs once, as root, when the server first boots (EC2 user data). aws-setup.sh fills
# in the __PLACEHOLDERS__. Installs Docker and writes /opt/pixeltrip/update.sh, which
# deploy.sh calls (through Systems Manager) to start or update the backend.
set -euxo pipefail

dnf install -y docker
systemctl enable --now docker

mkdir -p /opt/pixeltrip
chmod 700 /opt/pixeltrip

# Caddy terminates HTTPS (free certificate, renewed automatically) and forwards to the app.
cat > /opt/pixeltrip/Caddyfile <<'CADDY'
__HOST__ {
    encode gzip
    reverse_proxy backend:8000
}
CADDY

cat > /opt/pixeltrip/update.sh <<'UPDATE'
#!/bin/bash
# Start or update the backend: fresh settings, newest image, restart. Run as root.
set -euo pipefail

REGION="__REGION__"
REGISTRY="__REGISTRY__"
IMAGE="${REGISTRY}/__APP_NAME__:${1:-latest}"
ENV_FILE=/opt/pixeltrip/backend.env

# Settings come from Parameter Store on every deploy; the file is root-only.
umask 077
aws ssm get-parameters-by-path --region "$REGION" --path "__PARAM_PATH__" \
  --with-decryption --output json |
  python3 -c '
import json, sys
for p in json.load(sys.stdin)["Parameters"]:
    value = p["Value"].replace("\n", "")
    print(p["Name"].rsplit("/", 1)[-1] + "=" + value)
' > "${ENV_FILE}.new"
if [ ! -s "${ENV_FILE}.new" ]; then
  echo "No settings found under __PARAM_PATH__. Run deploy/push-env.sh first." >&2
  exit 1
fi
mv "${ENV_FILE}.new" "$ENV_FILE"

aws ecr get-login-password --region "$REGION" |
  docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
docker pull "$IMAGE"

docker network inspect pixeltrip >/dev/null 2>&1 || docker network create pixeltrip

docker rm -f backend >/dev/null 2>&1 || true
docker run -d --name backend --network pixeltrip --restart unless-stopped \
  --env-file "$ENV_FILE" \
  --log-opt max-size=10m --log-opt max-file=5 \
  "$IMAGE"

if ! docker ps --format '{{.Names}}' | grep -qx caddy; then
  docker rm -f caddy >/dev/null 2>&1 || true
  docker run -d --name caddy --network pixeltrip --restart unless-stopped \
    -p 80:80 -p 443:443 -p 443:443/udp \
    -v /opt/pixeltrip/Caddyfile:/etc/caddy/Caddyfile:ro \
    -v caddy_data:/data -v caddy_config:/config \
    --log-opt max-size=10m --log-opt max-file=3 \
    caddy:2
fi

# Wait for the app to answer before calling the deploy good.
for _ in $(seq 1 30); do
  if docker exec backend python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)" 2>/dev/null; then
    echo "Backend is up: $IMAGE"
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 2
done
echo "Backend did not become healthy. Last log lines:" >&2
docker logs --tail 40 backend >&2
exit 1
UPDATE
chmod 700 /opt/pixeltrip/update.sh
