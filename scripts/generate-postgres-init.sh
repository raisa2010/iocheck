#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="${ROOT_DIR}/api/postgres/init.sql.template"
OUTPUT="${ROOT_DIR}/api/postgres/init.sql"

if [[ ! -f "$TEMPLATE" ]]; then
  echo "Template not found: $TEMPLATE" >&2
  exit 1
fi

POSTGRES_DB="${POSTGRES_DB:?POSTGRES_DB is required}"
POSTGRES_USER="${POSTGRES_USER:?POSTGRES_USER is required}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"

escape_sql() {
  printf '%s' "$1" | sed "s/'/''/g"
}

DB="$(escape_sql "$POSTGRES_DB")"
USER="$(escape_sql "$POSTGRES_USER")"
PASS="$(escape_sql "$POSTGRES_PASSWORD")"

sed \
  -e "s/__POSTGRES_DB__/${DB}/g" \
  -e "s/__POSTGRES_USER__/${USER}/g" \
  -e "s/__POSTGRES_PASSWORD__/${PASS}/g" \
  "$TEMPLATE" > "$OUTPUT"

echo "Generated ${OUTPUT}"
