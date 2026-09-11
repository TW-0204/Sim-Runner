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
  { source: "v4", seed: "823002", playerCount: 2, label: "AUG-059 boundary" },
  { source: "v4", seed: "801756", playerCount: 2, label: "AUG-059 outer fallback" },
  { source: "v4", seed: "900238", playerCount: 3, label: "AUG-059 stacked outer fallback" },
  { source: "v4", seed: "800912", playerCount: 2, label: "AUG-017/AUG-038 conflict" },

  { source: "v5-v8", seed: "1301484", playerCount: 2, label: "AUG-053 terminal 1", requireCompleted: true },
  { source: "v5-v8", seed: "1301794", playerCount: 2, label: "AUG-053 terminal 2", requireCompleted: true },
  { source: "v5-v8", seed: "1400473", playerCount: 3, label: "AUG-041+AUG-056 wormhole lap", requireCompleted: true },
  { source: "v5-v8", seed: "1402130", playerCount: 3, label: "AUG-053 selection invalidated", requireCompleted: true },
  { source: "v5-v8", seed: "1500013", playerCount: 4, label: "AUG-041+AUG-051 upheaval lap", requireCompleted: true },
  { source: "v5-v8", seed: "1500032", playerCount: 4, label: "AUG-058 only piece locked", requireCompleted: true },
  { source: "v5-v8", seed: "1500206", playerCount: 4, label: "AUG-059 center shortened route", requireCompleted: true },
  { source: "v5-v8", seed: "1500642", playerCount: 4, label: "AUG-053 terminal 4P", requireCompleted: true },
  { source: "v5-v8", seed: "1501086", playerCount: 4, label: "AUG-053 invalidated 1", requireCompleted: true },
  { source: "v5-v8", seed: "1501172", playerCount: 4, label: "AUG-041+AUG-056 wormhole lap 4P", requireCompleted: true },
  { source: "v5-v8", seed: "1501188", playerCount: 4, label: "AUG-053 invalidated 2", requireCompleted: true },
  { source: "v5-v8", seed: "1501304", playerCount: 4, label: "AUG-053 invalidated 3", requireCompleted: true },
  { source: "v5-v8", seed: "1501995", playerCount: 4, label: "AUG-056+AUG-028 backdo", requireCompleted: true },

  { source: "v10", seed: "917675", playerCount: 3, label: "90K regression 1" },
  { source: "v10", seed: "922077", playerCount: 3, label: "90K regression 2" },
  { source: "v10", seed: "1012369", playerCount: 4, label: "90K regression 3" },
  { source: "v10", seed: "1026546", playerCount: 4, label: "90K regression 4" },
];

const forcedCases: ForcedCase[] = [
  { source: "v11", augmentId: "AUG-041", seed: "6226875", playerCount: 2, acquisitionIndex: 1, label: "AUG-041 setup transfer 1" },
  { source: "v11", augmentId: "AUG-041", seed: "6227070", playerCount: 2, acquisitionIndex: 1, label: "AUG-041 setup transfer 2" },
  { source: "v11", augmentId: "AUG-041", seed: "6326327", playerCount: 3, acquisitionIndex: 1, label: "AUG-041 setup transfer 3" },
  { source: "v11", augmentId: "AUG-041", seed: "6326906", playerCount: 3, acquisitionIndex: 1, label: "AUG-041 setup transfer 4" },
  { source: "v11", augmentId: "AUG-059", seed: "6384749", playerCount: 2, acquisitionIndex: 1, label: "AUG-059/AUG-031 interaction" },
  { source: "post-v11 residual", augmentId: "AUG-041", seed: "6326572", playerCount: 3, acquisitionIndex: 1, label: "AUG-053+AUG-031 no-legal-move" },
  { source: "post-v11 residual", augmentId: "AUG-042", seed: "6871323", playerCount: 4, acquisitionIndex: 1, label: "AUG-053+AUG-031 no-legal-move 4P" },
  { source: "ownership invariant", augmentId: "AUG-041", seed: "6226270", playerCount: 2, acquisitionIndex: 1, label: "AUG-053 return-to-original-owner metadata" },
  { source: "ownership invariant", augmentId: "AUG-041", seed: "6226189", playerCount: 2, acquisitionIndex: 1, label: "AUG-053 transferred group-root reparent" },
  { source: "runtime reference", augmentId: "AUG-044", seed: "6872545", playerCount: 4, acquisitionIndex: 1, label: "AUG-030 reference repair after piece ownership change 1" },
  { source: "runtime reference", augmentId: "AUG-044", seed: "6872918", playerCount: 4, acquisitionIndex: 1, label: "AUG-030 reference repair after piece ownership change 2" },
  { source: "runtime reference", augmentId: "AUG-033", seed: "6518821", playerCount: 4, acquisitionIndex: 1, label: "AUG-030 reference repair under AUG-033 context" },
  { source: "runtime reference", augmentId: "AUG-037", seed: "6716316", playerCount: 3, acquisitionIndex: 1, label: "AUG-030 reference repair under AUG-037 3P context" },
  { source: "runtime reference", augmentId: "AUG-037", seed: "6815860", playerCount: 4, acquisitionIndex: 1, label: "AUG-030 reference repair under AUG-037 4P context" },
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
