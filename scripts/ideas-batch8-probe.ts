import assert from "node:assert/strict";
import { applyGravityExplosion, createInitialEngine } from "../src/lib/game/engine";

const INTERNAL = new Set([11, 12, 13, 14, 15, 16, 17, 23, 24]);

function fresh() {
  return createInitialEngine([
    { userId: "p1", displayName: "P1", seat: 1 },
    { userId: "p2", displayName: "P2", seat: 2 },
  ]);
}

// 1) Every on-board physical piece is independently moved to an internal node; stacks are broken; no capture occurs on placement.
{
  const engine = fresh();
  const p1 = engine.players[0];
  const p2 = engine.players[1];
  const [a, b, waiting, finished] = p1.pieces;
  a.status = "ON_BOARD"; a.node = 5; a.hasEntered = true;
  b.status = "ON_BOARD"; b.node = 5; b.hasEntered = true; b.groupId = a.groupId;
  waiting.status = "WAITING"; waiting.node = null;
  finished.status = "FINISHED"; finished.node = null; finished.hasEntered = true;
  const enemy = p2.pieces[0];
  enemy.status = "ON_BOARD"; enemy.node = 10; enemy.hasEntered = true;

  // Always pick the first internal node, intentionally making opponents coexist at node 11.
  const next = applyGravityExplosion(engine, "p1", { p1: ["AUG-045"], p2: [] }, () => 0);
  const na = next.players[0].pieces.find((piece) => piece.id === a.id)!;
  const nb = next.players[0].pieces.find((piece) => piece.id === b.id)!;
  const nw = next.players[0].pieces.find((piece) => piece.id === waiting.id)!;
  const nf = next.players[0].pieces.find((piece) => piece.id === finished.id)!;
  const ne = next.players[1].pieces.find((piece) => piece.id === enemy.id)!;
  assert.ok(INTERNAL.has(na.node!));
  assert.ok(INTERNAL.has(nb.node!));
  assert.ok(INTERNAL.has(ne.node!));
  assert.notEqual(na.groupId, nb.groupId, "gravity explosion must break stacks into physical pieces");
  assert.equal(na.node, 11);
  assert.equal(ne.node, 11);
  assert.equal(ne.status, "ON_BOARD", "teleport placement must not capture a coincident opponent");
  assert.equal(nw.status, "WAITING");
  assert.equal(nf.status, "FINISHED");
  assert.equal(next.augmentRuntime?.p1?.gravityExplosionResolved, true);
}

// 2) AUG-037 outer-route-only pieces are exempt from gravity explosion.
{
  const engine = fresh();
  const p1 = engine.players[0];
  const p2 = engine.players[1];
  const mover = p1.pieces[0];
  const exempt = p2.pieces[0];
  mover.status = "ON_BOARD"; mover.node = 4; mover.hasEntered = true;
  exempt.status = "ON_BOARD"; exempt.node = 22; exempt.hasEntered = true;
  const next = applyGravityExplosion(engine, "p1", { p1: ["AUG-045"], p2: ["AUG-037"] }, () => 0.5);
  assert.ok(INTERNAL.has(next.players[0].pieces[0].node!));
  assert.equal(next.players[1].pieces[0].node, 22);
}

console.log("[batch8-probe] PASS: AUG-045 Gravity Explosion mechanics validated.");
