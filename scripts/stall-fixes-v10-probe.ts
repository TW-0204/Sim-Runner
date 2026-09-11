import assert from "node:assert/strict";

import {
  applyGreatUpheaval,
  createInitialEngine,
  legalMoveTargetsWithAugments,
} from "@/lib/game/engine";
import type { RollToken } from "@/lib/game/types";
import { getBalanceRuleset } from "@/lib/simulation/rulesets";
import { simulateGame } from "@/lib/simulation/game";

function engine2() {
  return createInitialEngine([
    { userId: "p1", displayName: "P1", seat: 1 },
    { userId: "p2", displayName: "P2", seat: 2 },
  ]);
}

function a16Engine(finishedCount: number, node: number) {
  const engine = engine2();
  const player = engine.players[0];
  for (let index = 0; index < finishedCount; index += 1) {
    const piece = player.pieces[index];
    piece.status = "FINISHED";
    piece.node = null;
    piece.hasEntered = true;
  }
  const mover = player.pieces[finishedCount];
  mover.status = "ON_BOARD";
  mover.node = node;
  mover.groupId = mover.id;
  mover.hasEntered = true;
  engine.currentSeat = 1;
  engine.stage = "MOVING";
  return { engine, mover };
}

function token(face: RollToken["face"], steps: number): RollToken {
  return { id: `probe-${face}-${steps}`, face, source: "BASIC", baseSteps: steps, finalSteps: steps };
}

function a16Targets(finishedCount: number, node: number, face: RollToken["face"], steps: number) {
  const { engine, mover } = a16Engine(finishedCount, node);
  return legalMoveTargetsWithAugments(
    engine,
    "p1",
    mover,
    token(face, steps),
    ["A16"],
    { p1: ["A16"], p2: [] },
  );
}

// One finished piece shortens the finish to 22. Crossing center from the 10-side
// diagonal must continue through 15 -> 16 -> 17 -> 22, never into removed 23/24.
{
  const from11 = a16Targets(1, 11, "YUT", 4);
  assert.ok(from11.some((target) => target.node === 17 && !target.finished));
  assert.equal(from11.some((target) => target.node === 23 || target.node === 24), false);

  const from12 = a16Targets(1, 12, "GEOL", 3);
  assert.ok(from12.some((target) => target.node === 17 && !target.finished));
  assert.equal(from12.some((target) => target.node === 23 || target.node === 24), false);

  const reaches22 = a16Targets(1, 11, "MO", 5);
  assert.ok(reaches22.some((target) => target.finished && target.node == null));

  const fromCenter = a16Targets(1, 15, "DO", 1);
  assert.ok(fromCenter.some((target) => target.node === 16 && !target.finished));
}

// Existing pieces stranded beyond a later shortened boundary must still resolve
// instead of becoming permanently unmovable.
{
  const secondTrim = a16Targets(2, 11, "DO", 1);
  assert.ok(secondTrim.some((target) => target.finished));

  const thirdTrim = a16Targets(3, 6, "DO", 1);
  assert.ok(thirdTrim.some((target) => target.finished));
}

// A08 assigns FINISHED directly. P04/P16 replace normal victory, so those
// generated FINISHED states must be normalized through their special-win lifecycle.
{
  const engine = engine2();
  const next = applyGreatUpheaval(
    engine,
    "p2",
    { p1: ["P04"], p2: ["P16", "A08"] },
    {},
    () => 0.99,
  );
  assert.equal(next.winnerUserId, null);
  assert.equal(next.players[0].pieces.every((piece) => piece.status === "WAITING"), true);
  assert.equal(next.players[1].pieces.every((piece) => piece.status === "WAITING"), true);
}

// Exact 90K regression seeds. They may complete or draw, but must never return
// STALLED/ACTION_LIMIT after v10.
{
  const ruleset = getBalanceRuleset("two-aug-start-r4-special-slots-v2");
  const cases = [
    { playerCount: 3, seed: "917675" },
    { playerCount: 3, seed: "922077" },
    { playerCount: 4, seed: "1012369" },
    { playerCount: 4, seed: "1026546" },
  ] as const;

  for (const item of cases) {
    const result = simulateGame({
      seed: item.seed,
      ruleset,
      playerCount: item.playerCount,
      maxActions: 20_000,
    });
    assert.ok(
      result.status === "COMPLETED" || result.status === "DRAW",
      `${item.playerCount}P seed ${item.seed} remained incomplete: ${result.status} ${result.error ?? ""}`,
    );
    console.log(`[v10-regression] ${item.playerCount}P seed ${item.seed}: ${result.status}`);
  }
}

console.log("stall-fixes-v10 probe PASS");
