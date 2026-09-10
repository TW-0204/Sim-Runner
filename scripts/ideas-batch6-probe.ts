import assert from "node:assert/strict";
import {
  applyMarginExit,
  applyMarginReturn,
  createInitialEngine,
} from "../src/lib/game/engine";
import type { GameEngineState, RollToken } from "../src/lib/game/types";

const OWNED = ["A16"];
const OWNED_BY_USER = { p1: OWNED, p2: [] as string[] };

function engine() {
  return createInitialEngine([
    { userId: "p1", displayName: "P1", seat: 1 },
    { userId: "p2", displayName: "P2", seat: 2 },
  ]);
}

function token(id: string, face: RollToken["face"], steps: number): RollToken {
  return { id, face, baseSteps: steps, finalSteps: steps, source: "BASIC" };
}

// 1) A physical piece can leave a stack without moving the rest of the stack.
{
  const initial = engine();
  const p1 = initial.players[0];
  const [a, b] = p1.pieces;
  a.status = "ON_BOARD";
  a.node = 10;
  a.hasEntered = true;
  b.status = "ON_BOARD";
  b.node = 10;
  b.hasEntered = true;
  b.groupId = a.groupId;

  const next = applyMarginExit(initial, "p1", a.id, OWNED);
  const nextP1 = next.players[0];
  const hidden = nextP1.pieces.find((piece) => piece.id === a.id)!;
  const remaining = nextP1.pieces.find((piece) => piece.id === b.id)!;
  assert.equal(hidden.status, "MARGIN");
  assert.equal(hidden.node, null);
  assert.equal(next.augmentRuntime?.p1?.marginOriginByPiece?.[a.id], 10);
  assert.equal(remaining.status, "ON_BOARD");
  assert.equal(remaining.node, 10);
  assert.notEqual(remaining.groupId, hidden.groupId);
  assert.equal(next.pendingRolls[0], "BASIC", "entering margin must be free");

  assert.throws(
    () => applyMarginExit(next, "p1", remaining.id, OWNED),
    /한 턴에는 말 1기만/,
    "only one piece may enter margin per turn",
  );
}

// 2) Returning consumes one positive Yut result, restores the exact origin, and performs a normal base capture.
{
  const initial = engine();
  const p1 = initial.players[0];
  const p2 = initial.players[1];
  const piece = p1.pieces[0];
  const victim = p2.pieces[0];
  piece.status = "MARGIN";
  piece.node = null;
  piece.hasEntered = true;
  victim.status = "ON_BOARD";
  victim.node = 18;
  victim.hasEntered = true;
  initial.augmentRuntime = { p1: { marginOriginByPiece: { [piece.id]: 18 } } };
  initial.stage = "MOVING";
  initial.pendingRolls = [];
  initial.results = [token("gae", "GAE", 2)];

  const next = applyMarginReturn(initial, "p1", piece.id, "gae", OWNED, OWNED_BY_USER);
  const returned = next.players[0].pieces.find((candidate) => candidate.id === piece.id)!;
  const captured = next.players[1].pieces.find((candidate) => candidate.id === victim.id)!;
  assert.equal(returned.status, "ON_BOARD");
  assert.equal(returned.node, 18);
  assert.equal(captured.status, "WAITING");
  assert.equal(next.augmentRuntime?.p1?.marginOriginByPiece?.[piece.id], undefined);
  assert.equal(next.results.some((result) => result.id === "gae"), false);
  assert.equal(next.pendingRolls.includes("CAPTURE"), true, "return capture should grant the usual capture roll");
}

// 3) Returning onto an ally opens the ordinary stacking choice.
{
  const initial = engine();
  const p1 = initial.players[0];
  const hidden = p1.pieces[0];
  const ally = p1.pieces[1];
  hidden.status = "MARGIN";
  hidden.node = null;
  hidden.hasEntered = true;
  ally.status = "ON_BOARD";
  ally.node = 22;
  ally.hasEntered = true;
  initial.augmentRuntime = { p1: { marginOriginByPiece: { [hidden.id]: 22 } } };
  initial.stage = "MOVING";
  initial.pendingRolls = [];
  initial.results = [token("do", "DO", 1)];

  const next = applyMarginReturn(initial, "p1", hidden.id, "do", OWNED, OWNED_BY_USER);
  assert.equal(next.stage, "STACK_CHOICE");
  assert.ok(next.pendingStackChoice?.alliedGroupIds.includes(ally.groupId));
  assert.equal(next.pendingStackChoice?.destination, 22);
}

// 4) BACKDO cannot be spent to return from margin.
{
  const initial = engine();
  const p1 = initial.players[0];
  const hidden = p1.pieces[0];
  hidden.status = "MARGIN";
  hidden.node = null;
  hidden.hasEntered = true;
  initial.augmentRuntime = { p1: { marginOriginByPiece: { [hidden.id]: 5 } } };
  initial.stage = "MOVING";
  initial.pendingRolls = [];
  initial.results = [token("backdo", "BACKDO", -1)];
  assert.throws(
    () => applyMarginReturn(initial, "p1", hidden.id, "backdo", OWNED, OWNED_BY_USER),
    /도, 개, 걸, 윷, 모/,
  );
}

console.log("[batch6-probe] PASS: A16 Margin mechanics validated.");
