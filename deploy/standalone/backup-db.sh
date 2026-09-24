#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-.env.standalone}"
COMPOSE_FILE="deploy/standalone/docker-compose.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Environment file not found: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${SQL_SA_PASSWORD:?SQL_SA_PASSWORD is required}"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
filename="SLH_TMS_V2-${stamp}.bak"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T sql   /opt/mssql-tools18/bin/sqlcmd   -S localhost -U sa -P "$SQL_SA_PASSWORD" -C -b   -Q "BACKUP DATABASE [SLH_TMS_V2] TO DISK = N'/var/opt/mssql/backup/$filename' WITH COPY_ONLY, CHECKSUM, INIT; RESTORE VERIFYONLY FROM DISK = N'/var/opt/mssql/backup/$filename' WITH CHECKSUM;"

echo "Verified SQL backup created: $filename"
