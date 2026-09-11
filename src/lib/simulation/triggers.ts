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
  const cleanerActive = actorOwned.includes("P06")
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
      if (ids.includes("S16")) addMapEvent(events, ownerUserId, "S16");
    }
  }

  if (input.actionKind === "roll" && input.after.pendingRollChoice?.kind === "DUAL") {
    if (input.after.pendingRollChoice.reason === "COUNTER" && ownedIds.includes("S11")) {
      addMapEvent(events, input.actorUserId, "S11");
    }
    if (input.after.pendingRollChoice.reason === "EITHER" && ownedIds.includes("P12")) {
      addMapEvent(events, input.actorUserId, "P12");
    }
  }

  if (input.actionKind === "reroll_do" && ownedIds.includes("S12")) {
    addMapEvent(events, input.actorUserId, "S12");
  }

  const beforeCharges = ownedIds.includes("P19") ? (runtime(input.before, input.actorUserId)?.godHandCharges ?? 1) : 0;
  const afterCharges = ownedIds.includes("P19") ? (runtime(input.after, input.actorUserId)?.godHandCharges ?? 1) : 0;
  if (beforeCharges > afterCharges) addMapEvent(events, input.actorUserId, "P19", beforeCharges - afterCharges);

  for (const controlledId of ["G03", "G04", "G05"] as const) {
    if (!ownedIds.includes(controlledId)) continue;
    const beforeUsed = runtime(input.before, input.actorUserId)?.controlledBasicRollsUsed ?? 0;
    const afterUsed = runtime(input.after, input.actorUserId)?.controlledBasicRollsUsed ?? 0;
    if (afterUsed > beforeUsed) addMapEvent(events, input.actorUserId, controlledId, afterUsed - beforeUsed);
  }

  if (
    ownedIds.includes("S07")
    && runtime(input.before, input.actorUserId)?.revengeBasicPending
    && !runtime(input.after, input.actorUserId)?.revengeBasicPending
  ) {
    addMapEvent(events, input.actorUserId, "S07");
  }

  const tokens = newlyResolvedResults(input.before, input.after);
  for (const token of tokens) {
    if (ownedIds.includes("G01") && ["GAE", "YUT", "MO"].includes(token.face)) {
      addMapEvent(events, input.actorUserId, "G01");
    }
    if (ownedIds.includes("S03") && (token.face === "DO" || token.face === "BACKDO")) {
      addMapEvent(events, input.actorUserId, "S03");
    }
    if (ownedIds.includes("S09") && token.face === "GEOL") {
      addMapEvent(events, input.actorUserId, "S09");
    }
    if (token.source === "CAPTURE" && token.face !== "BACKDO") {
      if (ownedIds.includes("G02")) addMapEvent(events, input.actorUserId, "G02");
      else if (ownedIds.includes("S01")) addMapEvent(events, input.actorUserId, "S01");
      if (ownedIds.includes("P01")) addMapEvent(events, input.actorUserId, "P01");
    }
    if (
      ownedIds.includes("S13")
      && token.source === "BASIC"
      && token.face !== "BACKDO"
      && token.finalSteps > 0
      && input.before.round <= 9
      && runtime(input.before, input.actorUserId)?.vacancyInitialized
      && (runtime(input.before, input.actorUserId)?.vacancySkipsRemaining ?? 2) <= 0
    ) {
      addMapEvent(events, input.actorUserId, "S13");
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

  if (ownedIds.includes("P02")) addMapEvent(events, input.actorUserId, "P02");

  if (positive && result) {
    if (!suppressBonuses) {
      if (ownedIds.includes("S06") && move.beforePiece.status === "WAITING") {
        addMapEvent(events, input.actorUserId, "S06");
      }
      const actorBefore = player(input.before, input.actorUserId);
      if (ownedIds.includes("S08") && actorBefore?.pieces.filter((piece) => piece.status === "FINISHED").length === 3) {
        addMapEvent(events, input.actorUserId, "S08");
      }
      if (ownedIds.includes("S14") && runtime(input.before, input.actorUserId)?.junctionBoostGroups?.[move.groupId]) {
        addMapEvent(events, input.actorUserId, "S14");
      }
      if (
        ownedIds.includes("G07")
        && hasSoloJunctionHolder(input.before, input.actorUserId)
        && !isSoloJunctionGroup(input.before, input.actorUserId, move.groupId)
      ) {
        addMapEvent(events, input.actorUserId, "G07");
      }
      if (move.beforeGroup.length >= 2) {
        if (ownedIds.includes("P15")) addMapEvent(events, input.actorUserId, "P15");
        else if (ownedIds.includes("G08")) addMapEvent(events, input.actorUserId, "G08");
      }
      const acePieceId = input.setupsByUser?.[input.actorUserId]?.G16?.pieceId;
      if (ownedIds.includes("G16") && acePieceId && move.beforeGroup.some((piece) => piece.id === acePieceId)) {
        addMapEvent(events, input.actorUserId, "G16");
      }
    }
    if (ownedIds.includes("P10")) addMapEvent(events, input.actorUserId, "P10");
  }

  if (ownedIds.includes("S10") && result?.face === "BACKDO") {
    const rewardId = `${result.id}:backdo-bonus`;
    if (input.after.results.some((token) => token.id === rewardId) || input.after.lastAction.includes("1칸 이동권 획득")) {
      addMapEvent(events, input.actorUserId, "S10");
    }
  }
  if (ownedIds.includes("G10") && input.after.lastAction.includes("추격자 조기 정지")) {
    addMapEvent(events, input.actorUserId, "G10");
  }
  if (ownedIds.includes("P09") && input.after.lastAction.includes("길은 내가 만든다")) {
    addMapEvent(events, input.actorUserId, "P09");
  }

  const cleanerDelta = runtimeNumberDelta(input.before, input.after, input.actorUserId, "cleanerMovesUsed");
  if (ownedIds.includes("P06") && cleanerDelta > 0) addMapEvent(events, input.actorUserId, "P06", cleanerDelta);

  const lapDelta = runtimeNumberDelta(input.before, input.after, input.actorUserId, "soloLaps");
  if (ownedIds.includes("P14") && lapDelta > 0) addMapEvent(events, input.actorUserId, "P14", lapDelta);

  if (
    ownedIds.includes("G15")
    && positive
    && !suppressBonuses
    && runtime(input.before, input.actorUserId)?.athleteAcceleratingGroupId === move.groupId
    && (runtime(input.before, input.actorUserId)?.athleteConsecutiveMoves ?? 0) > 0
  ) {
    addMapEvent(events, input.actorUserId, "G15");
  }

  const captured = capturedGroups(input.before, input.after, input.actorUserId);
  for (const group of captured) {
    const victimOwned = input.ownedByUser[group.userId] ?? [];
    if (victimOwned.includes("S05") && group.pieces.length >= 2) addMapEvent(events, group.userId, "S05");
    if (victimOwned.includes("G12")) addMapEvent(events, group.userId, "G12");
    if (victimOwned.includes("P07")) addMapEvent(events, group.userId, "P07");
  }

  {
    const attemptNodes = new Set(captureAttemptNodes(input, move));
    for (const group of boardGroups(input.before)) {
      if (group.userId === input.actorUserId || !attemptNodes.has(group.node)) continue;
      if (!groupStillAt(input.after, group)) continue;
      const victimOwned = input.ownedByUser[group.userId] ?? [];
      if (
        victimOwned.includes("S04")
        && (runtime(input.before, group.userId)?.timesCaptured ?? 0) >= 5
      ) {
        addMapEvent(events, group.userId, "S04");
      }
      if (
        victimOwned.includes("P13")
        && runtime(input.before, group.userId)?.sanctuaryGroups?.[group.groupId] === group.node
      ) {
        addMapEvent(events, group.userId, "P13");
      }
    }
  }

  const alleyNode = parseBlockedNode(input.after.lastAction, "골목대장 자동 봉쇄");
  if (alleyNode != null) {
    for (const [userId, ids] of Object.entries(input.ownedByUser)) {
      if (!ids.includes("G06")) continue;
      const blocked = Object.entries(runtime(input.before, userId)?.alleyBlockades ?? {})
        .some(([, node]) => node === alleyNode);
      if (blocked) addMapEvent(events, userId, "G06");
    }
  }

  const sanctuaryNode = parseBlockedNode(input.after.lastAction, "성역 통과 차단");
  if (sanctuaryNode != null) {
    for (const [userId, ids] of Object.entries(input.ownedByUser)) {
      if (!ids.includes("P13")) continue;
      const blocked = Object.entries(runtime(input.before, userId)?.sanctuaryGroups ?? {})
        .some(([, node]) => node === sanctuaryNode);
      if (blocked) addMapEvent(events, userId, "P13");
    }
  }
}

function detectDirectActionTriggers(input: DetectInput, events: Map<string, AugmentTriggerEvent>) {
  const ownedIds = input.ownedByUser[input.actorUserId] ?? [];

  if (input.actionKind === "save_result" && ownedIds.includes("G13")) addMapEvent(events, input.actorUserId, "G13");
  if (input.actionKind === "split_number" && ownedIds.includes("G09")) addMapEvent(events, input.actorUserId, "G09");
  if (input.actionKind === "allocate_number_pool" && ownedIds.includes("P05")) addMapEvent(events, input.actorUserId, "P05");
  if (input.actionKind === "grand_unity" && ownedIds.includes("P11")) addMapEvent(events, input.actorUserId, "P11");
  if (input.actionKind === "ally_capture" && ownedIds.includes("P17")) addMapEvent(events, input.actorUserId, "P17");

  if (input.actionKind === "relocate") {
    const kind = input.before.pendingRelocationChoice?.opportunities[0]?.kind;
    const used = !input.after.lastAction.includes("사용 안 함");
    if (used && kind === "FRIEND" && ownedIds.includes("S15")) addMapEvent(events, input.actorUserId, "S15");
    if (used && kind === "HITCHHIKER" && ownedIds.includes("P18")) addMapEvent(events, input.actorUserId, "P18");
  }

  if (["stack", "relocate", "grand_unity"].includes(input.actionKind) && ownedIds.includes("S02")) {
    const extra = scheduledAugmentRolls(input.after) - scheduledAugmentRolls(input.before);
    if (extra > 0) addMapEvent(events, input.actorUserId, "S02", extra);
  }

  if (input.actionKind === "capture_choice") {
    const decision = input.before.pendingCaptureChoice?.decisions[0];
    if (decision?.kind === "INSURANCE" && owned(input, decision.chooserUserId, "G11")) {
      addMapEvent(events, decision.chooserUserId, "G11");
    }
    if (
      decision?.kind === "DOUBLE_HIT"
      && owned(input, decision.chooserUserId, "P08")
      && input.after.lastAction.includes("추가로 잡았습니다")
    ) {
      addMapEvent(events, decision.chooserUserId, "P08");
    }

    const captured = capturedGroups(input.before, input.after, decision?.kind === "DOUBLE_HIT" ? decision.attackerUserId : input.actorUserId);
    for (const group of captured) {
      const victimOwned = input.ownedByUser[group.userId] ?? [];
      if (victimOwned.includes("S05") && group.pieces.length >= 2) addMapEvent(events, group.userId, "S05");
      if (victimOwned.includes("G12")) addMapEvent(events, group.userId, "G12");
      if (victimOwned.includes("P07")) addMapEvent(events, group.userId, "P07");
    }
  }

  if (input.actionKind === "split" && ownedIds.includes("G14")) {
    const pending = input.before.pendingSplitChoice;
    const ownerAfter = player(input.after, input.actorUserId);
    if (pending && ownerAfter) {
      const groupIds = new Set(
        ownerAfter.pieces
          .filter((piece) => pending.pieceIds.includes(piece.id))
          .map((piece) => piece.groupId),
      );
      if (groupIds.size > 1) addMapEvent(events, input.actorUserId, "G14");
    }
  }
}

function detectRuntimeAndWinTriggers(input: DetectInput, events: Map<string, AugmentTriggerEvent>) {
  for (const [userId, ids] of Object.entries(input.ownedByUser)) {
    if (ids.includes("P16")) {
      const delta = runtimeNumberDelta(input.before, input.after, userId, "enemyCaptureCount");
      if (delta > 0) addMapEvent(events, userId, "P16", delta);
    }
  }

  if (!input.before.winnerUserId && input.after.winnerUserId) {
    const winner = input.after.winnerUserId;
    if (input.after.winnerCondition === "FOUR_GUARDIANS" && owned(input, winner, "P03")) {
      addMapEvent(events, winner, "P03");
    }
    if (input.after.winnerCondition === "CENTER_STACK" && owned(input, winner, "P04")) {
      addMapEvent(events, winner, "P04");
    }
    if (input.after.winnerCondition === "MOONWALK" && owned(input, winner, "P02")) {
      const key = `${winner}:P02`;
      if (!events.has(key)) addMapEvent(events, winner, "P02");
    }
    if (input.after.winnerCondition === "SOLO_RUN" && owned(input, winner, "P14")) {
      const key = `${winner}:P14`;
      if (!events.has(key)) addMapEvent(events, winner, "P14");
    }
    if (input.after.winnerCondition === "HUNT" && owned(input, winner, "P16")) {
      const key = `${winner}:P16`;
      if (!events.has(key)) addMapEvent(events, winner, "P16");
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
