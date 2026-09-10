import assert from "node:assert/strict";
import { adjustedResultForGroup, applyBetrayalTransfer } from "../src/lib/augments/effects";
import {
  applyGreatUpheaval,
  applyMove,
  createInitialEngine,
  legalMoveTargetsWithAugments,
} from "../src/lib/game/engine";
import type { RollFace, RollToken } from "../src/lib/game/types";

function fresh() {
  return createInitialEngine([
    { userId: "p1", displayName: "P1", seat: 1 },
    { userId: "p2", displayName: "P2", seat: 2 },
  ]);
}

function setMovement(engine: ReturnType<typeof fresh>, face: RollFace, steps: number, tokenId = `r:${face}`) {
  engine.stage = "MOVING";
  engine.pendingRolls = [];
  engine.results = [{ id: tokenId, face, baseSteps: steps, finalSteps: steps, source: "BASIC" }];
}

// A10: transfer still creates the intended 3-piece vs 5-piece ownership state.
{
  const start = fresh();
  const betrayal = applyBetrayalTransfer(start, "p1", () => 0);
  const engine = betrayal.engine;
  const p1 = engine.players.find((player) => player.userId === "p1")!;
  const p2 = engine.players.find((player) => player.userId === "p2")!;
  const transferred = p2.pieces.find((piece) => piece.id === betrayal.transferredPieceId)!;

  assert.equal(p1.pieces.length, 3);
  assert.equal(p2.pieces.length, 5);
  assert.equal(transferred.ownerUserId, "p2");
  assert.equal(transferred.betrayalOriginalOwnerUserId, "p1");

  // Recipient has already finished its four native pieces except one. Stack that last native
  // piece with the betrayed piece and finish both together. The native piece remains FINISHED,
  // the betrayed piece returns to P1 WAITING, and P2 can win because it did complete all 5.
  const native = p2.pieces.filter((piece) => piece.id !== transferred.id);
  for (const piece of native.slice(0, 3)) {
    piece.status = "FINISHED";
    piece.node = null;
  }
  const nativeLast = native[3]!;
  nativeLast.status = "ON_BOARD";
  nativeLast.node = 29;
  nativeLast.groupId = transferred.id;
  nativeLast.hasEntered = true;
  transferred.status = "ON_BOARD";
  transferred.node = 29;
  transferred.groupId = transferred.id;
  transferred.hasEntered = true;

  engine.currentSeat = 2;
  setMovement(engine, "DO", 1);
  const token = engine.results[0]!;
  const target = legalMoveTargetsWithAugments(
    engine,
    "p2",
    transferred,
    token,
    [],
    { p1: ["A10"], p2: [] },
  ).find((candidate) => candidate.finished);
  assert.ok(target, "node 29 + DO should expose a finish target");

  const next = applyMove(
    engine,
    { groupId: transferred.groupId, resultId: token.id, forwardPath: target.path },
    [],
    {},
    { p1: ["A10"], p2: [] },
  );
  const nextP1 = next.players.find((player) => player.userId === "p1")!;
  const nextP2 = next.players.find((player) => player.userId === "p2")!;
  const returned = nextP1.pieces.find((piece) => piece.id === transferred.id)!;

  assert.equal(nextP1.pieces.length, 4);
  assert.equal(nextP2.pieces.length, 4);
  assert.equal(returned.ownerUserId, "p1");
  assert.equal(returned.status, "WAITING");
  assert.equal(returned.node, null);
  assert.equal(returned.groupId, returned.id);
  assert.equal(returned.betrayalOriginalOwnerUserId, undefined);
  assert.equal(nextP2.pieces.every((piece) => piece.status === "FINISHED"), true);
  assert.equal(next.winnerUserId, "p2");
}

// A10 x A08: direct FINISHED assignment by Great Upheaval also returns a completed betrayed piece.
{
  const betrayal = applyBetrayalTransfer(fresh(), "p1", () => 0);
  const next = applyGreatUpheaval(
    betrayal.engine,
    "p1",
    { p1: ["A10", "A08"], p2: [] },
    () => 0.99,
  );
  const p1 = next.players.find((player) => player.userId === "p1")!;
  const p2 = next.players.find((player) => player.userId === "p2")!;
  const returned = p1.pieces.find((piece) => piece.id === betrayal.transferredPieceId)!;

  assert.equal(returned.status, "WAITING");
  assert.equal(returned.ownerUserId, "p1");
  assert.equal(p1.pieces.length, 4);
  assert.equal(p2.pieces.length, 4);
  assert.equal(p2.pieces.every((piece) => piece.status === "FINISHED"), true);
}

// A14: forward penalty is now exactly -3, while BACKDO remains unaffected.
{
  const cases: Array<[RollFace, number, number]> = [
    ["DO", 1, -2],
    ["GAE", 2, -1],
    ["GEOL", 3, 0],
    ["YUT", 4, 1],
    ["MO", 5, 2],
    ["BACKDO", -1, -1],
  ];

  for (const [face, steps, expected] of cases) {
    const engine = fresh();
    const piece = engine.players[0].pieces[0]!;
    piece.status = "ON_BOARD";
    piece.node = 5;
    piece.hasEntered = true;
    engine.augmentRuntime = { p1: { plaguePieceIds: { [piece.id]: true } } };
    const result: RollToken = { id: `r:${face}`, face, baseSteps: steps, finalSteps: steps, source: "BASIC" };
    assert.equal(adjustedResultForGroup(engine, "p1", piece.groupId, result, []).finalSteps, expected);
  }
}

// With -3, GEOL is now a forced return to WAITING and clears infection.
{
  const engine = fresh();
  const piece = engine.players[0].pieces[0]!;
  piece.status = "ON_BOARD";
  piece.node = 5;
  piece.hasEntered = true;
  engine.augmentRuntime = { p1: { plaguePieceIds: { [piece.id]: true } } };
  setMovement(engine, "GEOL", 3);
  const next = applyMove(engine, { groupId: piece.groupId, resultId: "r:GEOL" }, [], {}, { p1: [], p2: [] });
  const returned = next.players[0].pieces.find((candidate) => candidate.id === piece.id)!;
  assert.equal(returned.status, "WAITING");
  assert.equal(next.augmentRuntime?.p1?.plaguePieceIds?.[piece.id], undefined);
}

console.log("[augment-rough-balance-v1-probe] PASS: A10 finish-return and A14 -3 validated.");
