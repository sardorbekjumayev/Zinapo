#!/usr/bin/env bash
# M2 family & identity flows end to end (task.md § 12 M2). See family-flows.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/family-flows.mjs "$@"
