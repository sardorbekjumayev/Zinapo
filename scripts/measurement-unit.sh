#!/usr/bin/env bash
# Unit tests for the raw_band_v0 arithmetic (task.md § 9, § 11). See measurement-unit.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node --test scripts/measurement-unit.mjs "$@"
