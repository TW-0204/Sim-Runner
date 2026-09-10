import type { GameEngineState, PendingSplitChoice } from "./types";

const JUNCTIONS = new Set([5, 10, 15, 22, 29]);

function changedPieceIds(before: GameEngineState, after: GameEngineState, userId: string) {
  const beforePlayer = before.players.find((player) => player.userId === userId);
  const afterPlayer = after.players.find((player) => player.userId === userId);
  if (!beforePlayer || !afterPlayer) return new Set<string>();
  const previous = new Map(beforePlayer.pieces.map((piece) => [piece.id, piece]));
  return new Set(afterPlayer.pieces.filter((piece) => {
    const old = previous.get(piece.id);
    if (!old) return true;
    return old.status !== piece.status
      || old.node !== piece.node
      || old.pathHistory.length !== piece.pathHistory.length;
  }).map((piece) => piece.id));
}

function candidateMovedGroup(before: GameEngineState, after: GameEngineState, userId: string) {
  if (before.stage !== "MOVING" || after.winnerUserId) return null;
  if (after.lastAction.includes("골목대장 자동 봉쇄") || after.lastAction.includes("성역 통과 차단")) return null;

  const changed = changedPieceIds(before, after, userId);
  if (!changed.size) return null;
  const player = after.players.find((candidate) => candidate.userId === userId);
  if (!player) return null;

  const groups = new Map<string, typeof player.pieces>();
  for (const piece of player.pieces) {
    if (piece.status !== "ON_BOARD" || piece.node == null || !JUNCTIONS.has(piece.node)) continue;
    const list = groups.get(piece.groupId) ?? [];
    list.push(piece);
    groups.set(piece.groupId, list);
  }

  for (const [groupId, pieces] of groups) {
    if (pieces.length < 2) continue;
    if (!pieces.some((piece) => changed.has(piece.id))) continue;
    const destination = pieces[0]?.node;
    if (destination == null) continue;
    return { groupId, destination, pieceIds: pieces.map((piece) => piece.id) };
  }
  return null;
}

export function maybePauseSelfRelianceAfterMovement(
  before: GameEngineState,
  after: GameEngineState,
  actorUserId: string,
  ownedIds: string[],
) {
  if (!ownedIds.includes("G14") || after.stage === "SPLIT_CHOICE") return after;
  const actor = before.players.find((player) => player.userId === actorUserId);
  const moved = candidateMovedGroup(before, after, actorUserId);
  if (!actor || !moved) return after;

  const pending: PendingSplitChoice = {
    movingGroupId: moved.groupId,
    destination: moved.destination,
    pieceIds: moved.pieceIds,
    resumeStage: after.stage,
    resumeCurrentSeat: after.currentSeat,
    resumeRound: after.round,
    resumeTurnNumber: after.turnNumber,
    resumePendingRolls: structuredClone(after.pendingRolls),
    resumeResults: structuredClone(after.results),
    resumePendingRollChoice: structuredClone(after.pendingRollChoice ?? null),
    resumePendingRelocationChoice: structuredClone(after.pendingRelocationChoice ?? null),
    resumePendingStackChoice: structuredClone(after.pendingStackChoice ?? null),
    resumeLastAction: after.lastAction,
  };

  after.pendingSplitChoice = pending;
  after.stage = "SPLIT_CHOICE";
  after.currentSeat = actor.seat;
  after.round = before.round;
  after.turnNumber = before.turnNumber;
  after.pendingRollChoice = null;
  after.pendingRelocationChoice = null;
  after.pendingStackChoice = null;
  after.lastAction = `${actor.displayName}: 각자도생 · ${moved.destination}번 갈림길에서 묶음을 나눌 수 있습니다.`;
  return after;
}

function normalizePartition(partition: string[][], expected: string[]) {
  if (partition.length < 2) throw new Error("둘 이상의 묶음으로 나눠야 합니다.");
  if (partition.some((group) => group.length === 0)) throw new Error("빈 묶음은 만들 수 없습니다.");
  const flat = partition.flat();
  if (flat.length !== expected.length || new Set(flat).size !== expected.length) {
    throw new Error("분리할 말 구성이 올바르지 않습니다.");
  }
  const expectedSet = new Set(expected);
  if (flat.some((id) => !expectedSet.has(id))) throw new Error("분리할 수 없는 말이 포함되어 있습니다.");
  return partition.map((group) => [...group]);
}

function propagateGroupRuntime(engine: GameEngineState, userId: string, originalGroupId: string, childGroupIds: string[]) {
  const runtime = engine.augmentRuntime?.[userId];
  if (!runtime) return;

  const fixed = Boolean(runtime.fixedOneGroups?.[originalGroupId]);
  const boost = Boolean(runtime.junctionBoostGroups?.[originalGroupId]);
  if (runtime.fixedOneGroups) delete runtime.fixedOneGroups[originalGroupId];
  if (runtime.junctionBoostGroups) delete runtime.junctionBoostGroups[originalGroupId];
  if (fixed) {
    runtime.fixedOneGroups ??= {};
    for (const groupId of childGroupIds) runtime.fixedOneGroups[groupId] = true;
  }
  if (boost) {
    runtime.junctionBoostGroups ??= {};
    for (const groupId of childGroupIds) runtime.junctionBoostGroups[groupId] = true;
  }
}

function restoreContinuation(engine: GameEngineState, pending: PendingSplitChoice, message: string) {
  engine.stage = pending.resumeStage;
  engine.currentSeat = pending.resumeCurrentSeat;
  engine.round = pending.resumeRound;
  engine.turnNumber = pending.resumeTurnNumber;
  engine.pendingRolls = structuredClone(pending.resumePendingRolls);
  engine.results = structuredClone(pending.resumeResults);
  engine.pendingRollChoice = structuredClone(pending.resumePendingRollChoice);
  engine.pendingRelocationChoice = structuredClone(pending.resumePendingRelocationChoice);
  engine.pendingStackChoice = structuredClone(pending.resumePendingStackChoice);
  engine.pendingSplitChoice = null;
  engine.lastAction = message;
}

export function applySelfRelianceSplit(
  engineInput: GameEngineState,
  userId: string,
  partition: string[][] | null,
  ownedIds: string[],
) {
  if (!ownedIds.includes("G14")) throw new Error("각자도생 증강을 보유하고 있지 않습니다.");
  if (engineInput.stage !== "SPLIT_CHOICE" || !engineInput.pendingSplitChoice) {
    throw new Error("지금은 묶음을 나눌 수 없습니다.");
  }
  const engine = structuredClone(engineInput);
  const pending = engine.pendingSplitChoice;
  if (!pending) throw new Error("분리 상태를 찾지 못했습니다.");
  const player = engine.players.find((candidate) => candidate.userId === userId && candidate.seat === engine.currentSeat);
  if (!player) throw new Error("현재 플레이어의 분리 선택이 아닙니다.");

  if (partition == null) {
    restoreContinuation(engine, pending, `${player.displayName}: 각자도생 · 묶음을 유지합니다. · ${pending.resumeLastAction}`);
    return engine;
  }

  const normalized = normalizePartition(partition, pending.pieceIds);
  const pieces = player.pieces.filter((piece) => pending.pieceIds.includes(piece.id));
  if (pieces.length !== pending.pieceIds.length || pieces.some((piece) => piece.groupId !== pending.movingGroupId || piece.node !== pending.destination)) {
    throw new Error("분리할 묶음의 현재 상태가 변경되었습니다.");
  }

  let primaryIndex = normalized.findIndex((group) => group.includes(pending.movingGroupId));
  if (primaryIndex < 0) primaryIndex = 0;
  const childGroupIds = normalized.map((group, index) => index === primaryIndex ? pending.movingGroupId : group[0]);

  normalized.forEach((group, index) => {
    const nextGroupId = childGroupIds[index];
    for (const pieceId of group) {
      const piece = player.pieces.find((candidate) => candidate.id === pieceId);
      if (piece) piece.groupId = nextGroupId;
    }
  });
  propagateGroupRuntime(engine, userId, pending.movingGroupId, childGroupIds);

  restoreContinuation(
    engine,
    pending,
    `${player.displayName}: 각자도생 · ${normalized.map((group) => group.map((id) => `말 ${id.split("-")[1]}`).join("+")).join(" / ")}로 분리 · ${pending.resumeLastAction}`,
  );
  return engine;
}
