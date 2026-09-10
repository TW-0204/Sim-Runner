import assert from "node:assert/strict";

import { AUGMENT_BY_ID } from "@/lib/augments/catalog";
import {
  adjustedResultForGroup,
  canGrantFaceExtraRoll,
  cleanerMovesRemaining,
  consumeFaceExtraRollGrant,
  huntCaptureTarget,
} from "@/lib/augments/effects";
import {
  applyGachaMachine,
  applyMoonwalkAcquisitionScatter,
  applyMove,
  armGachaMachineOnAcquisition,
  createInitialEngine,
  gachaMachineIsReady,
  legalMoveTargetsWithAugments,
} from "@/lib/game/engine";
import { godHandChargeCount } from "@/lib/game/roll-flow";
import type { RollToken } from "@/lib/game/types";

function engine2() {
  return createInitialEngine([
    { userId: "p1", displayName: "P1", seat: 1 },
    { userId: "p2", displayName: "P2", seat: 2 },
  ]);
}

// Catalog / tier / deletion locks.
assert.equal(AUGMENT_BY_ID.get("S15")?.name, "무임승차");
assert.equal(AUGMENT_BY_ID.get("S15")?.tier, "prism");
assert.equal(AUGMENT_BY_ID.get("P09")?.tier, "prism");
assert.equal(AUGMENT_BY_ID.get("S05")?.tier, "gold");
assert.equal(AUGMENT_BY_ID.get("G10")?.tier, "silver");
assert.equal(AUGMENT_BY_ID.get("A16")?.tier, "prism");
assert.equal(AUGMENT_BY_ID.get("A16")?.timing, "first");
for (const id of ["P18", "G02", "P01", "P05", "P07", "P15"]) assert.equal(AUGMENT_BY_ID.has(id), false, `${id} must be removed`);

// P16 thresholds.
assert.equal(huntCaptureTarget(2), 7);
assert.equal(huntCaptureTarget(3), 19);
assert.equal(huntCaptureTarget(4), 30);

// P19 starts empty.
assert.equal(godHandChargeCount(engine2(), "p1", ["P19"]), 0);

// S06 departure is +2.
{
  const engine = engine2();
  const token: RollToken = { id: "r", face: "DO", source: "BASIC", baseSteps: 1, finalSteps: 1 };
  const adjusted = adjustedResultForGroup(engine, "p1", "1-1", token, ["S06"]);
  assert.equal(adjusted.finalSteps, 3);
}

// P06 has four movements.
assert.equal(cleanerMovesRemaining(engine2(), "p1", ["P06"]), 4);

// G01 grants at most two GAE extra rolls per turn.
{
  const engine = engine2();
  assert.equal(canGrantFaceExtraRoll(engine, "p1", "GAE", ["G01"]), true);
  assert.equal(consumeFaceExtraRollGrant(engine, "p1", "GAE", ["G01"]), true);
  assert.equal(consumeFaceExtraRollGrant(engine, "p1", "GAE", ["G01"]), true);
  assert.equal(consumeFaceExtraRollGrant(engine, "p1", "GAE", ["G01"]), false);
}

// A02: usable one round after acquisition, then 20% success path / 2-round cooldown.
{
  const engine = engine2();
  armGachaMachineOnAcquisition(engine, "p1");
  assert.equal(engine.augmentRuntime?.p1?.gachaNextUseRound, 2);
  assert.equal(gachaMachineIsReady(engine, "p1", ["A02"]), false);
  engine.round = 2;
  const p1 = engine.players[0];
  const piece = p1.pieces[0];
  piece.status = "ON_BOARD";
  piece.node = 1;
  const failed = applyGachaMachine(engine, "p1", "p1", piece.id, 29, { p1: ["A02"], p2: [] }, () => 0.5);
  assert.equal(failed.success, false);
  assert.equal(failed.engine.augmentRuntime?.p1?.gachaNextUseRound, 4);
  const success = applyGachaMachine(engine, "p1", "p1", piece.id, 29, { p1: ["A02"], p2: [] }, () => 0.1);
  assert.equal(success.success, true);
}

// P02 scatters every waiting piece immediately.
{
  const scattered = applyMoonwalkAcquisitionScatter(engine2(), "p1", () => 0);
  assert.equal(scattered.players[0].pieces.every((piece) => piece.status === "ON_BOARD" && piece.node === 1), true);
}

// A14: normal capture + infected WAITING; infected piece needs GEOL+ to depart.
{
  const engine = engine2();
  const attacker = engine.players[0].pieces[0];
  attacker.status = "ON_BOARD";
  attacker.node = 1;
  attacker.hasEntered = true;
  const victim = engine.players[1].pieces[0];
  victim.status = "ON_BOARD";
  victim.node = 2;
  victim.hasEntered = true;
  engine.stage = "MOVING";
  engine.results = [{ id: "r", face: "DO", source: "BASIC", baseSteps: 1, finalSteps: 1 }];
  const after = applyMove(engine, { groupId: attacker.groupId, resultId: "r" }, ["A14"], {}, { p1: ["A14"], p2: [] });
  const captured = after.players[1].pieces.find((piece) => piece.id === victim.id)!;
  assert.equal(captured.status, "WAITING");
  assert.equal(after.augmentRuntime?.p2?.plaguePieceIds?.[victim.id], true);
  const doToken: RollToken = { id: "do", face: "DO", source: "BASIC", baseSteps: 1, finalSteps: 1 };
  const geolToken: RollToken = { id: "geol", face: "GEOL", source: "BASIC", baseSteps: 3, finalSteps: 3 };
  assert.equal(legalMoveTargetsWithAugments(after, "p2", captured, doToken, [], { p1: ["A14"], p2: [] }).length, 0);
  assert.ok(legalMoveTargetsWithAugments(after, "p2", captured, geolToken, [], { p1: ["A14"], p2: [] }).length > 0);
}

// A16: after one finish, reaching node 22 is enough to finish the next piece.
{
  const engine = engine2();
  const player = engine.players[0];
  player.pieces[0].status = "FINISHED";
  player.pieces[0].node = null;
  player.pieces[1].status = "ON_BOARD";
  player.pieces[1].node = 20;
  player.pieces[1].hasEntered = true;
  const token: RollToken = { id: "r", face: "GAE", source: "BASIC", baseSteps: 2, finalSteps: 2 };
  const targets = legalMoveTargetsWithAugments(engine, "p1", player.pieces[1], token, ["A16"], { p1: ["A16"], p2: [] });
  assert.equal(targets.some((target) => target.finished), true);
}

console.log("balance-rework-v3 probe PASS");
