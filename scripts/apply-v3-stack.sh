#!/usr/bin/env bash
set -euo pipefail

python scripts/apply-confirmed-balance-v1.py
python scripts/apply-g15-g01-v5.py
python scripts/apply-g01-g15-v6.py
python scripts/apply-balance-v7.py
python scripts/apply-ideas-batch1.py
python scripts/apply-ideas-batch2.py
python scripts/apply-ideas-batch3.py
python scripts/apply-ideas-batch4.py
python scripts/apply-ideas-batch5.py
python scripts/apply-ideas-batch6.py
python scripts/apply-ideas-batch7.py
python scripts/apply-ideas-batch8.py
python scripts/apply-ideas-batch8-fix.py
python scripts/apply-ideas-batch9.py
python scripts/apply-ideas-batch10.py
python scripts/apply-ideas-batch11.py
python scripts/apply-augment-rough-balance-v1.py
python scripts/apply-augment-rough-balance-v2.py
python scripts/run-balance-rework-v3.py
python scripts/apply-balance-rework-v3-plague-duration.py
python scripts/apply-balance-rework-v3-stall-fix.py
python scripts/apply-stall-fixes-v4.py
python scripts/apply-stall-fixes-v5.py
python scripts/apply-stall-fixes-v6.py
python scripts/apply-stall-fixes-v7.py
