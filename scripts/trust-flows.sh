#!/usr/bin/env bash
# M8 trust & safety end to end (task.md § 12 M8). See trust-flows.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/trust-flows.mjs "$@"
