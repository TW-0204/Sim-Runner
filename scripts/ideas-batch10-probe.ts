import assert from "node:assert/strict";
import { AUGMENT_BY_ID } from "../src/lib/augments/catalog";
import { applyGreatUpheaval, createInitialEngine } from "../src/lib/game/engine";

function fresh(count: 2 | 3 | 4) {
  return createInitialEngine(Array.from({ length: count }, (_, index) => ({
    userId: `p${index + 1}`,
    displayName: `P${index + 1}`,
    seat: index + 1,
  })));
}

function sequenceRandom(values: number[]) {
  let index = 0;
  return () => values[index++] ?? 0;
}

// 1) A08 is Prism and second-augment only.
{
  const augment = AUGMENT_BY_ID.get("A08");
  assert.equal(augment?.tier, "prism");
  assert.equal(augment?.timing, "last");
}

// 2) Every physical piece is independently reshuffled, including WORMHOLE/MARGIN pieces.
// Existing stacks break, same-cell coexistence is allowed, and no landing capture occurs.
{
  const engine = fresh(2);
  const [p1, p2] = engine.players;

  p1.pieces[0].status = "ON_BOARD"; p1.pieces[0].node = 5; p1.pieces[0].hasEntered = true;
  p1.pieces[1].status = "ON_BOARD"; p1.pieces[1].node = 5; p1.pieces[1].hasEntered = true; p1.pieces[1].groupId = p1.pieces[0].groupId;
  p1.pieces[2].status = "WORMHOLE"; p1.pieces[2].node = null; p1.pieces[2].hasEntered = true;
  p1.pieces[3].status = "MARGIN"; p1.pieces[3].node = null; p1.pieces[3].hasEntered = true;
  p1.pieces[0].pathHistory = [1, 2, 3, 4, 5];

  engine.augmentRuntime = {
    p1: {
      fixedOneGroups: { [p1.pieces[0].groupId]: true },
      wormholeTransit: {
        [p1.pieces[2].groupId]: { returnRound: 6, originNode: 10, pieceIds: [p1.pieces[2].id] },
      },
      marginOriginByPiece: { [p1.pieces[3].id]: 22 },
    },
  };

  const random = sequenceRandom([
    0.50, 0.21, // p1-1 -> ON_BOARD node 7
    0.50, 0.21, // p1-2 -> ON_BOARD node 7, but separate group
    0.10,       // p1-3 -> WAITING
    0.90,       // p1-4 -> FINISHED
    0.50, 0.21, // p2-1 -> ON_BOARD node 7 (opponent coexistence; no capture)
    0.10,       // p2-2 -> WAITING
    0.10,       // p2-3 -> WAITING
    0.10,       // p2-4 -> WAITING
  ]);

  const next = applyGreatUpheaval(engine, "p1", { p1: ["A08"], p2: [] }, random);
  const n1 = next.players[0];
  const n2 = next.players[1];

  assert.equal(n1.pieces[0].status, "ON_BOARD");
  assert.equal(n1.pieces[0].node, 7);
  assert.equal(n1.pieces[1].status, "ON_BOARD");
  assert.equal(n1.pieces[1].node, 7);
  assert.notEqual(n1.pieces[0].groupId, n1.pieces[1].groupId, "all prior stacks must break");
  assert.equal(n1.pieces[0].groupId, n1.pieces[0].id);
  assert.equal(n1.pieces[1].groupId, n1.pieces[1].id);
  assert.deepEqual(n1.pieces[0].pathHistory, []);
  assert.equal(n1.pieces[2].status, "WAITING");
  assert.equal(n1.pieces[3].status, "FINISHED");

  assert.equal(n2.pieces[0].status, "ON_BOARD");
  assert.equal(n2.pieces[0].node, 7, "opponents may coexist after the reshuffle without capture");
  assert.equal(next.augmentRuntime?.p1?.wormholeTransit && Object.keys(next.augmentRuntime.p1.wormholeTransit).length, 0);
  assert.equal(next.augmentRuntime?.p1?.marginOriginByPiece && Object.keys(next.augmentRuntime.p1.marginOriginByPiece).length, 0);
  assert.ok(next.players.flatMap((player) => player.pieces).every((piece) => piece.status !== "WORMHOLE" && piece.status !== "MARGIN"));
  assert.equal(next.winnerUserId, null);
}

// 3) If the reshuffle itself completes normal wins, resolve immediately.
// In the extremely rare simultaneous case, the A08 owner wins the tie.
{
  const engine = fresh(2);
  const next = applyGreatUpheaval(engine, "p2", { p1: [], p2: ["A08"] }, () => 0.99);
  assert.ok(next.players.every((player) => player.pieces.every((piece) => piece.status === "FINISHED")));
  assert.equal(next.winnerUserId, "p2");
  assert.equal(next.winnerCondition, "NORMAL");
  assert.equal(next.stage, "FINISHED");
}

console.log("[batch10-probe] PASS: A08 Great Upheaval mechanics validated.");
