import { AUGMENT_BY_ID } from "@/lib/augments/catalog";
import { createInitialEngine, legalMoveTargetsWithAugments } from "@/lib/game/engine";
import type { GameEngineState, PieceState, RollToken } from "@/lib/game/types";
import { getBalanceRuleset } from "@/lib/simulation/rulesets";
import { simulateGame } from "@/lib/simulation/game";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function token(face: RollToken["face"], steps: number): RollToken {
  return { id: `probe:${face}:${steps}`, face, baseSteps: steps, finalSteps: steps, source: "BASIC" };
}

function engineWithA16State(finishedCount: number, boardNode: number) {
  const engine = createInitialEngine([
    { userId: "p1", displayName: "P1", seat: 1 },
    { userId: "p2", displayName: "P2", seat: 2 },
  ]);
  const player = engine.players[0];
  assert(player, "probe player missing");
  player.pieces.forEach((piece, index) => {
    piece.groupId = piece.id;
    piece.pathHistory = [];
    piece.hasEntered = index <= finishedCount;
    if (index < finishedCount) {
      piece.status = "FINISHED";
      piece.node = null;
    } else if (index === finishedCount) {
      piece.status = "ON_BOARD";
      piece.node = boardNode;
    } else {
      piece.status = "WAITING";
      piece.node = null;
    }
  });
  engine.stage = "MOVING";
  engine.pendingRolls = [];
  return { engine, piece: player.pieces[finishedCount] as PieceState };
}

// 3 pieces finished -> shortened finish line is node 5.
// A piece already standing on node 5 must be able to finish on its next forward result.
{
  const { engine, piece } = engineWithA16State(3, 5);
  const targets = legalMoveTargetsWithAugments(engine, "p1", piece, token("DO", 1), ["A16"]);
  assert(targets.some((target) => target.finished && target.node == null), "A16 node-5 boundary could not finish");
}

// 2 pieces finished -> shortened finish line is node 10.
// From node 5 the normal board logic prefers the shortcut, but A16 must fall back to the outer 5->6->7->8 route.
{
  const { engine, piece } = engineWithA16State(2, 5);
  const targets = legalMoveTargetsWithAugments(engine, "p1", piece, token("GEOL", 3), ["A16"]);
  assert(targets.some((target) => target.node === 8 && target.path?.join(",") === "6,7,8"), "A16 outer-route fallback from node 5 failed");
}

// 1 piece finished -> finish line is node 22. The still-valid shortcut from 5 must remain available.
{
  const { engine, piece } = engineWithA16State(1, 5);
  const targets = legalMoveTargetsWithAugments(engine, "p1", piece, token("GEOL", 3), ["A16"]);
  assert(targets.some((target) => target.node === 15 && target.path?.join(",") === "13,14,15"), "A16 removed a shortcut that is still inside the remaining board");
}

const g01 = AUGMENT_BY_ID.get("G01");
const p11 = AUGMENT_BY_ID.get("P11");
assert(g01?.conflicts?.includes("P11"), "G01 must conflict with P11");
assert(p11?.conflicts?.includes("G01"), "P11 must conflict with G01");

// Re-run the exact seeds that exposed the two bugs. They must no longer STALL.
const ruleset = getBalanceRuleset("two-aug-start-r4-special-slots-v2");
const regressions = [
  { playerCount: 2, seed: "823002", label: "A16 boundary" },
  { playerCount: 2, seed: "801756", label: "A16 outer fallback" },
  { playerCount: 3, seed: "900238", label: "A16 stacked outer fallback" },
  { playerCount: 2, seed: "800912", label: "G01/P11 conflict" },
] as const;

for (const test of regressions) {
  const result = simulateGame({ seed: test.seed, ruleset, playerCount: test.playerCount, maxActions: 20_000 });
  assert(result.status !== "STALLED", `${test.label} seed ${test.seed} still stalled: ${result.error ?? "unknown"}`);
  console.log(`[regression] ${test.label} seed=${test.seed} status=${result.status} round=${result.round}`);
}

console.log("stall-fixes-v4 probe PASS");
