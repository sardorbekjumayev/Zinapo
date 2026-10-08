#!/usr/bin/env bash
# Checks the dashboard router and the workspace shells (task.md § 2.2, § 7).
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/routing.mjs "$@"
