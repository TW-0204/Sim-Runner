import assert from "node:assert/strict";
import { adjustedResultForGroup } from "../src/lib/augments/effects";
import { applyMove, createInitialEngine } from "../src/lib/game/engine";
import type { RollToken } from "../src/lib/game/types";

function fresh() {
  return createInitialEngine([
    { userId: "p1", displayName: "P1", seat: 1 },
    { userId: "p2", displayName: "P2", seat: 2 },
  ]);
}

function movement(engine: ReturnType<typeof fresh>, face: RollToken["face"], steps: number) {
  engine.stage = "MOVING";
  engine.pendingRolls = [];
  engine.results = [{ id: `r:${face}`, face, baseSteps: steps, finalSteps: steps, source: "BASIC" }];
}

// 1) A14 owner infects instead of capturing and coexists at the destination.
{
  const engine = fresh();
  const p1 = engine.players[0];
  const p2 = engine.players[1];
  const attacker = p1.pieces[0];
  const victim = p2.pieces[0];
  attacker.status = "ON_BOARD"; attacker.node = 4; attacker.hasEntered = true;
  victim.status = "ON_BOARD"; victim.node = 5; victim.hasEntered = true;
  movement(engine, "DO", 1);
  const next = applyMove(engine, { groupId: attacker.groupId, resultId: "r:DO", forwardPath: [5] }, ["A14"], {}, { p1: ["A14"], p2: [] });
  const nextAttacker = next.players[0].pieces.find((piece) => piece.id === attacker.id)!;
  const nextVictim = next.players[1].pieces.find((piece) => piece.id === victim.id)!;
  assert.equal(nextAttacker.status, "ON_BOARD");
  assert.equal(nextAttacker.node, 5);
  assert.equal(nextVictim.status, "ON_BOARD", "plague landing must not capture");
  assert.equal(nextVictim.node, 5);
  assert.equal(next.augmentRuntime?.p2?.plaguePieceIds?.[victim.id], true);
  assert.equal(next.pendingRolls.includes("CAPTURE"), false);
}

// 2) Infection reduces forward movement by 2; DO/GAE therefore force an immediate waiting return and clear infection.
for (const [face, steps] of [["DO", 1], ["GAE", 2]] as const) {
  const engine = fresh();
  const p1 = engine.players[0];
  const piece = p1.pieces[0];
  piece.status = "ON_BOARD"; piece.node = 5; piece.hasEntered = true;
  engine.augmentRuntime = { p1: { plaguePieceIds: { [piece.id]: true } } };
  movement(engine, face, steps);
  const adjusted = adjustedResultForGroup(engine, "p1", piece.groupId, engine.results[0], []);
  assert.equal(adjusted.finalSteps, steps - 2);
  const next = applyMove(engine, { groupId: piece.groupId, resultId: `r:${face}` }, [], {}, { p1: [], p2: [] });
  const returned = next.players[0].pieces.find((candidate) => candidate.id === piece.id)!;
  assert.equal(returned.status, "WAITING");
  assert.equal(next.augmentRuntime?.p1?.plaguePieceIds?.[piece.id], undefined);
}

// 3) GEOL still advances one cell after the plague penalty.
{
  const engine = fresh();
  const p1 = engine.players[0];
  const piece = p1.pieces[0];
  piece.status = "ON_BOARD"; piece.node = 1; piece.hasEntered = true;
  engine.augmentRuntime = { p1: { plaguePieceIds: { [piece.id]: true } } };
  movement(engine, "GEOL", 3);
  const next = applyMove(engine, { groupId: piece.groupId, resultId: "r:GEOL", forwardPath: [2] }, [], {}, { p1: [], p2: [] });
  const moved = next.players[0].pieces.find((candidate) => candidate.id === piece.id)!;
  assert.equal(moved.status, "ON_BOARD");
  assert.equal(moved.node, 2);
  assert.equal(next.augmentRuntime?.p1?.plaguePieceIds?.[piece.id], true);
}

// 4) Capturing an infected group infects the attacker, while the captured infection is cleared.
{
  const engine = fresh();
  const p1 = engine.players[0];
  const p2 = engine.players[1];
  const attacker = p1.pieces[0];
  const victim = p2.pieces[0];
  attacker.status = "ON_BOARD"; attacker.node = 4; attacker.hasEntered = true;
  victim.status = "ON_BOARD"; victim.node = 5; victim.hasEntered = true;
  engine.augmentRuntime = { p2: { plaguePieceIds: { [victim.id]: true } } };
  movement(engine, "DO", 1);
  const next = applyMove(engine, { groupId: attacker.groupId, resultId: "r:DO", forwardPath: [5] }, [], {}, { p1: [], p2: [] });
  const nextVictim = next.players[1].pieces.find((piece) => piece.id === victim.id)!;
  assert.equal(nextVictim.status, "WAITING");
  assert.equal(next.augmentRuntime?.p1?.plaguePieceIds?.[attacker.id], true);
  assert.equal(next.augmentRuntime?.p2?.plaguePieceIds?.[victim.id], undefined);
  assert.equal(next.pendingRolls.includes("CAPTURE"), true);
}

// 5) BACKDO is never reduced by plague.
{
  const engine = fresh();
  const piece = engine.players[0].pieces[0];
  piece.status = "ON_BOARD"; piece.node = 5; piece.hasEntered = true;
  engine.augmentRuntime = { p1: { plaguePieceIds: { [piece.id]: true } } };
  const backdo: RollToken = { id: "back", face: "BACKDO", baseSteps: -1, finalSteps: -1, source: "BASIC" };
  assert.equal(adjustedResultForGroup(engine, "p1", piece.groupId, backdo, []).finalSteps, -1);
}

console.log("[batch7-probe] PASS: A14 Plague mechanics validated.");
