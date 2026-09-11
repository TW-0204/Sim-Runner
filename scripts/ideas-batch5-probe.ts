import assert from "node:assert/strict";
import { isGroupUsableWithAugments, isTurtleGroupLocked } from "@/lib/augments/effects";
import { applyMove, applyTurtleAndHarePlacement, createInitialEngine } from "@/lib/game/engine";

const seeds = [
  { userId: "p1", displayName: "P1", seat: 1 },
  { userId: "p2", displayName: "P2", seat: 2 },
];

// Placement: waiting piece goes to node 29 and is frozen for rounds 1 and 2, then unlocks on round 3.
{
  const initial = createInitialEngine(seeds);
  const placed = applyTurtleAndHarePlacement(initial, "p1", "1-1");
  const piece = placed.players[0].pieces.find((candidate) => candidate.id === "1-1");
  assert.equal(piece?.status, "ON_BOARD");
  assert.equal(piece?.node, 29);
  assert.equal(piece?.groupId, "1-1");
  assert.equal(placed.augmentRuntime?.p1?.turtleLockedUntilRoundByPiece?.["1-1"], 3);
  assert.equal(isTurtleGroupLocked(placed, "p1", "1-1"), true);
  assert.equal(isGroupUsableWithAugments(placed, "p1", "1-1", ["AUG-058"]), false);

  const round2 = structuredClone(placed);
  round2.round = 2;
  assert.equal(isTurtleGroupLocked(round2, "p1", "1-1"), true);

  const round3 = structuredClone(placed);
  round3.round = 3;
  assert.equal(isTurtleGroupLocked(round3, "p1", "1-1"), false);
  assert.equal(isGroupUsableWithAugments(round3, "p1", "1-1", ["AUG-058"]), true);
}

// A locked AUG-058 piece can still be captured, and capture immediately clears the remaining freeze.
{
  let engine = createInitialEngine(seeds);
  engine = applyTurtleAndHarePlacement(engine, "p1", "1-1");
  engine.currentSeat = 2;
  engine.stage = "MOVING";
  engine.pendingRolls = [];
  engine.results = [{ id: "move", face: "MOVE1", baseSteps: 1, finalSteps: 1, source: "AUGMENT" }];
  const attacker = engine.players[1].pieces[0];
  attacker.status = "ON_BOARD";
  attacker.node = 28;
  attacker.hasEntered = true;
  attacker.pathHistory = [28];

  const after = applyMove(engine, { groupId: attacker.groupId, resultId: "move", forwardPath: [29] }, [], {}, { p1: ["AUG-058"], p2: [] });
  const turtle = after.players[0].pieces.find((piece) => piece.id === "1-1");
  assert.equal(turtle?.status, "WAITING");
  assert.equal(turtle?.node, null);
  assert.equal(after.augmentRuntime?.p1?.turtleLockedUntilRoundByPiece?.["1-1"], undefined);
}

// While frozen, another friendly group may share node 29 but may not stack with the frozen piece.
{
  let engine = createInitialEngine(seeds);
  engine = applyTurtleAndHarePlacement(engine, "p1", "1-1");
  engine.currentSeat = 1;
  engine.stage = "MOVING";
  engine.pendingRolls = [];
  engine.results = [{ id: "move", face: "MOVE1", baseSteps: 1, finalSteps: 1, source: "AUGMENT" }];
  const mover = engine.players[0].pieces.find((piece) => piece.id === "1-2")!;
  mover.status = "ON_BOARD";
  mover.node = 28;
  mover.hasEntered = true;
  mover.pathHistory = [28];

  const after = applyMove(engine, { groupId: mover.groupId, resultId: "move", forwardPath: [29] }, ["AUG-058"], {}, { p1: ["AUG-058"], p2: [] });
  const turtle = after.players[0].pieces.find((piece) => piece.id === "1-1")!;
  const moved = after.players[0].pieces.find((piece) => piece.id === "1-2")!;
  assert.equal(turtle.node, 29);
  assert.equal(moved.node, 29);
  assert.notEqual(turtle.groupId, moved.groupId, "Frozen AUG-058 piece must not stack");
  assert.notEqual(after.stage, "STACK_CHOICE");
}

console.log("[batch5-probe] PASS: AUG-058 Turtle and Hare mechanics validated.");
