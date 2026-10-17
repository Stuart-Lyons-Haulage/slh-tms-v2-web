#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-.env.standalone}"
BACKUP_FILE="${2:-}"

if [[ -z "$BACKUP_FILE" ]]; then
  echo "Usage: $0 [.env.standalone] SLH_TMS_V2-YYYYMMDDTHHMMSSZ.bak" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
: "${SQL_SA_PASSWORD:?SQL_SA_PASSWORD is required}"

docker compose --env-file "$ENV_FILE" -f deploy/standalone/docker-compose.yml exec -T sql   /opt/mssql-tools18/bin/sqlcmd   -S localhost -U sa -P "$SQL_SA_PASSWORD" -C -b   -Q "RESTORE VERIFYONLY FROM DISK = N'/var/opt/mssql/backup/$BACKUP_FILE' WITH CHECKSUM;"
