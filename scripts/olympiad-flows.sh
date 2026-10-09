#!/usr/bin/env bash
# M7 olympiad end to end (task.md § 12 M7). See olympiad-flows.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/olympiad-flows.mjs "$@"
