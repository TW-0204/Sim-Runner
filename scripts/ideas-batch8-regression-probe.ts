import assert from "node:assert/strict";
import { applyWormholeTurn, createInitialEngine } from "../src/lib/game/engine";
import type { RollToken } from "../src/lib/game/types";

const engine = createInitialEngine([
  { userId: "p1", displayName: "P1", seat: 1 },
  { userId: "p2", displayName: "P2", seat: 2 },
]);
const p1 = engine.players[0];
for (let i = 0; i < 3; i += 1) {
  p1.pieces[i].status = "FINISHED";
  p1.pieces[i].node = null;
  p1.pieces[i].hasEntered = true;
}
const last = p1.pieces[3];
last.status = "ON_BOARD";
last.node = 28;
last.hasEntered = true;
engine.augmentRuntime = { p1: { wormholeNextOpenRound: 1 } };
engine.stage = "AWAITING_ROLL";
engine.pendingRolls = ["BASIC"];
const stored: RollToken = { id: "tomorrow:p1:1", face: "GAE", baseSteps: 2, finalSteps: 3, source: "AUGMENT" };
engine.results = [stored];

assert.throws(
  () => applyWormholeTurn(engine, "p1", last.groupId, ["A13", "G13"]),
  /남아 있는 이동 결과를 사용할 말이 없어/,
  "A13 must not allow the only movable group to enter while an existing result would be stranded",
);

console.log("[batch8-regression] PASS: A13/G13 stranded-result deadlock is blocked.");
