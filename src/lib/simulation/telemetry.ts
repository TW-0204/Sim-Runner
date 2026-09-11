import { forwardMoveOptions } from "@/lib/game/board";
import type { GameEngineState } from "@/lib/game/types";

export type G01TriggerBreakdown = {
  gaeExtraRolls: number;
  yutMoSuppressions: number;
};

export type G01TriggerBreakdownByUser = Record<string, G01TriggerBreakdown>;

export type FirstAugmentLeaderCheckpoint = {
  round: number;
  turnNumber: number;
  eligible: boolean;
  leaderUserIds: string[];
  scores: Record<string, number>;
  excludedSpecialAugmentIds: string[];
};

const STANDARD_ROUTE_STEPS = 21;
const SPECIAL_FIRST_AUGMENTS = new Set(["AUG-032", "AUG-033", "AUG-041", "AUG-042"]);

function resultIdsStillAvailable(engine: GameEngineState) {
  const ids = new Set(engine.results.map((result) => result.id));
  for (const result of engine.pendingCaptureChoice?.resumeResults ?? []) ids.add(result.id);
  for (const result of engine.pendingSplitChoice?.resumeResults ?? []) ids.add(result.id);
  return ids;
}

function newlyResolvedResults(before: GameEngineState, after: GameEngineState) {
  const previous = new Set(before.results.map((result) => result.id));
  const stillAvailable = resultIdsStillAvailable(before);
  return after.results.filter((result) => !previous.has(result.id) && !stillAvailable.has(result.id));
}

export function detectG01TriggerBreakdown(
  before: GameEngineState,
  after: GameEngineState,
  actorUserId: string,
  ownedByUser: Record<string, string[]>,
): G01TriggerBreakdown {
  const breakdown: G01TriggerBreakdown = { gaeExtraRolls: 0, yutMoSuppressions: 0 };
  if (!(ownedByUser[actorUserId] ?? []).includes("AUG-017")) return breakdown;

  for (const token of newlyResolvedResults(before, after)) {
    if (token.face === "GAE") breakdown.gaeExtraRolls += 1;
    else if (token.face === "YUT" || token.face === "MO") breakdown.yutMoSuppressions += 1;
  }
  return breakdown;
}

export function applyG01TriggerBreakdown(
  target: G01TriggerBreakdownByUser,
  userId: string,
  delta: G01TriggerBreakdown,
) {
  if (delta.gaeExtraRolls === 0 && delta.yutMoSuppressions === 0) return;
  target[userId] ??= { gaeExtraRolls: 0, yutMoSuppressions: 0 };
  target[userId].gaeExtraRolls += delta.gaeExtraRolls;
  target[userId].yutMoSuppressions += delta.yutMoSuppressions;
}

function shortestForwardDistanceToFinish(node: number) {
  for (let steps = 1; steps <= STANDARD_ROUTE_STEPS; steps += 1) {
    if (forwardMoveOptions(node, steps).some((move) => move.finished)) return steps;
  }
  return STANDARD_ROUTE_STEPS;
}

function playerRaceScore(engine: GameEngineState, userId: string) {
  const player = engine.players.find((candidate) => candidate.userId === userId);
  if (!player) return 0;
  return player.pieces.reduce((sum, piece) => {
    if (piece.status === "FINISHED") return sum + STANDARD_ROUTE_STEPS;
    if (piece.status !== "ON_BOARD" || piece.node == null) return sum;
    return sum + Math.max(0, STANDARD_ROUTE_STEPS - shortestForwardDistanceToFinish(piece.node));
  }, 0);
}

export function buildFirstAugmentLeaderCheckpoint(
  engine: GameEngineState,
  acquisitions: Array<{ acquisitionIndex: number; augmentId: string }>,
): FirstAugmentLeaderCheckpoint {
  const firstAugmentIds = acquisitions
    .filter((item) => item.acquisitionIndex === 1)
    .map((item) => item.augmentId);
  const excludedSpecialAugmentIds = [...new Set(firstAugmentIds.filter((id) => SPECIAL_FIRST_AUGMENTS.has(id)))];
  const scores = Object.fromEntries(engine.players.map((player) => [
    player.userId,
    playerRaceScore(engine, player.userId),
  ]));
  const maxScore = Math.max(...Object.values(scores));
  const leaderUserIds = engine.players
    .filter((player) => scores[player.userId] === maxScore)
    .map((player) => player.userId);

  return {
    round: engine.round,
    turnNumber: engine.turnNumber,
    eligible: excludedSpecialAugmentIds.length === 0,
    leaderUserIds: excludedSpecialAugmentIds.length === 0 ? leaderUserIds : [],
    scores,
    excludedSpecialAugmentIds,
  };
}
