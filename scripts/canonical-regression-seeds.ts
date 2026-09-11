import assert from "node:assert/strict";
import { getBalanceRuleset } from "@/lib/simulation/rulesets";
import { simulateGame } from "@/lib/simulation/game";

type NaturalCase = {
  source: string;
  seed: string;
  playerCount: 2 | 3 | 4;
  label: string;
  requireCompleted?: boolean;
};

type ForcedCase = {
  source: string;
  seed: string;
  playerCount: 2 | 3 | 4;
  augmentId: string;
  acquisitionIndex: number;
  label: string;
};

const naturalCases: NaturalCase[] = [
  { source: "v4", seed: "823002", playerCount: 2, label: "A16 boundary" },
  { source: "v4", seed: "801756", playerCount: 2, label: "A16 outer fallback" },
  { source: "v4", seed: "900238", playerCount: 3, label: "A16 stacked outer fallback" },
  { source: "v4", seed: "800912", playerCount: 2, label: "G01/P11 conflict" },

  { source: "v5-v8", seed: "1301484", playerCount: 2, label: "A10 terminal 1", requireCompleted: true },
  { source: "v5-v8", seed: "1301794", playerCount: 2, label: "A10 terminal 2", requireCompleted: true },
  { source: "v5-v8", seed: "1400473", playerCount: 3, label: "P14+A13 wormhole lap", requireCompleted: true },
  { source: "v5-v8", seed: "1402130", playerCount: 3, label: "A10 selection invalidated", requireCompleted: true },
  { source: "v5-v8", seed: "1500013", playerCount: 4, label: "P14+A08 upheaval lap", requireCompleted: true },
  { source: "v5-v8", seed: "1500032", playerCount: 4, label: "A15 only piece locked", requireCompleted: true },
  { source: "v5-v8", seed: "1500206", playerCount: 4, label: "A16 center shortened route", requireCompleted: true },
  { source: "v5-v8", seed: "1500642", playerCount: 4, label: "A10 terminal 4P", requireCompleted: true },
  { source: "v5-v8", seed: "1501086", playerCount: 4, label: "A10 invalidated 1", requireCompleted: true },
  { source: "v5-v8", seed: "1501172", playerCount: 4, label: "P14+A13 wormhole lap 4P", requireCompleted: true },
  { source: "v5-v8", seed: "1501188", playerCount: 4, label: "A10 invalidated 2", requireCompleted: true },
  { source: "v5-v8", seed: "1501304", playerCount: 4, label: "A10 invalidated 3", requireCompleted: true },
  { source: "v5-v8", seed: "1501995", playerCount: 4, label: "A13+G13 backdo", requireCompleted: true },

  { source: "v10", seed: "917675", playerCount: 3, label: "90K regression 1" },
  { source: "v10", seed: "922077", playerCount: 3, label: "90K regression 2" },
  { source: "v10", seed: "1012369", playerCount: 4, label: "90K regression 3" },
  { source: "v10", seed: "1026546", playerCount: 4, label: "90K regression 4" },
];

const forcedCases: ForcedCase[] = [
  { source: "v11", augmentId: "P14", seed: "6226875", playerCount: 2, acquisitionIndex: 1, label: "P14 setup transfer 1" },
  { source: "v11", augmentId: "P14", seed: "6227070", playerCount: 2, acquisitionIndex: 1, label: "P14 setup transfer 2" },
  { source: "v11", augmentId: "P14", seed: "6326327", playerCount: 3, acquisitionIndex: 1, label: "P14 setup transfer 3" },
  { source: "v11", augmentId: "P14", seed: "6326906", playerCount: 3, acquisitionIndex: 1, label: "P14 setup transfer 4" },
  { source: "v11", augmentId: "A16", seed: "6384749", playerCount: 2, acquisitionIndex: 1, label: "A16/P02 interaction" },
  { source: "post-v11 residual", augmentId: "P14", seed: "6326572", playerCount: 3, acquisitionIndex: 1, label: "A10+P02 no-legal-move" },
  { source: "post-v11 residual", augmentId: "P16", seed: "6871323", playerCount: 4, acquisitionIndex: 1, label: "A10+P02 no-legal-move 4P" },
  { source: "ownership invariant", augmentId: "P14", seed: "6226270", playerCount: 2, acquisitionIndex: 1, label: "A10 return-to-original-owner metadata" },
  { source: "ownership invariant", augmentId: "P14", seed: "6226189", playerCount: 2, acquisitionIndex: 1, label: "A10 transferred group-root reparent" },
];

const ruleset = getBalanceRuleset("two-aug-start-r4-special-slots-v2");
const rows: Array<Record<string, unknown>> = [];

for (const item of naturalCases) {
  const result = simulateGame({
    seed: item.seed,
    ruleset,
    playerCount: item.playerCount,
    maxActions: 20_000,
    maxRounds: 30,
  });
  const acceptable = item.requireCompleted
    ? result.status === "COMPLETED"
    : result.status === "COMPLETED" || result.status === "DRAW";
  rows.push({ ...item, status: result.status, round: result.round, error: result.error ?? null });
  assert.ok(acceptable, `${item.source} ${item.label} seed ${item.seed}: ${result.status} ${result.error ?? ""}`);
}

for (const item of forcedCases) {
  const result = simulateGame({
    seed: item.seed,
    ruleset,
    playerCount: item.playerCount,
    maxActions: 20_000,
    maxRounds: 30,
    forcedAugmentId: item.augmentId,
    forcedAcquisitionIndex: item.acquisitionIndex,
  });
  const numericSeed = Number(item.seed);
  const forcedSeat = numericSeed % item.playerCount + 1;
  const forcedUserId = `sim-p${forcedSeat}`;
  const acquired = result.acquisitions.some((entry) => (
    entry.userId === forcedUserId
    && entry.augmentId === item.augmentId
    && entry.acquisitionIndex === item.acquisitionIndex
  ));
  rows.push({ ...item, forcedSeat, status: result.status, round: result.round, error: result.error ?? null });
  assert.ok(acquired, `${item.source} ${item.label} seed ${item.seed}: forced acquisition missing`);
  assert.equal(result.status, "COMPLETED", `${item.source} ${item.label} seed ${item.seed}: ${result.status} ${result.error ?? ""}`);
}

console.log(`# Canonical historical stall regressions (${rows.length})`);
console.log("| Source | Seed | Players | Case | Status | Round |");
console.log("|---|---:|---:|---|---|---:|");
for (const row of rows) {
  console.log(`| ${row.source} | ${row.seed} | ${row.playerCount} | ${row.label} | ${row.status} | ${row.round} |`);
}
console.log(`canonical regression seeds PASS: ${rows.length}/${rows.length}`);
