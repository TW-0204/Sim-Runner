import type { PlayerAugmentSetups } from "@/lib/augments/effects";
import type { GameEngineState, PieceState, RollToken } from "@/lib/game/types";

export type SimulationActionKind =
  | "augment_event"
  | "roll"
  | "choose_roll"
  | "reroll_do"
  | "move"
  | "wormhole"
  | "stack"
  | "relocate"
  | "grand_unity"
  | "save_result"
  | "split_number"
  | "allocate_number_pool"
  | "capture_choice"
  | "ally_capture"
  | "margin_exit"
  | "margin_return"
  | "split";

export type AugmentTriggerEvent = {
  userId: string;
  augmentId: string;
  count: number;
};

export type TriggerCountsByUser = Record<string, Record<string, number>>;

type DetectInput = {
  before: GameEngineState;
  after: GameEngineState;
  actorUserId: string;
  actionKind: SimulationActionKind;
  ownedByUser: Record<string, string[]>;
  setupsByUser?: Record<string, PlayerAugmentSetups>;
};

type BoardGroup = {
  userId: string;
  groupId: string;
  node: number;
  pieces: PieceState[];
};

type MoveSnapshot = {
  groupId: string;
  beforePiece: PieceState;
  afterPiece: PieceState;
  beforeGroup: PieceState[];
  newPath: number[];
  usedResult: RollToken | null;
};

const JUNCTION_NODES = new Set([5, 10, 15, 22, 29]);

function owned(input: DetectInput, userId: string, augmentId: string) {
  return (input.ownedByUser[userId] ?? []).includes(augmentId);
}

function player(engine: GameEngineState, userId: string) {
  return engine.players.find((candidate) => candidate.userId === userId) ?? null;
}

function runtime(engine: GameEngineState, userId: string) {
  return engine.augmentRuntime?.[userId];
}

function scheduledAugmentRolls(engine: GameEngineState) {
  return engine.pendingRolls.filter((item) => item === "AUGMENT").length
    + (engine.pendingRelocationChoice?.augmentExtraRolls ?? 0)
    + (engine.pendingStackChoice?.augmentExtraRolls ?? 0);
}

function resultIdsStillAvailable(engine: GameEngineState) {
  const ids = new Set(engine.results.map((result) => result.id));
  for (const result of engine.pendingCaptureChoice?.resumeResults ?? []) ids.add(result.id);
  for (const result of engine.pendingSplitChoice?.resumeResults ?? []) ids.add(result.id);
  return ids;
}

function newlyResolvedResults(before: GameEngineState, after: GameEngineState) {
  const previous = new Set(before.results.map((result) => result.id));
  return after.results.filter((result) => !previous.has(result.id));
}

function removedResult(before: GameEngineState, after: GameEngineState) {
  const remaining = resultIdsStillAvailable(after);
  return before.results.find((result) => !remaining.has(result.id)) ?? null;
}

function moveSnapshot(before: GameEngineState, after: GameEngineState, userId: string): MoveSnapshot | null {
  const beforePlayer = player(before, userId);
  const afterPlayer = player(after, userId);
  if (!beforePlayer || !afterPlayer) return null;
  const afterById = new Map(afterPlayer.pieces.map((piece) => [piece.id, piece]));

  const changed = beforePlayer.pieces
    .map((piece) => ({ before: piece, after: afterById.get(piece.id) }))
    .filter((entry): entry is { before: PieceState; after: PieceState } => Boolean(entry.after))
    .filter(({ before: previous, after: next }) => (
      next.pathHistory.length > previous.pathHistory.length
      || next.status !== previous.status
      || next.node !== previous.node
    ));

  const primary = changed.find(({ before: previous, after: next }) => next.pathHistory.length > previous.pathHistory.length)
    ?? changed[0];
  if (!primary) return null;

  const groupId = primary.before.groupId;
  const beforeGroup = beforePlayer.pieces.filter((piece) => piece.groupId === groupId);
  return {
    groupId,
    beforePiece: primary.before,
    afterPiece: primary.after,
    beforeGroup,
    newPath: primary.after.pathHistory.slice(primary.before.pathHistory.length),
    usedResult: removedResult(before, after),
  };
}

function boardGroups(engine: GameEngineState, userId?: string) {
  const groups = new Map<string, BoardGroup>();
  for (const owner of engine.players) {
    if (userId && owner.userId !== userId) continue;
    for (const piece of owner.pieces) {
      if (piece.status !== "ON_BOARD" || piece.node == null) continue;
      const key = `${owner.userId}:${piece.groupId}`;
      const entry = groups.get(key) ?? {
        userId: owner.userId,
        groupId: piece.groupId,
        node: piece.node,
        pieces: [],
      };
      entry.pieces.push(piece);
      groups.set(key, entry);
    }
  }
  return [...groups.values()];
}

function groupStillAt(after: GameEngineState, group: BoardGroup) {
  const owner = player(after, group.userId);
  if (!owner) return false;
  return group.pieces.some((piece) => {
    const next = owner.pieces.find((candidate) => candidate.id === piece.id);
    return next?.status === "ON_BOARD" && next.node === group.node;
  });
}

function groupFullyWaiting(after: GameEngineState, group: BoardGroup) {
  const owner = player(after, group.userId);
  if (!owner) return false;
  return group.pieces.every((piece) => {
    const next = owner.pieces.find((candidate) => candidate.id === piece.id);
    return next?.status === "WAITING" && next.node == null;
  });
}

function newInsuranceCaptureGroups(before: GameEngineState, after: GameEngineState) {
  const beforeKeys = new Set(
    (before.pendingCaptureChoice?.decisions ?? [])
      .filter((decision) => decision.kind === "INSURANCE")
      .map((decision) => `${decision.victimUserId}:${decision.victimGroupId}:${decision.node}`),
  );
  const result: BoardGroup[] = [];
  for (const decision of after.pendingCaptureChoice?.decisions ?? []) {
    if (decision.kind !== "INSURANCE") continue;
    const key = `${decision.victimUserId}:${decision.victimGroupId}:${decision.node}`;
    if (beforeKeys.has(key)) continue;
    const owner = player(before, decision.victimUserId);
    const pieces = owner?.pieces.filter((piece) => (
      piece.groupId === decision.victimGroupId
      && piece.status === "ON_BOARD"
      && piece.node === decision.node
    )) ?? [];
    if (pieces.length) result.push({
      userId: decision.victimUserId,
      groupId: decision.victimGroupId,
      node: decision.node,
      pieces,
    });
  }
  return result;
}

function capturedGroups(before: GameEngineState, after: GameEngineState, actorUserId: string) {
  const byKey = new Map<string, BoardGroup>();
  for (const group of boardGroups(before)) {
    if (group.userId === actorUserId) continue;
    if (groupFullyWaiting(after, group)) byKey.set(`${group.userId}:${group.groupId}:${group.node}`, group);
  }
  for (const group of newInsuranceCaptureGroups(before, after)) {
    if (group.userId === actorUserId) continue;
    byKey.set(`${group.userId}:${group.groupId}:${group.node}`, group);
  }
  return [...byKey.values()];
}

function isSoloJunctionGroup(engine: GameEngineState, userId: string, groupId: string) {
  const group = boardGroups(engine, userId).find((candidate) => candidate.groupId === groupId);
  if (!group || group.pieces.length !== 1 || !JUNCTION_NODES.has(group.node)) return false;
  return boardGroups(engine).filter((candidate) => candidate.node === group.node)
    .reduce((sum, candidate) => sum + candidate.pieces.length, 0) === 1;
}

function hasSoloJunctionHolder(engine: GameEngineState, userId: string) {
  return boardGroups(engine, userId).some((group) => isSoloJunctionGroup(engine, userId, group.groupId));
}

function captureAttemptNodes(input: DetectInput, move: MoveSnapshot) {
  const actorOwned = input.ownedByUser[input.actorUserId] ?? [];
  const cleanerActive = actorOwned.includes("AUG-034")
    && (runtime(input.before, input.actorUserId)?.cleanerMovesUsed ?? 0) < 3;
  if (cleanerActive) return [...new Set(move.newPath)];
  if (move.afterPiece.status === "ON_BOARD" && move.afterPiece.node != null) return [move.afterPiece.node];
  return [];
}

function addMapEvent(map: Map<string, AugmentTriggerEvent>, userId: string, augmentId: string, count = 1) {
  if (count <= 0) return;
  const key = `${userId}:${augmentId}`;
  const existing = map.get(key);
  if (existing) existing.count += count;
  else map.set(key, { userId, augmentId, count });
}

function runtimeNumberDelta(before: GameEngineState, after: GameEngineState, userId: string, key: "cleanerMovesUsed" | "soloLaps" | "enemyCaptureCount") {
  const previous = runtime(before, userId)?.[key] ?? 0;
  const next = runtime(after, userId)?.[key] ?? 0;
  return Math.max(0, next - previous);
}

function parseBlockedNode(message: string, label: string) {
  const match = message.match(new RegExp(`${label}\\((\\d+)번\\)`));
  return match ? Number(match[1]) : null;
}

function detectRollTriggers(input: DetectInput, events: Map<string, AugmentTriggerEvent>) {
  const ownedIds = input.ownedByUser[input.actorUserId] ?? [];

  if (input.actionKind === "roll" && input.after.lastAction.includes("낙!")) {
    for (const [ownerUserId, ids] of Object.entries(input.ownedByUser)) {
      if (ids.includes("AUG-016")) addMapEvent(events, ownerUserId, "AUG-016");
    }
  }

  if (input.actionKind === "roll" && input.after.pendingRollChoice?.kind === "DUAL") {
    if (input.after.pendingRollChoice.reason === "COUNTER" && ownedIds.includes("AUG-011")) {
      addMapEvent(events, input.actorUserId, "AUG-011");
    }
    if (input.after.pendingRollChoice.reason === "EITHER" && ownedIds.includes("AUG-039")) {
      addMapEvent(events, input.actorUserId, "AUG-039");
    }
  }

  if (input.actionKind === "reroll_do" && ownedIds.includes("AUG-012")) {
    addMapEvent(events, input.actorUserId, "AUG-012");
  }

  const beforeCharges = ownedIds.includes("AUG-044") ? (runtime(input.before, input.actorUserId)?.godHandCharges ?? 1) : 0;
  const afterCharges = ownedIds.includes("AUG-044") ? (runtime(input.after, input.actorUserId)?.godHandCharges ?? 1) : 0;
  if (beforeCharges > afterCharges) addMapEvent(events, input.actorUserId, "AUG-044", beforeCharges - afterCharges);

  for (const controlledId of ["AUG-018", "AUG-019", "AUG-020"] as const) {
    if (!ownedIds.includes(controlledId)) continue;
    const beforeUsed = runtime(input.before, input.actorUserId)?.controlledBasicRollsUsed ?? 0;
    const afterUsed = runtime(input.after, input.actorUserId)?.controlledBasicRollsUsed ?? 0;
    if (afterUsed > beforeUsed) addMapEvent(events, input.actorUserId, controlledId, afterUsed - beforeUsed);
  }

  if (
    ownedIds.includes("AUG-007")
    && runtime(input.before, input.actorUserId)?.revengeBasicPending
    && !runtime(input.after, input.actorUserId)?.revengeBasicPending
  ) {
    addMapEvent(events, input.actorUserId, "AUG-007");
  }

  const tokens = newlyResolvedResults(input.before, input.after);
  for (const token of tokens) {
    if (ownedIds.includes("AUG-017") && ["GAE", "YUT", "MO"].includes(token.face)) {
      addMapEvent(events, input.actorUserId, "AUG-017");
    }
    if (ownedIds.includes("AUG-003") && (token.face === "DO" || token.face === "BACKDO")) {
      addMapEvent(events, input.actorUserId, "AUG-003");
    }
    if (ownedIds.includes("AUG-009") && token.face === "GEOL") {
      addMapEvent(events, input.actorUserId, "AUG-009");
    }
    if (token.source === "CAPTURE" && token.face !== "BACKDO") {
      if (ownedIds.includes("AUG-060")) addMapEvent(events, input.actorUserId, "AUG-060");
      else if (ownedIds.includes("AUG-001")) addMapEvent(events, input.actorUserId, "AUG-001");
      if (ownedIds.includes("AUG-062")) addMapEvent(events, input.actorUserId, "AUG-062");
    }
    if (
      ownedIds.includes("AUG-013")
      && token.source === "BASIC"
      && token.face !== "BACKDO"
      && token.finalSteps > 0
      && input.before.round <= 9
      && runtime(input.before, input.actorUserId)?.vacancyInitialized
      && (runtime(input.before, input.actorUserId)?.vacancySkipsRemaining ?? 2) <= 0
    ) {
      addMapEvent(events, input.actorUserId, "AUG-013");
    }
  }
}

function detectMovementTriggers(input: DetectInput, events: Map<string, AugmentTriggerEvent>) {
  if (input.actionKind !== "move") return;
  const move = moveSnapshot(input.before, input.after, input.actorUserId);
  if (!move) return;
  const ownedIds = input.ownedByUser[input.actorUserId] ?? [];
  const result = move.usedResult;
  const positive = Boolean(result && result.face !== "BACKDO" && result.finalSteps > 0);
  const suppressBonuses = Boolean(result?.suppressMovementBonuses);

  if (ownedIds.includes("AUG-031")) addMapEvent(events, input.actorUserId, "AUG-031");

  if (positive && result) {
    if (!suppressBonuses) {
      if (ownedIds.includes("AUG-006") && move.beforePiece.status === "WAITING") {
        addMapEvent(events, input.actorUserId, "AUG-006");
      }
      const actorBefore = player(input.before, input.actorUserId);
      if (ownedIds.includes("AUG-008") && actorBefore?.pieces.filter((piece) => piece.status === "FINISHED").length === 3) {
        addMapEvent(events, input.actorUserId, "AUG-008");
      }
      if (ownedIds.includes("AUG-014") && runtime(input.before, input.actorUserId)?.junctionBoostGroups?.[move.groupId]) {
        addMapEvent(events, input.actorUserId, "AUG-014");
      }
      if (
        ownedIds.includes("AUG-022")
        && hasSoloJunctionHolder(input.before, input.actorUserId)
        && !isSoloJunctionGroup(input.before, input.actorUserId, move.groupId)
      ) {
        addMapEvent(events, input.actorUserId, "AUG-022");
      }
      if (move.beforeGroup.length >= 2) {
        if (ownedIds.includes("AUG-065")) addMapEvent(events, input.actorUserId, "AUG-065");
        else if (ownedIds.includes("AUG-023")) addMapEvent(events, input.actorUserId, "AUG-023");
      }
      const acePieceId = input.setupsByUser?.[input.actorUserId]?.["AUG-030"]?.pieceId;
      if (ownedIds.includes("AUG-030") && acePieceId && move.beforeGroup.some((piece) => piece.id === acePieceId)) {
        addMapEvent(events, input.actorUserId, "AUG-030");
      }
    }
    if (ownedIds.includes("AUG-037")) addMapEvent(events, input.actorUserId, "AUG-037");
  }

  if (ownedIds.includes("AUG-010") && result?.face === "BACKDO") {
    const rewardId = `${result.id}:backdo-bonus`;
    if (input.after.results.some((token) => token.id === rewardId) || input.after.lastAction.includes("1칸 이동권 획득")) {
      addMapEvent(events, input.actorUserId, "AUG-010");
    }
  }
  if (ownedIds.includes("AUG-025") && input.after.lastAction.includes("추격자 조기 정지")) {
    addMapEvent(events, input.actorUserId, "AUG-025");
  }
  if (ownedIds.includes("AUG-036") && input.after.lastAction.includes("길은 내가 만든다")) {
    addMapEvent(events, input.actorUserId, "AUG-036");
  }

  const cleanerDelta = runtimeNumberDelta(input.before, input.after, input.actorUserId, "cleanerMovesUsed");
  if (ownedIds.includes("AUG-034") && cleanerDelta > 0) addMapEvent(events, input.actorUserId, "AUG-034", cleanerDelta);

  const lapDelta = runtimeNumberDelta(input.before, input.after, input.actorUserId, "soloLaps");
  if (ownedIds.includes("AUG-041") && lapDelta > 0) addMapEvent(events, input.actorUserId, "AUG-041", lapDelta);

  if (
    ownedIds.includes("AUG-029")
    && positive
    && !suppressBonuses
    && runtime(input.before, input.actorUserId)?.athleteAcceleratingGroupId === move.groupId
    && (runtime(input.before, input.actorUserId)?.athleteConsecutiveMoves ?? 0) > 0
  ) {
    addMapEvent(events, input.actorUserId, "AUG-029");
  }

  const captured = capturedGroups(input.before, input.after, input.actorUserId);
  for (const group of captured) {
    const victimOwned = input.ownedByUser[group.userId] ?? [];
    if (victimOwned.includes("AUG-005") && group.pieces.length >= 2) addMapEvent(events, group.userId, "AUG-005");
    if (victimOwned.includes("AUG-027")) addMapEvent(events, group.userId, "AUG-027");
    if (victimOwned.includes("AUG-064")) addMapEvent(events, group.userId, "AUG-064");
  }

  {
    const attemptNodes = new Set(captureAttemptNodes(input, move));
    for (const group of boardGroups(input.before)) {
      if (group.userId === input.actorUserId || !attemptNodes.has(group.node)) continue;
      if (!groupStillAt(input.after, group)) continue;
      const victimOwned = input.ownedByUser[group.userId] ?? [];
      if (
        victimOwned.includes("AUG-004")
        && (runtime(input.before, group.userId)?.timesCaptured ?? 0) >= 5
      ) {
        addMapEvent(events, group.userId, "AUG-004");
      }
      if (
        victimOwned.includes("AUG-040")
        && runtime(input.before, group.userId)?.sanctuaryGroups?.[group.groupId] === group.node
      ) {
        addMapEvent(events, group.userId, "AUG-040");
      }
    }
  }

  const alleyNode = parseBlockedNode(input.after.lastAction, "골목대장 자동 봉쇄");
  if (alleyNode != null) {
    for (const [userId, ids] of Object.entries(input.ownedByUser)) {
      if (!ids.includes("AUG-021")) continue;
      const blocked = Object.entries(runtime(input.before, userId)?.alleyBlockades ?? {})
        .some(([, node]) => node === alleyNode);
      if (blocked) addMapEvent(events, userId, "AUG-021");
    }
  }

  const sanctuaryNode = parseBlockedNode(input.after.lastAction, "성역 통과 차단");
  if (sanctuaryNode != null) {
    for (const [userId, ids] of Object.entries(input.ownedByUser)) {
      if (!ids.includes("AUG-040")) continue;
      const blocked = Object.entries(runtime(input.before, userId)?.sanctuaryGroups ?? {})
        .some(([, node]) => node === sanctuaryNode);
      if (blocked) addMapEvent(events, userId, "AUG-040");
    }
  }
}

function detectDirectActionTriggers(input: DetectInput, events: Map<string, AugmentTriggerEvent>) {
  const ownedIds = input.ownedByUser[input.actorUserId] ?? [];

  if (input.actionKind === "save_result" && ownedIds.includes("AUG-028")) addMapEvent(events, input.actorUserId, "AUG-028");
  if (input.actionKind === "split_number" && ownedIds.includes("AUG-024")) addMapEvent(events, input.actorUserId, "AUG-024");
  if (input.actionKind === "allocate_number_pool" && ownedIds.includes("AUG-063")) addMapEvent(events, input.actorUserId, "AUG-063");
  if (input.actionKind === "grand_unity" && ownedIds.includes("AUG-038")) addMapEvent(events, input.actorUserId, "AUG-038");
  if (input.actionKind === "ally_capture" && ownedIds.includes("AUG-043")) addMapEvent(events, input.actorUserId, "AUG-043");

  if (input.actionKind === "relocate") {
    const kind = input.before.pendingRelocationChoice?.opportunities[0]?.kind;
    const used = !input.after.lastAction.includes("사용 안 함");
    if (used && kind === "FRIEND" && ownedIds.includes("AUG-015")) addMapEvent(events, input.actorUserId, "AUG-015");
    if (used && kind === "HITCHHIKER" && ownedIds.includes("AUG-066")) addMapEvent(events, input.actorUserId, "AUG-066");
  }

  if (["stack", "relocate", "grand_unity"].includes(input.actionKind) && ownedIds.includes("AUG-002")) {
    const extra = scheduledAugmentRolls(input.after) - scheduledAugmentRolls(input.before);
    if (extra > 0) addMapEvent(events, input.actorUserId, "AUG-002", extra);
  }

  if (input.actionKind === "capture_choice") {
    const decision = input.before.pendingCaptureChoice?.decisions[0];
    if (decision?.kind === "INSURANCE" && owned(input, decision.chooserUserId, "AUG-026")) {
      addMapEvent(events, decision.chooserUserId, "AUG-026");
    }
    if (
      decision?.kind === "DOUBLE_HIT"
      && owned(input, decision.chooserUserId, "AUG-035")
      && input.after.lastAction.includes("추가로 잡았습니다")
    ) {
      addMapEvent(events, decision.chooserUserId, "AUG-035");
    }

    const captured = capturedGroups(input.before, input.after, decision?.kind === "DOUBLE_HIT" ? decision.attackerUserId : input.actorUserId);
    for (const group of captured) {
      const victimOwned = input.ownedByUser[group.userId] ?? [];
      if (victimOwned.includes("AUG-005") && group.pieces.length >= 2) addMapEvent(events, group.userId, "AUG-005");
      if (victimOwned.includes("AUG-027")) addMapEvent(events, group.userId, "AUG-027");
      if (victimOwned.includes("AUG-064")) addMapEvent(events, group.userId, "AUG-064");
    }
  }

  if (input.actionKind === "split" && ownedIds.includes("AUG-061")) {
    const pending = input.before.pendingSplitChoice;
    const ownerAfter = player(input.after, input.actorUserId);
    if (pending && ownerAfter) {
      const groupIds = new Set(
        ownerAfter.pieces
          .filter((piece) => pending.pieceIds.includes(piece.id))
          .map((piece) => piece.groupId),
      );
      if (groupIds.size > 1) addMapEvent(events, input.actorUserId, "AUG-061");
    }
  }
}

function detectRuntimeAndWinTriggers(input: DetectInput, events: Map<string, AugmentTriggerEvent>) {
  for (const [userId, ids] of Object.entries(input.ownedByUser)) {
    if (ids.includes("AUG-042")) {
      const delta = runtimeNumberDelta(input.before, input.after, userId, "enemyCaptureCount");
      if (delta > 0) addMapEvent(events, userId, "AUG-042", delta);
    }
  }

  if (!input.before.winnerUserId && input.after.winnerUserId) {
    const winner = input.after.winnerUserId;
    if (input.after.winnerCondition === "FOUR_GUARDIANS" && owned(input, winner, "AUG-032")) {
      addMapEvent(events, winner, "AUG-032");
    }
    if (input.after.winnerCondition === "CENTER_STACK" && owned(input, winner, "AUG-033")) {
      addMapEvent(events, winner, "AUG-033");
    }
    if (input.after.winnerCondition === "MOONWALK" && owned(input, winner, "AUG-031")) {
      const key = `${winner}:AUG-031`;
      if (!events.has(key)) addMapEvent(events, winner, "AUG-031");
    }
    if (input.after.winnerCondition === "SOLO_RUN" && owned(input, winner, "AUG-041")) {
      const key = `${winner}:AUG-041`;
      if (!events.has(key)) addMapEvent(events, winner, "AUG-041");
    }
    if (input.after.winnerCondition === "HUNT" && owned(input, winner, "AUG-042")) {
      const key = `${winner}:AUG-042`;
      if (!events.has(key)) addMapEvent(events, winner, "AUG-042");
    }
  }
}

export function detectAugmentTriggers(input: DetectInput): AugmentTriggerEvent[] {
  const events = new Map<string, AugmentTriggerEvent>();
  detectRollTriggers(input, events);
  detectMovementTriggers(input, events);
  detectDirectActionTriggers(input, events);
  detectRuntimeAndWinTriggers(input, events);
  return [...events.values()];
}

export function applyTriggerEvents(target: TriggerCountsByUser, events: AugmentTriggerEvent[]) {
  for (const event of events) {
    target[event.userId] ??= {};
    target[event.userId][event.augmentId] = (target[event.userId][event.augmentId] ?? 0) + event.count;
  }
}
