#!/usr/bin/env bash
set -euo pipefail

WEB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$WEB_ROOT/.env.standalone"
EXAMPLE="$WEB_ROOT/.env.standalone.example"

if [[ -f "$ENV_FILE" ]]; then
  echo "$ENV_FILE already exists. No runtime values were changed."
  exit 0
fi

random_secret() {
  openssl rand -base64 "$1" | tr -d '/+='
}

SQL_PASSWORD="Slh!$(random_secret 24)"

sed -e "s|CHANGE_ME_STRONG_SQL_PASSWORD|$SQL_PASSWORD|" "$EXAMPLE" > "$ENV_FILE"
chmod 600 "$ENV_FILE"

echo
echo "Created $ENV_FILE with a generated SQL password."
echo "There is no separate TMS username/password to create."
echo "Populate the ENTRA_* values from the Lyons Microsoft Entra app registrations."
echo "For remote access, add the Cloudflare tunnel token and public URL only after the hostname exists."
echo "External provider credentials remain blank/disabled until configured directly on the server."
