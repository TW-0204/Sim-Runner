import assert from "node:assert/strict";
import { applyMarginExit, createInitialEngine } from "../src/lib/game/engine";

const engine = createInitialEngine([
  { userId: "p1", displayName: "P1", seat: 1 },
  { userId: "p2", displayName: "P2", seat: 2 },
]);
const p1 = engine.players[0];
const first = p1.pieces[0];
const second = p1.pieces[1];
first.status = "MARGIN";
first.node = null;
second.status = "ON_BOARD";
second.node = 5;
second.hasEntered = true;
engine.augmentRuntime = { p1: { marginOriginByPiece: { [first.id]: 4 } } };
engine.stage = "AWAITING_ROLL";
engine.pendingRolls = ["BASIC"];

assert.throws(
  () => applyMarginExit(engine, "p1", second.id, ["A16"]),
  /여백에는 자신의 말 1기만 들어갈 수 있습니다/,
);

console.log("[rough-balance-v2-probe] PASS: A16 allows at most one piece in margin.");
