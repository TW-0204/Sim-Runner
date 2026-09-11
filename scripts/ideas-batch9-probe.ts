import assert from "node:assert/strict";
import { applyBombExplosion, createInitialEngine } from "../src/lib/game/engine";

function fresh(count: 2 | 3 | 4) {
  return createInitialEngine(Array.from({ length: count }, (_, index) => ({
    userId: `p${index + 1}`,
    displayName: `P${index + 1}`,
    seat: index + 1,
  })));
}

// 1) In 2p, opponent board groups are counted, stacks count once, and own groups never count.
{
  const engine = fresh(2);
  const p1 = engine.players[0];
  const p2 = engine.players[1];
  p1.pieces[0].status = "ON_BOARD"; p1.pieces[0].node = 3; p1.pieces[0].hasEntered = true;
  p2.pieces[0].status = "ON_BOARD"; p2.pieces[0].node = 5; p2.pieces[0].hasEntered = true;
  p2.pieces[1].status = "ON_BOARD"; p2.pieces[1].node = 5; p2.pieces[1].hasEntered = true; p2.pieces[1].groupId = p2.pieces[0].groupId;
  p2.pieces[2].status = "ON_BOARD"; p2.pieces[2].node = 10; p2.pieces[2].hasEntered = true;
  p2.pieces[3].status = "FINISHED"; p2.pieces[3].node = null; p2.pieces[3].hasEntered = true;
  engine.augmentRuntime = { p1: { enemyCaptureCount: 5 } };

  const result = applyBombExplosion(engine, ["p1"], { p1: ["AUG-050", "AUG-042"], p2: [] });
  assert.equal(result.caughtGroupsByUser.p1, 2);
  assert.equal(result.bonusRollsByUser.p1, 2);
  assert.equal(result.engine.augmentRuntime?.p1?.bombBonusRollsPending, 2);
  assert.equal(result.engine.augmentRuntime?.p1?.enemyCaptureCount, 5, "special bomb judgments must not trigger capture-chain counters");
  assert.ok(result.engine.players.flatMap((player) => player.pieces).filter((piece) => piece.status === "ON_BOARD").length === 0);
  assert.equal(result.engine.players[1].pieces[3].status, "FINISHED");
  assert.equal(result.engine.players[1].pieces[0].groupId, result.engine.players[1].pieces[0].id);
  assert.equal(result.engine.players[1].pieces[1].groupId, result.engine.players[1].pieces[1].id);
}

// 2) Off-board temporary states are not touched by the explosion.
{
  const engine = fresh(2);
  const p2 = engine.players[1];
  p2.pieces[0].status = "WORMHOLE"; p2.pieces[0].node = null; p2.pieces[0].hasEntered = true;
  p2.pieces[1].status = "MARGIN"; p2.pieces[1].node = null; p2.pieces[1].hasEntered = true;
  p2.pieces[2].status = "WAITING"; p2.pieces[2].node = null;
  const result = applyBombExplosion(engine, ["p1"], { p1: ["AUG-050"], p2: [] });
  assert.equal(result.caughtGroupsByUser.p1, 0);
  assert.equal(result.engine.players[1].pieces[0].status, "WORMHOLE");
  assert.equal(result.engine.players[1].pieces[1].status, "MARGIN");
  assert.equal(result.engine.players[1].pieces[2].status, "WAITING");
}

// 3) Multiple bomb owners use the same pre-explosion snapshot, so resolution order cannot steal catches.
{
  const engine = fresh(3);
  const [p1, p2, p3] = engine.players;
  p1.pieces[0].status = "ON_BOARD"; p1.pieces[0].node = 1; p1.pieces[0].hasEntered = true;
  p2.pieces[0].status = "ON_BOARD"; p2.pieces[0].node = 2; p2.pieces[0].hasEntered = true;
  p2.pieces[1].status = "ON_BOARD"; p2.pieces[1].node = 3; p2.pieces[1].hasEntered = true;
  p3.pieces[0].status = "ON_BOARD"; p3.pieces[0].node = 4; p3.pieces[0].hasEntered = true;
  const result = applyBombExplosion(engine, ["p1", "p2"], { p1: ["AUG-050"], p2: ["AUG-050"], p3: [] });
  assert.equal(result.caughtGroupsByUser.p1, 3);
  assert.equal(result.caughtGroupsByUser.p2, 2);
  assert.equal(result.bonusRollsByUser.p1, 1, "3p awards one roll per two caught groups");
  assert.equal(result.bonusRollsByUser.p2, 1);
  assert.equal(result.engine.augmentRuntime?.p1?.bombResolved, true);
  assert.equal(result.engine.augmentRuntime?.p2?.bombResolved, true);
}

// 4) 4p divisor is three groups per bonus roll.
{
  const engine = fresh(4);
  for (const player of engine.players.slice(1)) {
    player.pieces[0].status = "ON_BOARD";
    player.pieces[0].node = player.seat;
    player.pieces[0].hasEntered = true;
  }
  const result = applyBombExplosion(engine, ["p1"], { p1: ["AUG-050"], p2: [], p3: [], p4: [] });
  assert.equal(result.caughtGroupsByUser.p1, 3);
  assert.equal(result.bonusRollsByUser.p1, 1);
}

console.log("[batch9-probe] PASS: AUG-050 Bomb mechanics validated.");
