import assert from "node:assert/strict";
import { AUGMENT_BY_ID } from "../src/lib/augments/catalog";
import {
  applyGachaMachine,
  armGachaMachineOnAcquisition,
  createInitialEngine,
  gachaMachineIsReady,
} from "../src/lib/game/engine";

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

// 1) A02 is Prism and available in either augment timing slot.
{
  const augment = AUGMENT_BY_ID.get("A02");
  assert.equal(augment?.tier, "prism");
  assert.equal(augment?.timing, undefined);
}

// 2) First use becomes available two rounds after acquisition, then each use starts a new two-round cooldown.
{
  const engine = fresh(2);
  armGachaMachineOnAcquisition(engine, "p1");
  assert.equal(engine.augmentRuntime?.p1?.gachaNextUseRound, 3);
  assert.equal(gachaMachineIsReady(engine, "p1", ["A02"]), false);
  engine.round = 3;
  assert.equal(gachaMachineIsReady(engine, "p1", ["A02"]), true);

  const p1 = engine.players[0];
  p1.pieces[0].status = "ON_BOARD";
  p1.pieces[0].node = 5;
  p1.pieces[0].hasEntered = true;
  const result = applyGachaMachine(engine, "p1", "p1", p1.pieces[0].id, 29, { p1: ["A02"], p2: [] }, () => 0.1);
  assert.equal(result.success, true);
  assert.equal(result.landedNode, 29);
  assert.equal(result.engine.augmentRuntime?.p1?.gachaNextUseRound, 5);
  assert.equal(gachaMachineIsReady(result.engine, "p1", ["A02"]), false);
  result.engine.round = 5;
  assert.equal(gachaMachineIsReady(result.engine, "p1", ["A02"]), true);
}

// 3) 40% succeeds exactly. The 60% failure branch cannot accidentally land on the requested node.
{
  const engine = fresh(2);
  engine.round = 3;
  engine.augmentRuntime = { p1: { gachaNextUseRound: 3 } };
  const piece = engine.players[0].pieces[0];
  piece.status = "ON_BOARD";
  piece.node = 10;
  piece.hasEntered = true;

  const success = applyGachaMachine(engine, "p1", "p1", piece.id, 29, { p1: ["A02"], p2: [] }, () => 0.399999);
  assert.equal(success.success, true);
  assert.equal(success.landedNode, 29);

  const failure = applyGachaMachine(
    engine,
    "p1",
    "p1",
    piece.id,
    29,
    { p1: ["A02"], p2: [] },
    sequenceRandom([0.4, 0]),
  );
  assert.equal(failure.success, false);
  assert.equal(failure.landedNode, 1);
  assert.notEqual(failure.landedNode, 29);
}

// 4) An opponent physical piece can be pulled out of a stack. Landing on an occupied node causes
// neither capture nor automatic stacking at the forced-relocation instant.
{
  const engine = fresh(2);
  engine.round = 3;
  engine.augmentRuntime = { p1: { gachaNextUseRound: 3 } };
  const [p1, p2] = engine.players;

  p1.pieces[0].status = "ON_BOARD";
  p1.pieces[0].node = 29;
  p1.pieces[0].hasEntered = true;

  p2.pieces[0].status = "ON_BOARD";
  p2.pieces[0].node = 10;
  p2.pieces[0].hasEntered = true;
  p2.pieces[1].status = "ON_BOARD";
  p2.pieces[1].node = 10;
  p2.pieces[1].hasEntered = true;
  p2.pieces[1].groupId = p2.pieces[0].groupId;
  const oldGroup = p2.pieces[0].groupId;
  engine.augmentRuntime.p2 = { fixedOneGroups: { [oldGroup]: true } };

  const result = applyGachaMachine(engine, "p1", "p2", p2.pieces[0].id, 29, { p1: ["A02"], p2: [] }, () => 0.1);
  const n1 = result.engine.players[0];
  const n2 = result.engine.players[1];

  assert.equal(n2.pieces[0].node, 29);
  assert.equal(n2.pieces[0].groupId, n2.pieces[0].id);
  assert.equal(n2.pieces[1].node, 10);
  assert.notEqual(n2.pieces[1].groupId, n2.pieces[0].groupId);
  assert.equal(n1.pieces[0].status, "ON_BOARD", "occupied destination must not capture the existing opponent");
  assert.equal(n1.pieces[0].node, 29);
  assert.notEqual(n1.pieces[0].groupId, n2.pieces[0].groupId, "forced landing must not auto-stack across owners");
  assert.equal(result.engine.augmentRuntime?.p2?.fixedOneGroups?.[n2.pieces[1].groupId], true, "remaining stack keeps group runtime state");
}

// 5) Waiting and finished pieces are not valid targets.
{
  const engine = fresh(2);
  engine.round = 3;
  engine.augmentRuntime = { p1: { gachaNextUseRound: 3 } };
  assert.throws(() => applyGachaMachine(engine, "p1", "p2", engine.players[1].pieces[0].id, 10, { p1: ["A02"], p2: [] }, () => 0.1));
  engine.players[1].pieces[0].status = "FINISHED";
  assert.throws(() => applyGachaMachine(engine, "p1", "p2", engine.players[1].pieces[0].id, 10, { p1: ["A02"], p2: [] }, () => 0.1));
}

console.log("[batch11-probe] PASS: A02 Gacha Machine mechanics validated.");
