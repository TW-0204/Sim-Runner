#!/usr/bin/env bash
set -euo pipefail

AUGMENT_016_SMOKE_GAMES="${AUGMENT_016_SMOKE_GAMES:-20}"
OUTPUT_DIR="${TMPDIR:-/tmp}/augment-yut-augment-016-037-smoke"

node --import ./scripts/register-ts-hooks.mjs scripts/balance-rework-v3-probe.ts
node --import ./scripts/register-ts-hooks.mjs scripts/augment-037-overpass-probe.ts
node --import ./scripts/register-ts-hooks.mjs scripts/stall-fixes-v9-probe.ts
node --import ./scripts/register-ts-hooks.mjs scripts/stall-fixes-v10-probe.ts
node --import ./scripts/register-ts-hooks.mjs scripts/stall-fixes-v11-probe.ts

if grep -q '친구와 함께' src/lib/game/engine.ts; then
  echo "AUG-015 naming cleanup failed: old runtime log label remains in engine.ts" >&2
  exit 1
fi

rm -rf "$OUTPUT_DIR"
node --import ./scripts/register-ts-hooks.mjs scripts/augment-016-precision-run.ts \
  --games "$AUGMENT_016_SMOKE_GAMES" \
  --output-dir "$OUTPUT_DIR"

echo "Canonical v11 AUG-016 + AUG-037 smoke PASS"
