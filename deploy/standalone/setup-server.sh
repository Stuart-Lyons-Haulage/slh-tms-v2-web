#!/usr/bin/env bash
set -euo pipefail

WEB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$WEB_ROOT/.env.standalone"
EXAMPLE="$WEB_ROOT/.env.standalone.example"

if [[ -f "$ENV_FILE" ]]; then
  echo "$ENV_FILE already exists. No secrets were changed."
  exit 0
fi

random_secret() {
  openssl rand -base64 "$1" | tr -d '/+=' | tr '+' 'A' | tr '/' 'B'
}

SQL_PASSWORD="Slh!$(random_secret 24)"
JWT_KEY="$(random_secret 48)"
ADMIN_PASSWORD="Tms!$(random_secret 18)"

sed \
  -e "s|CHANGE_ME_STRONG_SQL_PASSWORD|$SQL_PASSWORD|" \
  -e "s|CHANGE_ME_RANDOM_MINIMUM_32_CHARACTERS|$JWT_KEY|" \
  -e "s|CHANGE_ME_STRONG_ADMIN_PASSWORD|$ADMIN_PASSWORD|" \
  -e "s|SQL_BACKUP_HOST_PATH=./backup|SQL_BACKUP_HOST_PATH=../../backup|" \
  -e "s|ARCHIVE_HOST_PATH=./archive|ARCHIVE_HOST_PATH=../../archive|" \
  "$EXAMPLE" > "$ENV_FILE"

chmod 600 "$ENV_FILE"

echo
echo "Created $ENV_FILE with generated local runtime secrets."
echo
echo "Initial TMS admin username: admin"
echo "Initial TMS admin password: $ADMIN_PASSWORD"
echo
echo "Record that password securely. Change it from the TMS Users screen after first sign-in."
echo "External provider credentials remain blank/disabled until configured directly on the server."
