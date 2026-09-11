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

// Catalog lock: renamed, first-only, and mutually incompatible with AUG-031/AUG-033.
{
  const p10 = AUGMENT_BY_ID.get("AUG-037")!;
  const p02 = AUGMENT_BY_ID.get("AUG-031")!;
  const p04 = AUGMENT_BY_ID.get("AUG-033")!;
  assert.equal(p10.name, "고가도로");
  assert.equal(p10.timing, "first");
  assert.deepEqual(new Set(p10.conflicts ?? []), new Set(["AUG-031", "AUG-033"]));
  assert.ok(p02.conflicts?.includes("AUG-037"));
  assert.ok(p04.conflicts?.includes("AUG-037"));

  const lastSpecials = buildSpecialOfferCandidateIds({
    seed: "p10-conflict",
    phase: 3,
    userId: "p1",
    ownedIds: ["AUG-037"],
  });
  assert.equal(lastSpecials.includes("AUG-031"), false, "AUG-031 must not be offerable after AUG-037");
}

// AUG-037 no longer grants +2, but still marks normal movement as shortcut-forbidden.
{
  const engine = engine2();
  const token: RollToken = { id: "r", face: "DO", source: "BASIC", baseSteps: 1, finalSteps: 1 };
  const adjusted = adjustedResultForGroup(engine, "p1", engine.players[0].pieces[0].groupId, token, ["AUG-037"]);
  assert.equal(adjusted.finalSteps, 1);
  assert.equal(adjusted.forbidShortcuts, true);
}

// Outer-route movement stays normal, and AUG-036 cannot force a passing shortcut through AUG-037.
{
  const engine = engine2();
  const piece = engine.players[0].pieces[0];
  piece.status = "ON_BOARD";
  piece.node = 5;
  piece.hasEntered = true;
  const token: RollToken = { id: "r", face: "DO", source: "BASIC", baseSteps: 1, finalSteps: 1 };
  const adjusted = adjustedResultForGroup(engine, "p1", piece.groupId, token, ["AUG-037", "AUG-036"]);
  const targets = legalMoveTargetsWithAugments(
    engine,
    "p1",
    piece,
    adjusted,
    ["AUG-037", "AUG-036"],
    { p1: ["AUG-037", "AUG-036"], p2: [] },
  );
  assert.ok(targets.length > 0);
  assert.equal(targets.every((target) => target.node === 6), true, "AUG-037 must stay on the outer route from node 5");
}

// AUG-045 Gravity Explosion cannot relocate AUG-037 pieces, while non-AUG-037 pieces still move.
{
  const engine = engine2();
  const immune = engine.players[0].pieces[0];
  const normal = engine.players[1].pieces[0];
  immune.status = "ON_BOARD"; immune.node = 22; immune.hasEntered = true;
  normal.status = "ON_BOARD"; normal.node = 10; normal.hasEntered = true;
  const next = applyGravityExplosion(engine, "p2", { p1: ["AUG-037"], p2: ["AUG-045"] }, () => 0);
  assert.equal(next.players[0].pieces[0].node, 22);
  assert.equal(next.players[1].pieces[0].node, 11);
}

// AUG-046 Gacha Machine cannot target a AUG-037 piece.
{
  const engine = engine2();
  const target = engine.players[1].pieces[0];
  target.status = "ON_BOARD";
  target.node = 10;
  target.hasEntered = true;
  armGachaMachineOnAcquisition(engine, "p1");
  engine.round = 2;
  assert.throws(
    () => applyGachaMachine(engine, "p1", "p2", target.id, 29, { p1: ["AUG-046"], p2: ["AUG-037"] }, () => 0.1),
    /고가도로/,
  );
  assert.equal(target.node, 10);
}

// AUG-051 Great Upheaval skips the AUG-037 player's pieces but still reshuffles everybody else.
{
  const engine = engine2();
  const immune = engine.players[0].pieces[0];
  const normal = engine.players[1].pieces[0];
  immune.status = "ON_BOARD"; immune.node = 22; immune.hasEntered = true;
  normal.status = "ON_BOARD"; normal.node = 10; normal.hasEntered = true;
  const next = applyGreatUpheaval(
    engine,
    "p1",
    { p1: ["AUG-037", "AUG-051"], p2: [] },
    {},
    () => 0,
  );
  assert.equal(next.players[0].pieces[0].status, "ON_BOARD");
  assert.equal(next.players[0].pieces[0].node, 22);
  assert.equal(next.players[1].pieces[0].status, "WAITING");
  assert.equal(next.players[1].pieces[0].node, null);
}

console.log("p10-overpass probe PASS");
