#!/usr/bin/env bash
# M4 sessions & kid mode flows end to end (task.md § 12 M4). See session-flows.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/session-flows.mjs "$@"
