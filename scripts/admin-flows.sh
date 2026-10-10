#!/usr/bin/env bash
# M9 measurement v1, outcomes, admin end to end (task.md § 12 M9). See admin-flows.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/admin-flows.mjs "$@"
