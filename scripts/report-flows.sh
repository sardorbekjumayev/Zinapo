#!/usr/bin/env bash
# M5 measurement & reports end to end (task.md § 12 M5). See report-flows.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/report-flows.mjs "$@"
