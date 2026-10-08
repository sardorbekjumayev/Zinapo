#!/usr/bin/env bash
# Prints the sign-in code for a phone number without a Telegram bot.
#
#   1. open http://localhost:3000, type the number, press "Kodni yuborish"
#   2. ./scripts/dev-code.sh +998901234567
#   3. type the printed code on the site
#
# Development only — the endpoint it calls does not exist in production.
set -euo pipefail

PHONE="${1:-}"
BASE="${BASE_URL:-http://localhost:3000}"

if [ -z "$PHONE" ]; then
  echo "usage: $0 <phone>        e.g. $0 +998901234567" >&2
  exit 1
fi

RESPONSE=$(curl -s -w '\n%{http_code}' -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"firstName\":\"Sardorbek\"}" \
  "$BASE/api/dev/telegram/share-contact")

BODY=$(printf '%s' "$RESPONSE" | sed '$d')
STATUS=$(printf '%s' "$RESPONSE" | tail -n1)

if [ "$STATUS" != "201" ] && [ "$STATUS" != "200" ]; then
  echo "Xato (HTTP $STATUS): $BODY" >&2
  echo >&2
  echo "Saytda avval raqamni kiritib, \"Kodni yuborish\" tugmasini bosing." >&2
  exit 1
fi

printf '%s' "$BODY" | python3 -c '
import sys, json, re
replies = json.load(sys.stdin)["replies"]
text = " ".join(r["text"] for r in replies)
for r in replies:
    print("  bot:", r["text"].replace("\n", " "))
m = re.search(r"\*(\d{5})\*", text)
if m:
    print()
    print("  KOD:", m.group(1))
'
