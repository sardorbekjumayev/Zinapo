#!/usr/bin/env bash
# Loads the M1 development fixture (task.md § 12) and prints the sign-in
# numbers, so you can try each role without hunting through the database.
#
# It drives POST /api/dev/seed, which runs the real services — so seeded
# children have real PINFL hashes and the invariants apply to them. Idempotent.
set -euo pipefail

cd "$(dirname "$0")/.."

API=${API_URL:-http://localhost:4000}

if ! curl -sf "$API/api/health" >/dev/null; then
  echo "error: the API is not answering on $API — 'docker compose up -d'" >&2
  exit 1
fi

body=$(curl -sS -X POST "$API/api/dev/seed" -H 'Content-Type: application/json')

if ! printf '%s' "$body" | grep -q '"people"'; then
  echo "seed failed:" >&2
  printf '%s\n' "$body" >&2
  exit 1
fi

python3 - "$body" <<'PY'
import json, sys
d = json.loads(sys.argv[1])

print("\nPeople — sign in with any of these numbers:\n")
w = max(len(k) for k in d["people"])
for key, p in d["people"].items():
    print(f"  {key:<{w}}  {p['phone']}   {p['note']}")

print("\nChildren:\n")
for c in d["children"]:
    print(f"  grade {c['grade']}  {c['name']}")

print("\nGroups:\n")
for g in d["groups"]:
    print(f"  {g['name']}")

print(f"\nSeason: {d['season']['code']}\n")
print("Without a bot token, get a sign-in code with:")
print("  ./scripts/dev-code.sh +998901110001\n")
PY
