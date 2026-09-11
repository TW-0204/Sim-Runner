#!/usr/bin/env bash
set -euo pipefail

S16_SMOKE_GAMES="${S16_SMOKE_GAMES:-20}"
OUTPUT_DIR="${TMPDIR:-/tmp}/augment-yut-s16-p10-smoke"

bash scripts/apply-v3-stack.sh

node --import ./scripts/register-ts-hooks.mjs scripts/balance-rework-v3-probe.ts
node --import ./scripts/register-ts-hooks.mjs scripts/p10-overpass-probe.ts
node --import ./scripts/register-ts-hooks.mjs scripts/stall-fixes-v9-probe.ts
node --import ./scripts/register-ts-hooks.mjs scripts/stall-fixes-v10-probe.ts

if grep -q '친구와 함께' src/lib/game/engine.ts; then
  echo "S15 naming cleanup failed: old runtime log label remains in engine.ts" >&2
  exit 1
fi

rm -rf "$OUTPUT_DIR"
node --import ./scripts/register-ts-hooks.mjs scripts/s16-precision-run.ts \
  --games "$S16_SMOKE_GAMES" \
  --output-dir "$OUTPUT_DIR"

echo "S16 + P10 + v10 smoke PASS"
