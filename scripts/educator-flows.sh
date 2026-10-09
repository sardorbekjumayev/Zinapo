#!/usr/bin/env bash
# M6 educator workspace end to end (task.md § 12 M6). See educator-flows.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/educator-flows.mjs "$@"
