#!/usr/bin/env bash
# Applies the SQL files in load order, once each, tracked in `schema_migration`.
#
# The Postgres entrypoint only runs db/init on an EMPTY data directory, so a
# database created before a migration was written never sees it. This script is
# the path for an existing volume; a fresh `docker compose up` still gets the
# same files from the entrypoint, and the baseline below keeps the two in sync.
#
#   ./scripts/migrate.sh            apply what is missing
#   ./scripts/migrate.sh --status   list applied / pending and exit
set -euo pipefail

cd "$(dirname "$0")/.."

SERVICE=${DB_SERVICE:-db}
PSQL=(docker compose exec -T "$SERVICE" psql -v ON_ERROR_STOP=1 -q
      -U "${POSTGRES_USER:-zinapo}" -d "${POSTGRES_DB:-zinapo}")

# Load order. 003 is the core model; docs/schema.sql is a symlink to it.
FILES=(
  "db/init/001_base_schema.sql"
  "db/init/002_auth.sql"
  "db/init/003_core_schema.sql"
  "db/init/004_roles_and_ops.sql"
  "db/init/005_reference_data.sql"
  "db/init/006_family_identity.sql"
  "db/init/007_item_bank.sql"
  "db/init/008_sessions.sql"
  "db/init/009_measurement.sql"
  "db/init/010_educator.sql"
)
# The name recorded in schema_migration — must match what a fresh volume would
# have been given by the entrypoint.
name_of() { basename "$1"; }

if ! docker compose ps --status running --services 2>/dev/null | grep -qx "$SERVICE"; then
  echo "error: the '$SERVICE' service is not running — start it with 'docker compose up -d $SERVICE'" >&2
  exit 1
fi

"${PSQL[@]}" <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migration (
  name       text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

# Baseline: a database that already has `person` was built by the entrypoint
# from 001/002, so record those as applied rather than replaying them.
"${PSQL[@]}" <<'SQL'
INSERT INTO schema_migration (name)
SELECT unnest(ARRAY['001_base_schema.sql','002_auth.sql'])
 WHERE to_regclass('public.person') IS NOT NULL
ON CONFLICT (name) DO NOTHING;
SQL

applied() {
  local out
  out=$("${PSQL[@]}" -At -c "SELECT 1 FROM schema_migration WHERE name = '$1'")
  [[ -n "$out" ]]
}

if [[ "${1:-}" == "--status" ]]; then
  for f in "${FILES[@]}"; do
    n=$(name_of "$f")
    if applied "$n"; then printf '  applied  %s\n' "$n"; else printf '  PENDING  %-24s (%s)\n' "$n" "$f"; fi
  done
  exit 0
fi

for f in "${FILES[@]}"; do
  n=$(name_of "$f")
  if applied "$n"; then
    echo "  skip     $n"
    continue
  fi
  echo "  apply    $n"
  # One transaction per file: a failure leaves nothing half-applied.
  { echo 'BEGIN;'; cat "$f"; printf "INSERT INTO schema_migration (name) VALUES ('%s');\n" "$n"; echo 'COMMIT;'; } \
    | "${PSQL[@]}"
done

echo "migrations up to date"
