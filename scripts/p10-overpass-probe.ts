import assert from "node:assert/strict";

import { AUGMENT_BY_ID } from "@/lib/augments/catalog";
import { adjustedResultForGroup } from "@/lib/augments/effects";
import { buildSpecialOfferCandidateIds } from "@/lib/augments/server";
import {
  applyGachaMachine,
  applyGravityExplosion,
  applyGreatUpheaval,
  armGachaMachineOnAcquisition,
  createInitialEngine,
  legalMoveTargetsWithAugments,
} from "@/lib/game/engine";
import type { RollToken } from "@/lib/game/types";

function engine2() {
  return createInitialEngine([
    { userId: "p1", displayName: "P1", seat: 1 },
    { userId: "p2", displayName: "P2", seat: 2 },
  ]);
}

// Catalog lock: renamed, first-only, and mutually incompatible with P02/P04.
{
  const p10 = AUGMENT_BY_ID.get("P10")!;
  const p02 = AUGMENT_BY_ID.get("P02")!;
  const p04 = AUGMENT_BY_ID.get("P04")!;
  assert.equal(p10.name, "고가도로");
  assert.equal(p10.timing, "first");
  assert.deepEqual(new Set(p10.conflicts ?? []), new Set(["P02", "P04"]));
  assert.ok(p02.conflicts?.includes("P10"));
  assert.ok(p04.conflicts?.includes("P10"));

  const lastSpecials = buildSpecialOfferCandidateIds({
    seed: "p10-conflict",
    phase: 3,
    userId: "p1",
    ownedIds: ["P10"],
  });
  assert.equal(lastSpecials.includes("P02"), false, "P02 must not be offerable after P10");
}

// P10 no longer grants +2, but still marks normal movement as shortcut-forbidden.
{
  const engine = engine2();
  const token: RollToken = { id: "r", face: "DO", source: "BASIC", baseSteps: 1, finalSteps: 1 };
  const adjusted = adjustedResultForGroup(engine, "p1", engine.players[0].pieces[0].groupId, token, ["P10"]);
  assert.equal(adjusted.finalSteps, 1);
  assert.equal(adjusted.forbidShortcuts, true);
}

// Outer-route movement stays normal, and P09 cannot force a passing shortcut through P10.
{
  const engine = engine2();
  const piece = engine.players[0].pieces[0];
  piece.status = "ON_BOARD";
  piece.node = 5;
  piece.hasEntered = true;
  const token: RollToken = { id: "r", face: "DO", source: "BASIC", baseSteps: 1, finalSteps: 1 };
  const adjusted = adjustedResultForGroup(engine, "p1", piece.groupId, token, ["P10", "P09"]);
  const targets = legalMoveTargetsWithAugments(
    engine,
    "p1",
    piece,
    adjusted,
    ["P10", "P09"],
    { p1: ["P10", "P09"], p2: [] },
  );
  assert.ok(targets.length > 0);
  assert.equal(targets.every((target) => target.node === 6), true, "P10 must stay on the outer route from node 5");
}

// A01 Gravity Explosion cannot relocate P10 pieces, while non-P10 pieces still move.
{
  const engine = engine2();
  const immune = engine.players[0].pieces[0];
  const normal = engine.players[1].pieces[0];
  immune.status = "ON_BOARD"; immune.node = 22; immune.hasEntered = true;
  normal.status = "ON_BOARD"; normal.node = 10; normal.hasEntered = true;
  const next = applyGravityExplosion(engine, "p2", { p1: ["P10"], p2: ["A01"] }, () => 0);
  assert.equal(next.players[0].pieces[0].node, 22);
  assert.equal(next.players[1].pieces[0].node, 11);
}

// A02 Gacha Machine cannot target a P10 piece.
{
  const engine = engine2();
  const target = engine.players[1].pieces[0];
  target.status = "ON_BOARD";
  target.node = 10;
  target.hasEntered = true;
  armGachaMachineOnAcquisition(engine, "p1");
  engine.round = 2;
  assert.throws(
    () => applyGachaMachine(engine, "p1", "p2", target.id, 29, { p1: ["A02"], p2: ["P10"] }, () => 0.1),
    /고가도로/,
  );
  assert.equal(target.node, 10);
}

// A08 Great Upheaval skips the P10 player's pieces but still reshuffles everybody else.
{
  const engine = engine2();
  const immune = engine.players[0].pieces[0];
  const normal = engine.players[1].pieces[0];
  immune.status = "ON_BOARD"; immune.node = 22; immune.hasEntered = true;
  normal.status = "ON_BOARD"; normal.node = 10; normal.hasEntered = true;
  const next = applyGreatUpheaval(
    engine,
    "p1",
    { p1: ["P10", "A08"], p2: [] },
    {},
    () => 0,
  );
  assert.equal(next.players[0].pieces[0].status, "ON_BOARD");
  assert.equal(next.players[0].pieces[0].node, 22);
  assert.equal(next.players[1].pieces[0].status, "WAITING");
  assert.equal(next.players[1].pieces[0].node, null);
}

console.log("p10-overpass probe PASS");
