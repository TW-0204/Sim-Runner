import assert from "node:assert/strict";
import { AUGMENT_BY_ID } from "@/lib/augments/catalog";
import {
  applyWormholeTurn,
  armWormholeOnAcquisition,
  createInitialEngine,
  expireWormholeForCurrentRound,
  groupRepresentatives,
  resolveDueWormholeReturns,
  wormholeIsOpen,
} from "@/lib/game/engine";

const seeds = [
  { userId: "p1", displayName: "P1", seat: 1 },
  { userId: "p2", displayName: "P2", seat: 2 },
];

assert.equal(AUGMENT_BY_ID.get("A13")?.tier, "prism");

// Acquisition opens A13 immediately. Sending a stacked group replaces BASIC and hides the whole group.
{
  const engine = createInitialEngine(seeds);
  const p1 = engine.players[0];
  const first = p1.pieces[0];
  const second = p1.pieces[1];
  first.status = "ON_BOARD";
  first.node = 1;
  first.hasEntered = true;
  first.pathHistory = [1];
  second.status = "ON_BOARD";
  second.node = 1;
  second.groupId = first.groupId;
  second.hasEntered = true;
  second.pathHistory = [1];

  armWormholeOnAcquisition(engine, "p1");
  assert.equal(wormholeIsOpen(engine, "p1", ["A13"]), true);

  const sent = applyWormholeTurn(engine, "p1", first.groupId, ["A13"]);
  const sentGroup = sent.players[0].pieces.filter((piece) => piece.id === first.id || piece.id === second.id);
  assert.ok(sentGroup.every((piece) => piece.status === "WORMHOLE" && piece.node == null));
  assert.equal(sent.augmentRuntime?.p1?.wormholeNextOpenRound, 3);
  assert.equal(sent.augmentRuntime?.p1?.wormholeTransit?.[first.groupId]?.returnRound, 2);
  assert.equal(groupRepresentatives(sent, "p1").some((piece) => piece.groupId === first.groupId), false);

  // One round later, random=0 picks the nearest valid candidate (3 cells ahead => node 4).
  sent.round = 2;
  sent.currentSeat = 1;
  sent.stage = "AWAITING_ROLL";
  sent.pendingRolls = ["BASIC"];
  const opponent = sent.players[1].pieces[0];
  opponent.status = "ON_BOARD";
  opponent.node = 4;
  opponent.hasEntered = true;
  opponent.pathHistory = [1, 2, 3, 4];

  const returned = resolveDueWormholeReturns(sent, "p1", ["A13"], () => 0);
  const returnedGroup = returned.players[0].pieces.filter((piece) => piece.id === first.id || piece.id === second.id);
  assert.ok(returnedGroup.every((piece) => piece.status === "ON_BOARD" && piece.node === 4));
  assert.equal(opponent.id, returned.players[1].pieces[0].id);
  assert.equal(returned.players[1].pieces[0].status, "ON_BOARD", "wormhole return must not capture");
  assert.equal(returned.players[1].pieces[0].node, 4, "wormhole return must coexist without capture");
  assert.equal(returned.augmentRuntime?.p1?.wormholeTransit?.[first.groupId], undefined);
  assert.equal(wormholeIsOpen(returned, "p1", ["A13"]), false);

  returned.round = 3;
  assert.equal(wormholeIsOpen(returned, "p1", ["A13"]), true);
}

// If an opening is not used in its round, it expires and the next opening is two rounds later.
{
  const engine = createInitialEngine(seeds);
  armWormholeOnAcquisition(engine, "p1");
  const expired = expireWormholeForCurrentRound(engine, "p1", ["A13"]);
  assert.equal(expired.augmentRuntime?.p1?.wormholeNextOpenRound, 3);
  assert.equal(wormholeIsOpen(expired, "p1", ["A13"]), false);
  expired.round = 3;
  assert.equal(wormholeIsOpen(expired, "p1", ["A13"]), true);
}

// Finish is a legal random return candidate when the 3-18 range reaches the finish.
{
  const engine = createInitialEngine(seeds);
  const piece = engine.players[0].pieces[0];
  piece.status = "ON_BOARD";
  piece.node = 28;
  piece.hasEntered = true;
  piece.pathHistory = [25, 26, 27, 28];
  armWormholeOnAcquisition(engine, "p1");
  const sent = applyWormholeTurn(engine, "p1", piece.groupId, ["A13"]);
  sent.round = 2;
  sent.currentSeat = 1;
  sent.stage = "AWAITING_ROLL";
  sent.pendingRolls = ["BASIC"];
  const returned = resolveDueWormholeReturns(sent, "p1", ["A13"], () => 0.999999);
  assert.equal(returned.players[0].pieces.find((candidate) => candidate.id === piece.id)?.status, "FINISHED");
}

// With Moonwalk, "forward" follows the owner's reversed progress direction and may return home.
{
  const engine = createInitialEngine(seeds);
  const piece = engine.players[0].pieces[0];
  piece.status = "ON_BOARD";
  piece.node = 2;
  piece.hasEntered = true;
  piece.pathHistory = [1, 2];
  armWormholeOnAcquisition(engine, "p1");
  const sent = applyWormholeTurn(engine, "p1", piece.groupId, ["A13", "P02"]);
  sent.round = 2;
  sent.currentSeat = 1;
  sent.stage = "AWAITING_ROLL";
  sent.pendingRolls = ["BASIC"];
  const returned = resolveDueWormholeReturns(sent, "p1", ["A13", "P02"], () => 0);
  const homePiece = returned.players[0].pieces.find((candidate) => candidate.id === piece.id);
  assert.equal(homePiece?.status, "WAITING");
  assert.equal(homePiece?.node, null);
  assert.equal(homePiece?.groupId, homePiece?.id);
}

console.log("[batch4-probe] PASS: A13 wormhole mechanics validated.");
