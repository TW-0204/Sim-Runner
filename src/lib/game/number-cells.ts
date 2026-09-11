import { settleAfterResultPoolChange } from "./turn-settlement";
import type { GameEngineState, RollToken } from "./types";

function numericToken(id: string, steps: number, extra: Partial<RollToken> = {}): RollToken {
  return {
    id,
    face: "MOVE1",
    baseSteps: 1,
    finalSteps: steps,
    source: "AUGMENT",
    ...extra,
  };
}

export function splitNumberResult(
  engineInput: GameEngineState,
  userId: string,
  resultId: string,
  firstSteps: number,
  ownedIds: string[],
) {
  if (!ownedIds.includes("AUG-024") || ownedIds.includes("AUG-063")) {
    throw new Error("칸은 숫자에 불과하다 1을 사용할 수 없습니다.");
  }
  if (engineInput.stage !== "MOVING") throw new Error("이동 결과가 있을 때만 나눌 수 있습니다.");
  const engine = structuredClone(engineInput);
  const player = engine.players.find((candidate) => candidate.userId === userId && candidate.seat === engine.currentSeat);
  if (!player) throw new Error("현재 플레이어의 턴이 아닙니다.");
  const index = engine.results.findIndex((result) => result.id === resultId);
  if (index < 0) throw new Error("나눌 이동 결과를 찾지 못했습니다.");
  const result = engine.results[index];
  if (result.face === "BACKDO" || result.numericPool || result.numericAllocated || result.finalSteps < 2) {
    throw new Error("이 결과는 둘로 나눌 수 없습니다.");
  }
  if (!Number.isInteger(firstSteps) || firstSteps < 1 || firstSteps >= result.finalSteps) {
    throw new Error("나눌 이동량이 올바르지 않습니다.");
  }

  const secondSteps = result.finalSteps - firstSteps;
  const batchId = `numbers1:${crypto.randomUUID()}`;
  engine.results.splice(
    index,
    1,
    numericToken(`${batchId}:a`, firstSteps, { numericBatchId: batchId, numericAllocated: true }),
    numericToken(`${batchId}:b`, secondSteps, { numericBatchId: batchId, numericAllocated: true }),
  );
  engine.lastAction = `${player.displayName}: 칸은 숫자에 불과하다 1 · ${result.finalSteps}칸을 ${firstSteps}+${secondSteps}로 분할`;
  return engine;
}

function hasEligibleDistinctGroup(
  engine: GameEngineState,
  userId: string,
  forbiddenPieceIds: string[],
  moonwalk: boolean,
) {
  const player = engine.players.find((candidate) => candidate.userId === userId);
  if (!player) return false;
  const forbidden = new Set(forbiddenPieceIds);
  const groupIds = new Set(
    player.pieces
      .filter((piece) => moonwalk ? piece.status !== "WAITING" : piece.status !== "FINISHED")
      .map((piece) => piece.groupId),
  );

  for (const groupId of groupIds) {
    const movableMembers = player.pieces.filter((piece) => (
      piece.groupId === groupId
      && (moonwalk ? piece.status !== "WAITING" : piece.status !== "FINISHED")
    ));
    if (movableMembers.length > 0 && movableMembers.every((piece) => !forbidden.has(piece.id))) {
      return true;
    }
  }
  return false;
}

function discardUnusableSplitResults(engineInput: GameEngineState, userId: string, ownedIds: string[]) {
  if (!ownedIds.includes("AUG-024") || ownedIds.includes("AUG-063")) return engineInput;
  const constrained = engineInput.results.filter((result) => result.numericBatchId && result.forbiddenPieceIds?.length);
  if (!constrained.length) return engineInput;

  const engine = structuredClone(engineInput);
  const moonwalk = ownedIds.includes("AUG-031");
  const discardIds = new Set<string>();
  for (const result of constrained) {
    if (!result.forbiddenPieceIds?.length) continue;
    if (!hasEligibleDistinctGroup(engine, userId, result.forbiddenPieceIds, moonwalk)) {
      discardIds.add(result.id);
    }
  }

  if (!discardIds.size) return engineInput;
  engine.results = engine.results.filter((result) => !discardIds.has(result.id));
  engine.lastAction = `${engine.lastAction} · 칸은 숫자에 불과하다 1의 사용 불가능한 남은 이동권 소멸`;
  return settleAfterResultPoolChange(engine);
}

export function normalizeNumberPool(
  engineInput: GameEngineState,
  userId: string,
  ownedIds: string[],
) {
  const splitNormalized = discardUnusableSplitResults(engineInput, userId, ownedIds);
  if (!ownedIds.includes("AUG-063") || splitNormalized.stage !== "MOVING") return splitNormalized;
  const normalPositive = splitNormalized.results.filter((result) => (
    result.face !== "BACKDO"
    && result.finalSteps > 0
    && !result.numericAllocated
    && !result.numericPool
  ));
  if (!normalPositive.length) return splitNormalized;
  const existingPool = splitNormalized.results.find((result) => result.numericPool) ?? null;
  const candidates = existingPool ? [...normalPositive, existingPool] : normalPositive;

  const engine = structuredClone(splitNormalized);
  const candidateIds = new Set(candidates.map((result) => result.id));
  const total = candidates.reduce((sum, result) => sum + result.finalSteps, 0);
  const positions = engine.results
    .map((result, index) => candidateIds.has(result.id) ? index : Number.POSITIVE_INFINITY)
    .filter(Number.isFinite);
  const insertAt = positions.length ? Math.min(...positions) : engine.results.length;
  engine.results = engine.results.filter((result) => !candidateIds.has(result.id));
  engine.results.splice(insertAt, 0, numericToken(`numbers2:pool:${crypto.randomUUID()}`, total, { numericPool: true }));
  const player = engine.players.find((candidate) => candidate.userId === userId);
  if (player) engine.lastAction = `${player.displayName}: 칸은 숫자에 불과하다 2 · 양수 이동 거리 ${total}칸을 숫자 풀로 합쳤습니다.`;
  return engine;
}

export function allocateNumberPool(
  engineInput: GameEngineState,
  userId: string,
  steps: number,
  ownedIds: string[],
) {
  if (!ownedIds.includes("AUG-063")) throw new Error("칸은 숫자에 불과하다 2를 보유하고 있지 않습니다.");
  if (engineInput.stage !== "MOVING") throw new Error("지금은 숫자 이동권을 만들 수 없습니다.");
  if (!Number.isInteger(steps) || steps < 1) throw new Error("꺼낼 이동량이 올바르지 않습니다.");

  const engine = structuredClone(engineInput);
  const player = engine.players.find((candidate) => candidate.userId === userId && candidate.seat === engine.currentSeat);
  if (!player) throw new Error("현재 플레이어의 턴이 아닙니다.");
  const poolIndex = engine.results.findIndex((result) => result.numericPool);
  if (poolIndex < 0) throw new Error("사용할 숫자 풀이 없습니다.");
  const pool = engine.results[poolIndex];
  if (steps > pool.finalSteps) throw new Error("숫자 풀보다 큰 이동량은 꺼낼 수 없습니다.");

  const remaining = pool.finalSteps - steps;
  const token = numericToken(`numbers2:move:${crypto.randomUUID()}`, steps, {
    numericAllocated: true,
    suppressMovementBonuses: true,
  });
  if (remaining > 0) {
    engine.results.splice(poolIndex, 1, token, numericToken(`numbers2:pool:${crypto.randomUUID()}`, remaining, { numericPool: true }));
  } else {
    engine.results.splice(poolIndex, 1, token);
  }
  engine.lastAction = `${player.displayName}: 칸은 숫자에 불과하다 2 · 숫자 풀에서 ${steps}칸 이동권 생성${remaining > 0 ? ` · ${remaining}칸 남음` : ""}`;
  return engine;
}

export function assertNumericMoveAllowed(
  engine: GameEngineState,
  userId: string,
  groupId: string,
  resultId: string,
) {
  const result = engine.results.find((candidate) => candidate.id === resultId);
  if (!result) return;
  if (result.numericPool) throw new Error("숫자 풀은 먼저 이동량을 꺼낸 뒤 사용해야 합니다.");
  if (!result.forbiddenPieceIds?.length) return;
  const forbidden = new Set(result.forbiddenPieceIds);
  const player = engine.players.find((candidate) => candidate.userId === userId);
  const overlaps = player?.pieces.some((piece) => piece.groupId === groupId && piece.status !== "FINISHED" && forbidden.has(piece.id));
  if (overlaps) throw new Error("칸은 숫자에 불과하다 1의 두 이동은 서로 다른 말에 사용해야 합니다.");
}

export function markNumberSplitSibling(
  before: GameEngineState,
  after: GameEngineState,
  userId: string,
  groupId: string,
  resultId: string,
) {
  const used = before.results.find((result) => result.id === resultId);
  if (!used?.numericBatchId) return after;
  const player = before.players.find((candidate) => candidate.userId === userId);
  const movedPieceIds = player?.pieces
    .filter((piece) => piece.groupId === groupId && piece.status !== "FINISHED")
    .map((piece) => piece.id) ?? [];
  if (!movedPieceIds.length) return after;

  const sibling = after.results.find((result) => result.numericBatchId === used.numericBatchId);
  if (sibling) sibling.forbiddenPieceIds = [...movedPieceIds];

  const stored = after.augmentRuntime?.[userId]?.tomorrowStoredResult;
  if (stored?.numericBatchId === used.numericBatchId) {
    stored.forbiddenPieceIds = [...movedPieceIds];
  }
  return after;
}
