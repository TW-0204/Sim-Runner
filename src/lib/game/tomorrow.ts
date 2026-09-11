import type { GameEngineState, RollToken } from "./types";

function runtimeFor(engine: GameEngineState, userId: string) {
  engine.augmentRuntime ??= {};
  const runtime = engine.augmentRuntime[userId] ?? {};
  engine.augmentRuntime[userId] = runtime;
  return runtime;
}

function advanceTurn(engine: GameEngineState) {
  const seats = engine.players.map((player) => player.seat).sort((a, b) => a - b);
  const index = seats.indexOf(engine.currentSeat);
  const nextIndex = (index + 1) % seats.length;
  if (nextIndex === 0) engine.round += 1;
  engine.turnNumber += 1;
  engine.currentSeat = seats[nextIndex];
  engine.stage = "AWAITING_ROLL";
  engine.pendingRolls = ["BASIC"];
  engine.results = [];
  engine.pendingRollChoice = null;
  engine.pendingSplitChoice = null;
  engine.pendingCaptureChoice = null;
  engine.pendingRelocationChoice = null;
  engine.pendingStackChoice = null;
  const nextPlayer = engine.players.find((player) => player.seat === engine.currentSeat);
  engine.lastAction = `${nextPlayer?.displayName ?? "플레이어"}의 턴입니다.`;
}

export function injectTomorrowResult(
  engineInput: GameEngineState,
  userId: string,
  ownedIds: string[],
): GameEngineState {
  if (!ownedIds.includes("AUG-028")) return engineInput;
  const stored = engineInput.augmentRuntime?.[userId]?.tomorrowStoredResult;
  const savedAt = engineInput.augmentRuntime?.[userId]?.tomorrowSavedAtTurnNumber;
  if (!stored || savedAt == null || engineInput.turnNumber <= savedAt) return engineInput;

  const engine = structuredClone(engineInput);
  const runtime = runtimeFor(engine, userId);
  const token: RollToken = {
    id: `tomorrow:${userId}:${engine.turnNumber}`,
    face: stored.face,
    baseSteps: stored.baseSteps,
    finalSteps: stored.finalSteps,
    source: "AUGMENT",
    forbidShortcuts: stored.forbidShortcuts,
    numericBatchId: stored.numericBatchId,
    numericAllocated: stored.numericAllocated,
    suppressMovementBonuses: stored.suppressMovementBonuses,
    forbiddenPieceIds: stored.forbiddenPieceIds ? [...stored.forbiddenPieceIds] : undefined,
  };
  engine.results.push(token);
  delete runtime.tomorrowStoredResult;
  delete runtime.tomorrowSavedAtTurnNumber;
  return engine;
}

export function saveResultForTomorrow(
  engineInput: GameEngineState,
  userId: string,
  resultId: string,
  ownedIds: string[],
): GameEngineState {
  if (!ownedIds.includes("AUG-028")) throw new Error("내일의 나에게 증강을 보유하고 있지 않습니다.");
  if (engineInput.stage !== "MOVING") throw new Error("이동 결과가 있을 때만 저장할 수 있습니다.");

  const engine = structuredClone(engineInput);
  const player = engine.players.find((candidate) => candidate.userId === userId && candidate.seat === engine.currentSeat);
  if (!player) throw new Error("현재 플레이어의 턴이 아닙니다.");
  const runtime = runtimeFor(engine, userId);
  if (runtime.tomorrowStoredResult) throw new Error("이미 다음 턴에 사용할 결과를 저장했습니다.");
  if (runtime.tomorrowSavedAtTurnNumber === engine.turnNumber) throw new Error("이번 턴에는 이미 결과를 저장했습니다.");

  const index = engine.results.findIndex((result) => result.id === resultId);
  if (index < 0) throw new Error("저장할 수 없는 이동 결과입니다.");
  const result = engine.results[index];
  if (result.id.startsWith("tomorrow:")) throw new Error("지난 턴에 저장한 결과는 이번 턴에 반드시 사용해야 합니다.");
  if (result.numericPool) throw new Error("숫자 풀 자체는 저장할 수 없습니다. 먼저 이동권으로 나눠주세요.");
  engine.results.splice(index, 1);
  runtime.tomorrowStoredResult = {
    face: result.face,
    baseSteps: result.baseSteps,
    finalSteps: result.finalSteps + (result.finalSteps > 0 ? 1 : result.finalSteps < 0 ? -1 : 0),
    forbidShortcuts: result.forbidShortcuts,
    numericBatchId: result.numericBatchId,
    numericAllocated: result.numericAllocated,
    suppressMovementBonuses: result.suppressMovementBonuses,
    forbiddenPieceIds: result.forbiddenPieceIds ? [...result.forbiddenPieceIds] : undefined,
  };
  runtime.tomorrowSavedAtTurnNumber = engine.turnNumber;
  engine.lastAction = `${player.displayName}: 내일의 나에게 · ${result.face} 결과를 다음 턴으로 저장`;

  if (engine.results.length === 0 && engine.pendingRolls.length === 0) advanceTurn(engine);
  return engine;
}
