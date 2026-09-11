import assert from "node:assert/strict";
import { AUGMENT_BY_ID } from "@/lib/augments/catalog";
import {
  armA04OnAcquisition,
  movementBonusForGroup,
  queueA04BonusForNextBasic,
  transformRollFace,
} from "@/lib/augments/effects";
import { createInitialEngine } from "@/lib/game/engine";
import type { RollToken } from "@/lib/game/types";
import { runSimulationBatch } from "@/lib/simulation/batch";
import { pickTierSequence } from "@/lib/augments/server";

const seeds = [
  { userId: "p1", displayName: "P1", seat: 1 },
  { userId: "p2", displayName: "P2", seat: 2 },
];

// AUG-054: DO is redistributed, BACKDO remains untouched.
for (const value of [0, 0.2, 0.5, 0.8, 0.99]) {
  const engine = createInitialEngine(seeds);
  const face = transformRollFace(engine, "p1", "DO", "BASIC", ["AUG-054"], () => value);
  assert.notEqual(face, "DO", `AUG-054 leaked DO at random=${value}`);
}
{
  const engine = createInitialEngine(seeds);
  assert.equal(transformRollFace(engine, "p1", "BACKDO", "BASIC", ["AUG-054"], () => 0.5), "BACKDO");
}
{
  const engine = createInitialEngine(seeds);
  const face = transformRollFace(engine, "p1", "DO", "BASIC", ["AUG-054", "AUG-020"], () => 0.9);
  assert.notEqual(face, "DO", "AUG-054 must also suppress DO created by another roll transform");
}

// AUG-055: segment 0 covers the first outer side; starting there gives +1, elsewhere and BACKDO do not.
{
  const engine = createInitialEngine(seeds);
  const piece = engine.players[0].pieces[0];
  piece.status = "ON_BOARD";
  piece.node = 2;
  piece.hasEntered = true;
  engine.augmentRuntime ??= {};
  engine.augmentRuntime.p1 = { walkingTrailSegment: 0 };
  const forward: RollToken = { id: "probe", face: "GAE", baseSteps: 2, finalSteps: 2, source: "BASIC" };
  assert.equal(movementBonusForGroup(engine, "p1", piece.groupId, forward, ["AUG-055"]), 1);
  piece.node = 7;
  assert.equal(movementBonusForGroup(engine, "p1", piece.groupId, forward, ["AUG-055"]), 0);
  piece.node = 2;
  const backdo: RollToken = { id: "probe-back", face: "BACKDO", baseSteps: -1, finalSteps: -1, source: "BASIC" };
  assert.equal(movementBonusForGroup(engine, "p1", piece.groupId, backdo, ["AUG-055"]), 0);
}

// AUG-047: acquisition arms exactly one extra AUGMENT roll behind the next BASIC roll.
{
  const engine = createInitialEngine(seeds);
  armA04OnAcquisition(engine, "p1");
  assert.equal(engine.augmentRuntime?.p1?.a04NextBasicBonusPending, true);
  assert.equal(engine.augmentRuntime?.p1?.a04UpgradeNextAugment, true);
  assert.equal(queueA04BonusForNextBasic(engine, "p1", ["AUG-047"]), true);
  assert.deepEqual(engine.pendingRolls, ["BASIC", "AUGMENT"]);
  assert.equal(queueA04BonusForNextBasic(engine, "p1", ["AUG-047"]), false);
  assert.deepEqual(engine.pendingRolls, ["BASIC", "AUGMENT"]);
}

// AUG-047 offer rule and next-tier upgrade: natural simulations may acquire AUG-047 directly or through AUG-048.
// Whenever the next ordinary (non-Special) augment is reached, its tier must be one step above the seed plan.
{
  const result = runSimulationBatch({
    rulesetId: "two-aug-start-r4-special-slots-v2",
    playerCount: 2,
    games: 400,
    seedStart: 50_000,
    maxActions: 20_000,
  });
  let a04Owners = 0;
  let checkedUpgrades = 0;
  for (const game of result.games) {
    const plannedNext = pickTierSequence(game.seed)[2];
    const owners = new Set(game.acquisitions.filter((item) => item.augmentId === "AUG-047" && item.acquisitionIndex === 1).map((item) => item.userId));
    for (const userId of owners) {
      a04Owners += 1;
      assert.notEqual(plannedNext, "prism", `AUG-047 appeared with Prism already planned for seed ${game.seed}`);
      const next = game.acquisitions.find((item) => item.userId === userId && item.acquisitionIndex === 2);
      if (!next || AUGMENT_BY_ID.get(next.augmentId)?.special) continue;
      const expected = plannedNext === "silver" ? "gold" : "prism";
      assert.equal(next.tier, expected, `AUG-047 tier upgrade mismatch for seed ${game.seed}`);
      checkedUpgrades += 1;
    }
  }
  assert.ok(a04Owners > 0, "AUG-047 was never acquired in the probe batch");
  assert.ok(checkedUpgrades > 0, "No AUG-047 next-tier upgrade could be checked");
  console.log(`[batch2-probe] AUG-047 owners=${a04Owners}, checked ordinary upgrades=${checkedUpgrades}`);
}

console.log("[batch2-probe] PASS: AUG-047/AUG-054/AUG-055 mechanics validated.");
