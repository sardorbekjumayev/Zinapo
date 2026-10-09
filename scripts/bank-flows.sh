#!/usr/bin/env bash
# M3 item bank & forms flows end to end (task.md § 12 M3). See bank-flows.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/bank-flows.mjs "$@"
