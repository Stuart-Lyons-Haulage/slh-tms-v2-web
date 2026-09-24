#!/usr/bin/env bash
set -euo pipefail

WEB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PARENT="$(dirname "$WEB_ROOT")"
API_ROOT="$PARENT/API"
if [[ ! -d "$API_ROOT" ]]; then
  API_ROOT="$PARENT/slh-tms-v2-api"
fi
ENV_FILE="$WEB_ROOT/.env.standalone"
COMPOSE_FILE="$WEB_ROOT/deploy/standalone/docker-compose.yml"

command -v git >/dev/null || { echo "git is required on the SLH server."; exit 1; }
command -v docker >/dev/null || { echo "docker is required on the SLH server."; exit 1; }

[[ -d "$API_ROOT" ]] || { echo "Expected sibling API repository at $API_ROOT"; exit 1; }

echo "Updating canonical V2 repositories from main..."
git -C "$WEB_ROOT" fetch origin main
git -C "$WEB_ROOT" checkout main
git -C "$WEB_ROOT" pull --ff-only origin main

git -C "$API_ROOT" fetch origin main
git -C "$API_ROOT" checkout main
git -C "$API_ROOT" pull --ff-only origin main

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$WEB_ROOT/.env.standalone.example" "$ENV_FILE"
  echo
  echo "Created $ENV_FILE"
  echo "Populate the runtime secrets in that file, then run this script again."
  exit 2
fi

mkdir -p "$WEB_ROOT/backup" "$WEB_ROOT/archive"

echo "Validating Docker Compose configuration..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >/dev/null

echo "Building and starting SLH TMS V2..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build

PORT="$(awk -F= '/^TMS_HTTP_PORT=/{print $2; exit}' "$ENV_FILE")"
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
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
  echo
  echo "Recent API logs:"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs api --tail=120 || true
  echo
  echo "V2 containers started, but API health did not become ready at $HEALTH." >&2
  exit 1
fi

echo
echo "SLH TMS V2 is healthy."
echo "Portal: http://$(hostname):$PORT"
echo "API health: $HEALTH"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
