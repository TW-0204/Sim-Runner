import assert from "node:assert/strict";
import { createInitialEngine, discardUnusableResults } from "@/lib/game/engine";
import type { RollToken } from "@/lib/game/types";

function backdoToken(): RollToken {
  return {
    id: "tomorrow:sim-p1:2",
    face: "BACKDO",
    baseSteps: -1,
    finalSteps: -2,
    source: "AUGMENT",
  };
}

function doToken(): RollToken {
  return {
    id: "probe:do",
    face: "DO",
    baseSteps: 1,
    finalSteps: 1,
    source: "BASIC",
  };
}

const seeds = [
  { userId: "sim-p1", displayName: "P1", seat: 1 },
  { userId: "sim-p2", displayName: "P2", seat: 2 },
];

{
  const engine = createInitialEngine(seeds);
  engine.stage = "MOVING";
  engine.pendingRolls = [];
  engine.results = [backdoToken()];

  discardUnusableResults(engine, ["G13"]);
  assert.equal(engine.results.length, 0, "restored G13 BACKDO must expire when every piece is WAITING");
}

{
  const engine = createInitialEngine(seeds);
  const player = engine.players[0];
  const piece = player.pieces[0];
  piece.status = "ON_BOARD";
  piece.node = 5;
  piece.hasEntered = true;
  piece.pathHistory = [5];
  engine.stage = "MOVING";
  engine.pendingRolls = [];
  engine.results = [backdoToken()];

  discardUnusableResults(engine, ["G13"]);
  assert.equal(engine.results.length, 1, "BACKDO must remain when an on-board group can use it");
}

{
  const engine = createInitialEngine(seeds);
  engine.stage = "MOVING";
  engine.pendingRolls = [];
  engine.results = [backdoToken(), doToken()];

  discardUnusableResults(engine, ["G13"]);
  assert.equal(engine.results.length, 2, "cleanup must not discard BACKDO while another usable forward result exists");
}

console.log("stall fixes v9 probe PASS");
