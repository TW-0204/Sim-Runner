import type { GameEngineState } from "./types";

export function passiveMoonwalkWinner(
  engine: GameEngineState,
  ownedByUser: Record<string, string[]>,
) {
  if (engine.winnerUserId) return null;
  for (const player of engine.players) {
    if (!(ownedByUser[player.userId] ?? []).includes("P02")) continue;
    if (!player.pieces.every((piece) => piece.status === "WAITING")) continue;
    return player;
  }
  return null;
}

export function applyPassiveSpecialWinner(
  engineInput: GameEngineState,
  ownedByUser: Record<string, string[]>,
) {
  const winner = passiveMoonwalkWinner(engineInput, ownedByUser);
  if (!winner) return engineInput;

  const engine = structuredClone(engineInput);
  engine.winnerUserId = winner.userId;
  engine.winnerCondition = "MOONWALK";
  engine.stage = "FINISHED";
  engine.pendingRolls = [];
  engine.results = [];
  engine.pendingRollChoice = null;
  engine.pendingSplitChoice = null;
  engine.pendingCaptureChoice = null;
  engine.pendingRelocationChoice = null;
  engine.pendingStackChoice = null;
  engine.lastAction = `${winner.displayName}: 문워크 · 모든 말을 대기로 되돌렸습니다!`;
  return engine;
}
