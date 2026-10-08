#!/usr/bin/env bash
# Runs db/test/invariants.sql — one check per invariant in docs/schema.sql.
# Everything happens inside a transaction that is rolled back, so this is safe
# against a development database. Exits non-zero if any check failed.
set -euo pipefail

cd "$(dirname "$0")/.."

SERVICE=${DB_SERVICE:-db}

if ! docker compose ps --status running --services 2>/dev/null | grep -qx "$SERVICE"; then
  echo "error: the '$SERVICE' service is not running — 'docker compose up -d $SERVICE'" >&2
  exit 1
fi

docker compose exec -T "$SERVICE" psql -v ON_ERROR_STOP=1 -q \
  -U "${POSTGRES_USER:-zinapo}" -d "${POSTGRES_DB:-zinapo}" \
  < db/test/invariants.sql
