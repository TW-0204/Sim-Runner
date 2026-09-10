import assert from "node:assert/strict";
import { applyBetrayalTransfer } from "@/lib/augments/effects";
import { buildPhaseOffers } from "@/lib/augments/server";
import { applyMove, createInitialEngine, legalMoveTargetsWithAugments } from "@/lib/game/engine";
import type { RollToken } from "@/lib/game/types";

const seeds = [
  { userId: "p1", displayName: "P1", seat: 1 },
  { userId: "p2", displayName: "P2", seat: 2 },
  { userId: "p3", displayName: "P3", seat: 3 },
];

function token(id: string, face: RollToken["face"], steps: number, forbidShortcuts = false): RollToken {
  return { id, face, baseSteps: steps, finalSteps: steps, source: "BASIC", forbidShortcuts };
}

// A09: the first finisher stores actual branch decisions. The next departing piece is bound to them.
{
  let engine = createInitialEngine(seeds.slice(0, 2));
  const player = engine.players[0];
  const source = player.pieces[0];
  source.status = "ON_BOARD";
  source.node = 29;
  source.hasEntered = true;
  source.pathHistory = [1, 2, 3, 4, 5, 13, 14, 15, 16, 17, 22, 25, 26, 27, 28, 29];
  engine.stage = "MOVING";
  engine.pendingRolls = [];
  engine.results = [token("finish", "DO", 1)];
  engine = applyMove(engine, { groupId: source.groupId, resultId: "finish" }, ["A09"], {}, { p1: ["A09"], p2: [] });

  assert.equal(engine.augmentRuntime?.p1?.echoRouteCaptured, true);
  assert.equal(engine.augmentRuntime?.p1?.echoBranchChoices?.["5"], 13);
  assert.equal(engine.augmentRuntime?.p1?.echoBranchChoices?.["15"], 16);

  // Force P1 back to a movement state only for the probe and depart the next waiting piece.
  engine.currentSeat = 1;
  engine.stage = "MOVING";
  engine.pendingRolls = [];
  engine.results = [token("depart", "YUT", 4)];
  const followerBefore = engine.players[0].pieces.find((piece) => piece.status === "WAITING");
  assert.ok(followerBefore);
  engine = applyMove(engine, { groupId: followerBefore.groupId, resultId: "depart" }, ["A09"], {}, { p1: ["A09"], p2: [] });
  assert.equal(engine.augmentRuntime?.p1?.echoFollowerPieceId, followerBefore.id);

  engine.currentSeat = 1;
  engine.stage = "MOVING";
  engine.pendingRolls = [];
  const follower = engine.players[0].pieces.find((piece) => piece.id === followerBefore.id);
  assert.ok(follower);
  assert.equal(follower.node, 4);

  // With P09 there are normally two paths when a 2-step move passes node 5. Echo must keep 5 -> 13.
  const branchRoll = token("branch", "GAE", 2);
  engine.results = [branchRoll];
  const echoTargets = legalMoveTargetsWithAugments(engine, "p1", follower, branchRoll, ["A09", "P09"], { p1: ["A09", "P09"], p2: [] });
  assert.ok(echoTargets.length > 0);
  assert.ok(echoTargets.every((target) => target.path?.join(",") === "5,13"), `Unexpected echo paths: ${JSON.stringify(echoTargets)}`);

  // A stronger forced route takes priority if the stored branch is impossible.
  const forcedOuter = token("forced", "GAE", 2, true);
  const forcedTargets = legalMoveTargetsWithAugments(engine, "p1", follower, forcedOuter, ["A09", "P09", "P10"], { p1: ["A09", "P09", "P10"], p2: [] });
  assert.ok(forcedTargets.some((target) => target.path?.join(",") === "5,6"));
}

// A10: transfer one waiting piece to a random opponent, resetting it as the recipient's fresh piece.
{
  const engine = createInitialEngine(seeds);
  const source = engine.players[0];
  const transferredBefore = source.pieces[0];
  transferredBefore.hasEntered = true;
  transferredBefore.pathHistory = [1, 2, 3];
  engine.augmentRuntime ??= {};
  engine.augmentRuntime.p1 = {
    echoRouteCaptured: true,
    echoFollowerPieceId: transferredBefore.id,
    echoBranchChoices: { "5": 13 },
  };

  const betrayal = applyBetrayalTransfer(engine, "p1", () => 0);
  const after = betrayal.engine;
  assert.equal(betrayal.transferredPieceId, transferredBefore.id);
  assert.equal(betrayal.recipientUserId, "p2");
  assert.equal(after.players.find((player) => player.userId === "p1")?.pieces.length, 3);
  assert.equal(after.players.find((player) => player.userId === "p2")?.pieces.length, 5);
  assert.equal(after.players.find((player) => player.userId === "p3")?.pieces.length, 4);

  const received = after.players.find((player) => player.userId === "p2")?.pieces.find((piece) => piece.id === transferredBefore.id);
  assert.ok(received);
  assert.equal(received.ownerUserId, "p2");
  assert.equal(received.seat, 2);
  assert.equal(received.status, "WAITING");
  assert.equal(received.hasEntered, false);
  assert.deepEqual(received.pathHistory, []);
  assert.equal(after.augmentRuntime?.p1?.echoCompleted, true, "Transferring the Echo follower should terminate that owner's Echo binding");

  // The original owner's normal victory condition now uses the remaining three pieces.
  const remaining = after.players.find((player) => player.userId === "p1")?.pieces ?? [];
  assert.equal(remaining.length, 3);
  remaining[0].status = "FINISHED";
  remaining[0].node = null;
  remaining[1].status = "FINISHED";
  remaining[1].node = null;
  remaining[2].status = "ON_BOARD";
  remaining[2].node = 29;
  remaining[2].hasEntered = true;
  remaining[2].pathHistory = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 18, 19, 20, 21, 22, 25, 26, 27, 28, 29];
  after.currentSeat = 1;
  after.stage = "MOVING";
  after.pendingRolls = [];
  after.results = [token("win", "DO", 1)];
  const won = applyMove(after, { groupId: remaining[2].groupId, resultId: "win" }, ["A10"], {}, { p1: ["A10"], p2: [], p3: [] });
  assert.equal(won.winnerUserId, "p1");
}

// A10 offer eligibility can be excluded per player when that player has no waiting piece.
{
  const offers = buildPhaseOffers({
    seed: "batch3-a10-offer",
    phase: 3,
    tier: "gold",
    players: [{ userId: "p1", seat: 1 }, { userId: "p2", seat: 2 }],
    ownedByUser: { p1: [], p2: [] },
    excludedIdsByUser: { p1: ["A10"], p2: [] },
  });
  const p1 = offers.find((offer) => offer.userId === "p1");
  assert.ok(p1);
  assert.ok(!p1.offerIds.includes("A10"));
}

console.log("[batch3-probe] PASS: A09/A10 mechanics validated.");
