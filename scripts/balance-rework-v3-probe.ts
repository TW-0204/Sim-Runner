import assert from "node:assert/strict";

import { AUGMENT_BY_ID, AUGMENTS } from "@/lib/augments/catalog";
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
assert.equal(AUGMENT_BY_ID.get("AUG-015")?.name, "무임승차");
assert.equal(AUGMENT_BY_ID.get("AUG-015")?.tier, "prism");
assert.equal(AUGMENT_BY_ID.get("AUG-036")?.tier, "prism");
assert.equal(AUGMENT_BY_ID.get("AUG-005")?.tier, "gold");
assert.equal(AUGMENT_BY_ID.get("AUG-025")?.tier, "silver");
assert.equal(AUGMENT_BY_ID.get("AUG-059")?.tier, "prism");
assert.equal(AUGMENT_BY_ID.get("AUG-059")?.timing, "first");
for (const id of ["AUG-066", "AUG-060", "AUG-062", "AUG-063", "AUG-064", "AUG-065"]) {
  assert.equal(AUGMENTS.some((augment) => augment.id === id), false, `${id} must be excluded from the active pool`);
}

// AUG-042 thresholds.
assert.equal(huntCaptureTarget(2), 7);
assert.equal(huntCaptureTarget(3), 19);
assert.equal(huntCaptureTarget(4), 30);

// AUG-044 starts empty.
assert.equal(godHandChargeCount(engine2(), "p1", ["AUG-044"]), 0);

// AUG-006 departure is +2.
{
  const engine = engine2();
  const token: RollToken = { id: "r", face: "DO", source: "BASIC", baseSteps: 1, finalSteps: 1 };
  const adjusted = adjustedResultForGroup(engine, "p1", "1-1", token, ["AUG-006"]);
  assert.equal(adjusted.finalSteps, 3);
}

// AUG-034 has four movements.
assert.equal(cleanerMovesRemaining(engine2(), "p1", ["AUG-034"]), 4);

// AUG-017 grants at most two GAE extra rolls per turn.
{
  const engine = engine2();
  assert.equal(canGrantFaceExtraRoll(engine, "p1", "GAE", ["AUG-017"]), true);
  assert.equal(consumeFaceExtraRollGrant(engine, "p1", "GAE", ["AUG-017"]), true);
  assert.equal(consumeFaceExtraRollGrant(engine, "p1", "GAE", ["AUG-017"]), true);
  assert.equal(consumeFaceExtraRollGrant(engine, "p1", "GAE", ["AUG-017"]), false);
}

// AUG-046: usable one round after acquisition, then 20% success path / 2-round cooldown.
{
  const engine = engine2();
  armGachaMachineOnAcquisition(engine, "p1");
  assert.equal(engine.augmentRuntime?.p1?.gachaNextUseRound, 2);
  assert.equal(gachaMachineIsReady(engine, "p1", ["AUG-046"]), false);
  engine.round = 2;
  const p1 = engine.players[0];
  const piece = p1.pieces[0];
  piece.status = "ON_BOARD";
  piece.node = 1;
  const failed = applyGachaMachine(engine, "p1", "p1", piece.id, 29, { p1: ["AUG-046"], p2: [] }, () => 0.5);
  assert.equal(failed.success, false);
  assert.equal(failed.engine.augmentRuntime?.p1?.gachaNextUseRound, 4);
  const success = applyGachaMachine(engine, "p1", "p1", piece.id, 29, { p1: ["AUG-046"], p2: [] }, () => 0.1);
  assert.equal(success.success, true);
}

// AUG-031 scatters every waiting piece immediately.
{
  const scattered = applyMoonwalkAcquisitionScatter(engine2(), "p1", () => 0);
  assert.equal(scattered.players[0].pieces.every((piece) => piece.status === "ON_BOARD" && piece.node === 1), true);
}

// AUG-057: normal capture + infected WAITING; infected piece needs GEOL+ to depart.
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
  const after = applyMove(engine, { groupId: attacker.groupId, resultId: "r" }, ["AUG-057"], {}, { p1: ["AUG-057"], p2: [] });
  const captured = after.players[1].pieces.find((piece) => piece.id === victim.id)!;
  assert.equal(captured.status, "WAITING");
  assert.equal(after.augmentRuntime?.p2?.plaguePieceIds?.[victim.id], true);
  const doToken: RollToken = { id: "do", face: "DO", source: "BASIC", baseSteps: 1, finalSteps: 1 };
  const geolToken: RollToken = { id: "geol", face: "GEOL", source: "BASIC", baseSteps: 3, finalSteps: 3 };
  assert.equal(legalMoveTargetsWithAugments(after, "p2", captured, doToken, [], { p1: ["AUG-057"], p2: [] }).length, 0);
  assert.ok(legalMoveTargetsWithAugments(after, "p2", captured, geolToken, [], { p1: ["AUG-057"], p2: [] }).length > 0);
}

// AUG-059: after one finish, reaching node 22 is enough to finish the next piece.
{
  const engine = engine2();
  const player = engine.players[0];
  player.pieces[0].status = "FINISHED";
  player.pieces[0].node = null;
  player.pieces[1].status = "ON_BOARD";
  player.pieces[1].node = 20;
  player.pieces[1].hasEntered = true;
  const token: RollToken = { id: "r", face: "GAE", source: "BASIC", baseSteps: 2, finalSteps: 2 };
  const targets = legalMoveTargetsWithAugments(engine, "p1", player.pieces[1], token, ["AUG-059"], { p1: ["AUG-059"], p2: [] });
  assert.equal(targets.some((target) => target.finished), true);
}

console.log("balance-rework-v3 probe PASS");
