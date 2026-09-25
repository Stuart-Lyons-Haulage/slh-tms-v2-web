#!/usr/bin/env bash
set -euo pipefail

WEB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PARENT="$(dirname "$WEB_ROOT")"
API_ROOT="$PARENT/API"
[[ -d "$API_ROOT" ]] || API_ROOT="$PARENT/slh-tms-v2-api"
ENV_FILE="$WEB_ROOT/.env.standalone"
COMPOSE_FILE="$WEB_ROOT/deploy/standalone/docker-compose.yml"

command -v git >/dev/null || { echo "git is required on the SLH server."; exit 1; }
command -v docker >/dev/null || { echo "docker is required on the SLH server."; exit 1; }
command -v curl >/dev/null || { echo "curl is required on the SLH server."; exit 1; }
[[ -d "$API_ROOT" ]] || { echo "Expected sibling API repository at $API_ROOT"; exit 1; }

env_value() { awk -F= -v key="$1" '$1==key {sub(/^[^=]*=/,""); print; exit}' "$ENV_FILE"; }

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$WEB_ROOT/.env.standalone.example" "$ENV_FILE"
  echo "Created $ENV_FILE. Populate the runtime values, then run this script again."
  exit 2
fi

for name in SQL_SA_PASSWORD ENTRA_TENANT_ID ENTRA_WEB_CLIENT_ID ENTRA_API_AUDIENCE ENTRA_API_SCOPE; do
  value="$(env_value "$name")"
  [[ -n "$value" && "$value" != CHANGE_ME* ]] || { echo "$name must be populated in .env.standalone before V2 can start." >&2; exit 2; }
done

profiles="$(env_value COMPOSE_PROFILES)"
if [[ ",$profiles," == *",remote,"* ]]; then
  [[ -n "$(env_value CLOUDFLARE_TUNNEL_TOKEN)" ]] || { echo "Remote profile requires CLOUDFLARE_TUNNEL_TOKEN." >&2; exit 2; }
  [[ -n "$(env_value TMS_PUBLIC_URL)" ]] || { echo "Remote profile requires TMS_PUBLIC_URL." >&2; exit 2; }
fi

for repo in "$WEB_ROOT" "$API_ROOT"; do
  if [[ -n "$(git -C "$repo" status --porcelain --untracked-files=no)" ]]; then
    echo "Refusing automatic update because tracked local changes exist in $repo." >&2
    echo "Commit, stash or discard those changes before updating the live TMS." >&2
    exit 3
  fi
done

WEB_BEFORE="$(git -C "$WEB_ROOT" rev-parse --short HEAD)"
API_BEFORE="$(git -C "$API_ROOT" rev-parse --short HEAD)"

echo "Updating canonical V2 repositories from main..."
git -C "$WEB_ROOT" fetch origin main
git -C "$WEB_ROOT" checkout main
git -C "$WEB_ROOT" pull --ff-only origin main
git -C "$API_ROOT" fetch origin main
git -C "$API_ROOT" checkout main
git -C "$API_ROOT" pull --ff-only origin main

WEB_AFTER="$(git -C "$WEB_ROOT" rev-parse --short HEAD)"
API_AFTER="$(git -C "$API_ROOT" rev-parse --short HEAD)"

echo "Web: $WEB_BEFORE -> $WEB_AFTER"
echo "API: $API_BEFORE -> $API_AFTER"

mkdir -p "$WEB_ROOT/backup" "$WEB_ROOT/archive"
echo "Validating Docker Compose configuration..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >/dev/null

echo "Building and starting SLH TMS V2..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build

PORT="$(env_value TMS_HTTP_PORT)"
PORT="${PORT:-8080}"
HEALTH="http://127.0.0.1:$PORT/tms-api/api/v1/health"

echo "Waiting for API health..."
ready=false
for _ in $(seq 1 30); do
  if curl -fsS "$HEALTH" | grep -q '"status":"healthy"'; then
    ready=true
    break
  fi
  sleep 2
done

if [[ "$ready" != "true" ]]; then
  echo
  echo "Update completed but the API did not become healthy." >&2
  echo "Web version: $WEB_AFTER" >&2
  echo "API version: $API_AFTER" >&2
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs api --tail=120 || true
  exit 1
fi

echo
echo "SLH TMS V2 is healthy."
echo "Web version: $WEB_AFTER"
echo "API version: $API_AFTER"
echo "Local portal: http://127.0.0.1:$PORT"
PUBLIC_URL="$(env_value TMS_PUBLIC_URL)"
[[ -z "$PUBLIC_URL" ]] || echo "Remote portal: $PUBLIC_URL"
echo "Authentication: Microsoft Entra"
echo "API health: $HEALTH"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
