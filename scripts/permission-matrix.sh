#!/usr/bin/env bash
# One check per cell of the permission matrix in task.md § 3 — M1's DoD.
# Runs scripts/permission-matrix.mjs against the running stack.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/permission-matrix.mjs "$@"
