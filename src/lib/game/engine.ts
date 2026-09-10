import {
  adjustedResultForGroup,
  applyWaterGhostOne,
  armJunctionBoostAtDestination,
  armPathControlAtDestination,
  blocksCaptureExtraRoll,
  chaseTargetsOnPath,
  clearGroupMoveFixedToOne,
  clearJunctionBoostForGroup,
  clearPathControlForGroup,
  consumeAlleyBlockade,
  consumeCleanerMovement,
  consumeGroupMoveFixedToOne,
  consumeJunctionBoostForForwardMove,
  finalStepsForRoll,
  firstForwardPathInterruption,
  grantsBackdoMoveToken,
  grantsFaceExtraRoll,
  isCaptureImmune,
  isCleanerActive,
  isGroupUsableWithAugments,
  isSanctuaryGroup,
  type PathInterruption,
  type PlayerAugmentSetups,
  recordCaptureAgainstPlayer,
  recordEnemyCaptures,
  replacesNormalWinCondition,
  shouldReturnAttackerWithWaterGhostTwo,
  specialWinForPlayer,
  stackAugmentExtraRolls,
  transferFixedOneOnStack,
  transferJunctionBoostOnStack,
  transferPathControlOnStack,
  transformRollFace,
} from "@/lib/augments/effects";
import {
  backwardPathToTarget,
  backwardPaths,
  backwardTargets,
  FINISH_NODE,
  forwardMoveOptions,
  legalTargets,
  reverseMoveOptions,
} from "./board";
import { returnPiecesAfterEnemyCapture } from "./capture-return";
import { baseStepsForFace, faceLabel } from "./roll";
import type {
  EnginePlayer,
  GameEngineState,
  GameWinCondition,
  PendingRelocationChoice,
  PieceState,
  PlayerSeed,
  RelocationOpportunity,
  RollFace,
  RollSource,
  RollToken,
} from "./types";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export type EngineMoveTarget = {
  node: number | null;
  finished: boolean;
  kind: "NORMAL" | "CHASE" | "FORCED" | "SHORTCUT" | "BACKDO";
  reason?: "SANCTUARY" | "ALLEY_BLOCKADE";
  path?: number[];
};

type ForwardTargetPlan = {
  target: EngineMoveTarget;
  interruption: PathInterruption | null;
};

type CaptureSummary = {
  captureCount: number;
  captureExtraRollCount: number;
  attackerReturned: boolean;
};

export function createInitialEngine(players: PlayerSeed[]): GameEngineState {
  const sorted = [...players].sort((a, b) => a.seat - b.seat);
  if (!sorted.length) throw new Error("Cannot initialize a game without players.");
  return {
    schemaVersion: 1,
    round: 1,
    turnNumber: 1,
    currentSeat: sorted[0].seat,
    stage: "AWAITING_ROLL",
    pendingRolls: ["BASIC"],
    results: [],
    players: sorted.map((player) => ({
      userId: player.userId,
      displayName: player.displayName,
      seat: player.seat,
      pieces: Array.from({ length: 4 }, (_, index) => {
        const id = `${player.seat}-${index + 1}`;
        return { id, ownerUserId: player.userId, seat: player.seat, status: "WAITING", node: null, groupId: id, hasEntered: false, pathHistory: [] } satisfies PieceState;
      }),
    })),
    pendingRollChoice: null,
    pendingSplitChoice: null,
    pendingCaptureChoice: null,
    pendingRelocationChoice: null,
    pendingStackChoice: null,
    augmentRuntime: {},
    winnerUserId: null,
    winnerCondition: null,
    lastAction: `${sorted[0].displayName}의 첫 턴입니다.`,
  };
}

export function currentPlayer(engine: GameEngineState): EnginePlayer {
  const player = engine.players.find((candidate) => candidate.seat === engine.currentSeat);
  if (!player) throw new Error("Current player is missing.");
  return player;
}

function allPieces(engine: GameEngineState) {
  return engine.players.flatMap((player) => player.pieces);
}

function hasUsableOnBoardGroup(
  engine: GameEngineState,
  ownedIds: string[] = [],
  setups: PlayerAugmentSetups = {},
) {
  const player = currentPlayer(engine);
  const seen = new Set<string>();
  for (const piece of player.pieces) {
    if (piece.status !== "ON_BOARD" || seen.has(piece.groupId)) continue;
    seen.add(piece.groupId);
    if (isGroupUsableWithAugments(engine, player.userId, piece.groupId, ownedIds, setups)) return true;
  }
  return false;
}

function discardUnusableResults(
  engine: GameEngineState,
  ownedIds: string[] = [],
  setups: PlayerAugmentSetups = {},
) {
  if (hasUsableOnBoardGroup(engine, ownedIds, setups)) return;
  if (engine.results.some((result) => result.face !== "BACKDO")) return;
  const before = engine.results.length;
  engine.results = engine.results.filter((result) => result.face !== "BACKDO");
  if (engine.results.length !== before) engine.lastAction = "현재 움직일 수 있는 말이 없어 백도가 소멸했습니다.";
}

function declareWinner(engine: GameEngineState, userId: string, condition: GameWinCondition, message: string) {
  engine.winnerUserId = userId;
  engine.winnerCondition = condition;
  engine.stage = "FINISHED";
  engine.pendingRolls = [];
  engine.results = [];
  engine.pendingRollChoice = null;
  engine.pendingSplitChoice = null;
  engine.pendingCaptureChoice = null;
  engine.pendingRelocationChoice = null;
  engine.pendingStackChoice = null;
  engine.lastAction = message;
}

function checkSpecialWinner(engine: GameEngineState, ownedIds: string[]) {
  const player = currentPlayer(engine);
  if (ownedIds.includes("P02") && player.pieces.every((piece) => piece.status === "WAITING")) {
    declareWinner(engine, player.userId, "MOONWALK", `${player.displayName}: 문워크 · 모든 말을 대기로 되돌렸습니다!`);
    return player.userId;
  }
  const result = specialWinForPlayer(engine, player.userId, ownedIds);
  if (!result) return null;
  declareWinner(engine, player.userId, result.condition, result.message);
  return player.userId;
}

function checkBasicWinner(engine: GameEngineState, ownedIds: string[]) {
  if (ownedIds.includes("P02") || replacesNormalWinCondition(ownedIds)) return null;
  const player = currentPlayer(engine);
  if (player.pieces.every((piece) => piece.status === "FINISHED")) {
    declareWinner(engine, player.userId, "NORMAL", `${player.displayName} 승리!`);
    return player.userId;
  }
  return null;
}

function advanceTurn(engine: GameEngineState) {
  if (engine.winnerUserId) return;
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
  engine.lastAction = `${currentPlayer(engine).displayName}의 턴입니다.`;
}

function settleAfterRollQueue(
  engine: GameEngineState,
  ownedIds: string[] = [],
  setups: PlayerAugmentSetups = {},
) {
  if (engine.pendingRolls.length > 0 || engine.winnerUserId) return;
  discardUnusableResults(engine, ownedIds, setups);
  if (engine.results.length > 0) engine.stage = "MOVING";
  else advanceTurn(engine);
}

export function applyRoll(
  engineInput: GameEngineState,
  rolledFace: RollFace,
  tokenId: string,
  ownedIds: string[] = [],
  setups: PlayerAugmentSetups = {},
): GameEngineState {
  const engine = clone(engineInput);
  if (engine.stage !== "AWAITING_ROLL") throw new Error("지금은 윷을 던질 수 없습니다.");
  const source = engine.pendingRolls.shift();
  if (!source) throw new Error("처리할 던지기가 없습니다.");
  const player = currentPlayer(engine);
  const face = transformRollFace(engine, player.userId, rolledFace, source, ownedIds);
  const baseSteps = baseStepsForFace(face);
  engine.results.push({ id: tokenId, face, baseSteps, finalSteps: finalStepsForRoll(face, source, ownedIds), source });
  if (grantsFaceExtraRoll(face, ownedIds)) engine.pendingRolls.push("YUT_MO");
  engine.lastAction = `${player.displayName}: ${faceLabel(face)}`;
  settleAfterRollQueue(engine, ownedIds, setups);
  return engine;
}

function groupPieces(engine: GameEngineState, groupId: string, includeFinished = false) {
  return currentPlayer(engine).pieces.filter((piece) => (
    piece.groupId === groupId && (includeFinished || piece.status !== "FINISHED")
  ));
}

function playerBoardGroups(engine: GameEngineState, userId: string) {
  const player = engine.players.find((candidate) => candidate.userId === userId);
  const groups = new Map<string, PieceState[]>();
  if (!player) return groups;
  for (const piece of player.pieces) {
    if (piece.status !== "ON_BOARD" || piece.node == null) continue;
    const list = groups.get(piece.groupId) ?? [];
    list.push(piece);
    groups.set(piece.groupId, list);
  }
  return groups;
}

function applyForwardPath(group: PieceState[], traversed: number[], destination: number | null, finished: boolean) {
  for (const piece of group) {
    piece.hasEntered = true;
    piece.pathHistory.push(...traversed);
    if (finished) {
      piece.status = "FINISHED";
      piece.node = null;
    } else {
      piece.status = "ON_BOARD";
      piece.node = destination;
    }
  }
}

function applyBackwardPath(group: PieceState[], traversed: number[], destination: number) {
  for (const piece of group) {
    piece.node = destination;
    piece.pathHistory.push(...traversed);
  }
}

function applyMoonwalkReversePath(group: PieceState[], traversed: number[], destination: number | null, home: boolean) {
  for (const piece of group) {
    piece.hasEntered = true;
    piece.pathHistory.push(...traversed);
    if (home) {
      piece.status = "WAITING";
      piece.node = null;
      piece.groupId = piece.id;
    } else if (destination == null) {
      piece.status = "FINISHED";
      piece.node = null;
    } else {
      piece.status = "ON_BOARD";
      piece.node = destination;
    }
  }
}

function samePath(left: number[] | undefined, right: number[] | undefined) {
  if (!left || !right || left.length !== right.length) return false;
  return left.every((node, index) => node === right[index]);
}

function buildForwardTargetPlans(
  engine: GameEngineState,
  userId: string,
  piece: PieceState,
  result: RollToken,
  ownedIds: string[],
  ownedByUser: Record<string, string[]> = {},
): ForwardTargetPlan[] {
  const start = piece.status === "WAITING" ? 0 : piece.node;
  if (start == null) return [];
  const movements = forwardMoveOptions(start, result.finalSteps, {
    forbidShortcutEntry: result.forbidShortcuts,
    allowPassingShortcutEntry: ownedIds.includes("P09"),
    allowUniversalCenterChoice: ownedIds.includes("P04"),
  });
  const plans: ForwardTargetPlan[] = [];

  for (const movement of movements) {
    const interruption = firstForwardPathInterruption(engine, userId, start, movement.traversed);
    let normalTraversed = movement.traversed;
    let normalNode = movement.node;
    let normalFinished = movement.finished;
    let normalKind: EngineMoveTarget["kind"] = movement.usedPassingShortcut ? "SHORTCUT" : "NORMAL";
    if (interruption) {
      const stopIndex = movement.traversed.indexOf(interruption.stopNode);
      normalTraversed = stopIndex >= 0 ? movement.traversed.slice(0, stopIndex + 1) : [];
      normalNode = interruption.stopNode;
      normalFinished = false;
      normalKind = "FORCED";
    }

    const chaseTargets = ownedIds.includes("G10")
      ? chaseTargetsOnPath(engine, userId, normalTraversed, ownedByUser).filter((node) => node !== normalNode)
      : [];
    for (const node of chaseTargets) {
      const index = normalTraversed.indexOf(node);
      if (index < 0) continue;
      plans.push({
        target: { node, finished: false, kind: "CHASE", path: normalTraversed.slice(0, index + 1) },
        interruption: null,
      });
    }

    plans.push({
      target: {
        node: normalNode,
        finished: normalFinished,
        kind: normalKind,
        reason: interruption?.reason,
        path: normalTraversed,
      },
      interruption,
    });
  }

  const deduped = new Map<string, ForwardTargetPlan>();
  for (const plan of plans) {
    const key = `${plan.target.kind}|${plan.target.finished ? "F" : plan.target.node}|${plan.target.path?.join(",") ?? ""}`;
    if (!deduped.has(key)) deduped.set(key, plan);
  }
  return [...deduped.values()];
}

function buildReverseTargetPlans(
  engine: GameEngineState,
  userId: string,
  piece: PieceState,
  result: RollToken,
  ownedIds: string[],
  ownedByUser: Record<string, string[]> = {},
): ForwardTargetPlan[] {
  if (piece.status === "WAITING") return [];
  const start = piece.status === "FINISHED" ? FINISH_NODE : piece.node;
  if (start == null) return [];
  const movements = reverseMoveOptions(start, result.finalSteps, {
    forbidShortcutEntry: result.forbidShortcuts,
    allowPassingShortcutEntry: ownedIds.includes("P09"),
  });
  const plans: ForwardTargetPlan[] = [];

  for (const movement of movements) {
    const interruption = firstForwardPathInterruption(engine, userId, start, movement.traversed);
    let normalTraversed = movement.traversed;
    let normalNode = movement.node;
    let home = movement.home;
    let normalKind: EngineMoveTarget["kind"] = movement.usedPassingShortcut ? "SHORTCUT" : "NORMAL";
    if (interruption) {
      const stopIndex = movement.traversed.indexOf(interruption.stopNode);
      normalTraversed = stopIndex >= 0 ? movement.traversed.slice(0, stopIndex + 1) : [];
      normalNode = interruption.stopNode === FINISH_NODE ? null : interruption.stopNode;
      home = false;
      normalKind = "FORCED";
    }

    const chaseTargets = ownedIds.includes("G10")
      ? chaseTargetsOnPath(engine, userId, normalTraversed, ownedByUser).filter((node) => node !== normalNode)
      : [];
    for (const node of chaseTargets) {
      const index = normalTraversed.indexOf(node);
      if (index < 0) continue;
      plans.push({
        target: { node, finished: false, kind: "CHASE", path: normalTraversed.slice(0, index + 1) },
        interruption: null,
      });
    }

    plans.push({
      target: {
        node: normalNode,
        finished: home,
        kind: normalKind,
        reason: interruption?.reason,
        path: normalTraversed,
      },
      interruption,
    });
  }

  const deduped = new Map<string, ForwardTargetPlan>();
  for (const plan of plans) {
    const key = `${plan.target.kind}|${plan.target.finished ? "H" : plan.target.node}|${plan.target.path?.join(",") ?? ""}`;
    if (!deduped.has(key)) deduped.set(key, plan);
  }
  return [...deduped.values()];
}

function adjustedMoonwalkResult(
  engine: GameEngineState,
  userId: string,
  groupId: string,
  result: RollToken,
  ownedIds: string[],
  setups: PlayerAugmentSetups,
) {
  const adjusted = adjustedResultForGroup(engine, userId, groupId, result, ownedIds, setups);
  if (!ownedIds.includes("P02") || result.face === "BACKDO") return adjusted;
  const player = engine.players.find((candidate) => candidate.userId === userId);
  const group = player?.pieces.filter((piece) => piece.groupId === groupId) ?? [];
  if (!group.length || !group.every((piece) => piece.status === "FINISHED")) return adjusted;

  let bonus = 0;
  if (ownedIds.includes("P15") && group.length >= 2) bonus += group.length - 1;
  else if (ownedIds.includes("G08") && group.length >= 2) bonus += 1;
  const acePieceId = setups.G16?.pieceId;
  if (ownedIds.includes("G16") && acePieceId && group.some((piece) => piece.id === acePieceId)) bonus += 1;
  if (ownedIds.includes("P10")) bonus += 2;
  return {
    ...result,
    finalSteps: result.finalSteps + bonus,
    forbidShortcuts: ownedIds.includes("P10") || result.forbidShortcuts,
  };
}

export function legalMoveTargetsWithAugments(
  engine: GameEngineState,
  userId: string,
  piece: PieceState,
  result: RollToken,
  ownedIds: string[],
  ownedByUser: Record<string, string[]> = {},
): EngineMoveTarget[] {
  if (ownedIds.includes("P02")) {
    if (result.face === "BACKDO") {
      if (piece.status !== "ON_BOARD" || piece.node == null) return [];
      const forwardResult: RollToken = { ...result, face: "MOVE1", finalSteps: Math.max(1, Math.abs(result.finalSteps)) };
      return buildForwardTargetPlans(engine, userId, piece, forwardResult, ownedIds, ownedByUser).map((plan) => plan.target);
    }
    return buildReverseTargetPlans(engine, userId, piece, result, ownedIds, ownedByUser).map((plan) => plan.target);
  }
  if (result.face === "BACKDO") {
    return legalTargets(piece, result).map((target) => ({ ...target, kind: "BACKDO" as const }));
  }
  return buildForwardTargetPlans(engine, userId, piece, result, ownedIds, ownedByUser).map((plan) => plan.target);
}

function opponentGroupsAtNode(engine: GameEngineState, moverUserId: string, node: number) {
  const groups = new Map<string, PieceState[]>();
  for (const piece of allPieces(engine)) {
    if (piece.ownerUserId === moverUserId || piece.status !== "ON_BOARD" || piece.node !== node) continue;
    const key = `${piece.ownerUserId}:${piece.groupId}`;
    const list = groups.get(key) ?? [];
    list.push(piece);
    groups.set(key, list);
  }
  return [...groups.values()];
}

function firstCleanerWaterGhostStop(
  engine: GameEngineState,
  moverUserId: string,
  path: number[],
  ownedByUser: Record<string, string[]> = {},
) {
  for (const node of path) {
    for (const group of opponentGroupsAtNode(engine, moverUserId, node)) {
      const victim = group[0];
      if (!victim) continue;
      const victimOwned = ownedByUser[victim.ownerUserId] ?? [];
      if (!victimOwned.includes("P07")) continue;
      if (isSanctuaryGroup(engine, victim.ownerUserId, victim.groupId, node)) continue;
      if (isCaptureImmune(engine, victim.ownerUserId, victimOwned)) continue;
      return node;
    }
  }
  return null;
}

function captureAtNode(
  engine: GameEngineState,
  movingGroupId: string,
  node: number,
  ownedByUser: Record<string, string[]> = {},
): CaptureSummary {
  const mover = currentPlayer(engine);
  let captureCount = 0;
  let captureExtraRollCount = 0;
  let attackerReturned = false;

  for (const capturedGroup of opponentGroupsAtNode(engine, mover.userId, node)) {
    const victim = capturedGroup[0];
    if (!victim) continue;
    const victimOwned = ownedByUser[victim.ownerUserId] ?? [];
    if (isSanctuaryGroup(engine, victim.ownerUserId, victim.groupId, node)) continue;
    if (isCaptureImmune(engine, victim.ownerUserId, victimOwned)) continue;

    captureCount += 1;
    if (!blocksCaptureExtraRoll(capturedGroup.length, victimOwned)) captureExtraRollCount += 1;
    recordCaptureAgainstPlayer(engine, victim.ownerUserId, victimOwned);
    applyWaterGhostOne(engine, mover.userId, movingGroupId, victimOwned);
    if (shouldReturnAttackerWithWaterGhostTwo(victimOwned)) attackerReturned = true;
    clearGroupMoveFixedToOne(engine, victim.ownerUserId, victim.groupId);
    clearJunctionBoostForGroup(engine, victim.ownerUserId, victim.groupId);
    clearPathControlForGroup(engine, victim.ownerUserId, victim.groupId);

    returnPiecesAfterEnemyCapture(capturedGroup, victimOwned);
  }

  return { captureCount, captureExtraRollCount, attackerReturned };
}

function captureAlongPath(
  engine: GameEngineState,
  movingGroupId: string,
  nodes: number[],
  ownedByUser: Record<string, string[]> = {},
): CaptureSummary {
  const total: CaptureSummary = { captureCount: 0, captureExtraRollCount: 0, attackerReturned: false };
  for (const node of nodes) {
    const result = captureAtNode(engine, movingGroupId, node, ownedByUser);
    total.captureCount += result.captureCount;
    total.captureExtraRollCount += result.captureExtraRollCount;
    if (result.attackerReturned) {
      total.attackerReturned = true;
      break;
    }
  }
  return total;
}

function returnMovingGroupAfterEnemyEffect(
  engine: GameEngineState,
  userId: string,
  groupId: string,
  ownedIds: string[],
) {
  const player = engine.players.find((candidate) => candidate.userId === userId);
  if (!player) return;
  clearJunctionBoostForGroup(engine, userId, groupId);
  clearPathControlForGroup(engine, userId, groupId);
  const group = player.pieces.filter((piece) => piece.groupId === groupId && piece.status === "ON_BOARD");
  returnPiecesAfterEnemyCapture(group, ownedIds);
}

function alliedGroupsAtDestination(engine: GameEngineState, moverUserId: string, movingGroupId: string, destination: number) {
  const player = engine.players.find((candidate) => candidate.userId === moverUserId);
  if (!player) return [];
  return [...new Set(
    player.pieces
      .filter((piece) => piece.status === "ON_BOARD" && piece.node === destination && piece.groupId !== movingGroupId)
      .map((piece) => piece.groupId),
  )];
}

function candidateGroupsAtNodes(
  engine: GameEngineState,
  userId: string,
  movingGroupId: string,
  nodes: Set<number>,
  singleOnly: boolean,
) {
  const groups = playerBoardGroups(engine, userId);
  const ids: string[] = [];
  for (const [groupId, pieces] of groups) {
    if (groupId === movingGroupId || !pieces.length) continue;
    if (singleOnly && pieces.length !== 1) continue;
    const node = pieces[0].node;
    if (node != null && nodes.has(node)) ids.push(groupId);
  }
  return ids;
}

function relocationOpportunitiesAfterMove(
  engine: GameEngineState,
  userId: string,
  movingGroupId: string,
  destination: number,
  actualPath: number[],
  startNode: number,
  effectiveResult: RollToken,
  ownedIds: string[],
): RelocationOpportunity[] {
  const opportunities: RelocationOpportunity[] = [];

  if (ownedIds.includes("S15")) {
    const neighborNodes = new Set<number>();
    const previousNode = actualPath.length >= 2
      ? actualPath[actualPath.length - 2]
      : startNode > 0 && startNode !== destination
        ? startNode
        : null;
    if (previousNode != null && previousNode !== FINISH_NODE) neighborNodes.add(previousNode);

    if (ownedIds.includes("P02")) {
      if (effectiveResult.face === "BACKDO") {
        for (const next of forwardMoveOptions(destination, 1, { forbidShortcutEntry: effectiveResult.forbidShortcuts })) {
          if (!next.finished && next.node != null) neighborNodes.add(next.node);
        }
      } else {
        for (const next of reverseMoveOptions(destination, 1, { forbidShortcutEntry: effectiveResult.forbidShortcuts })) {
          if (!next.home && next.node != null) neighborNodes.add(next.node);
        }
      }
    } else if (effectiveResult.face === "BACKDO") {
      for (const node of backwardTargets(destination)) neighborNodes.add(node);
    } else {
      for (const next of forwardMoveOptions(destination, 1, { forbidShortcutEntry: effectiveResult.forbidShortcuts })) {
        if (!next.finished && next.node != null) neighborNodes.add(next.node);
      }
    }
    neighborNodes.delete(destination);
    const candidates = candidateGroupsAtNodes(engine, userId, movingGroupId, neighborNodes, true);
    if (candidates.length) opportunities.push({ kind: "FRIEND", candidateGroupIds: candidates });
  }

  if (ownedIds.includes("P18")) {
    const passedNodes = new Set(actualPath.filter((node) => node !== destination));
    const candidates = candidateGroupsAtNodes(engine, userId, movingGroupId, passedNodes, false);
    if (candidates.length) opportunities.push({ kind: "HITCHHIKER", candidateGroupIds: candidates });
  }

  return opportunities;
}

function liveRelocationCandidates(engine: GameEngineState, pending: PendingRelocationChoice, candidateIds: string[]) {
  const player = currentPlayer(engine);
  return candidateIds.filter((groupId) => player.pieces.some((piece) => (
    piece.groupId === groupId
    && piece.status === "ON_BOARD"
    && piece.node != null
    && piece.node !== pending.destination
    && groupId !== pending.movingGroupId
  )));
}

function finishResolvedMove(engine: GameEngineState, captureExtraRollCount: number, augmentExtraRolls = 0, ownedIds: string[] = []) {
  if (checkSpecialWinner(engine, ownedIds)) return;
  if (checkBasicWinner(engine, ownedIds)) return;
  if (captureExtraRollCount > 0) engine.pendingRolls.push(...Array.from({ length: captureExtraRollCount }, () => "CAPTURE" as RollSource));
  if (augmentExtraRolls > 0) engine.pendingRolls.push(...Array.from({ length: augmentExtraRolls }, () => "AUGMENT" as RollSource));
  if (engine.pendingRolls.length > 0) {
    engine.stage = "AWAITING_ROLL";
    return;
  }
  discardUnusableResults(engine);
  if (engine.results.length > 0) engine.stage = "MOVING";
  else advanceTurn(engine);
}

function continuePostRelocation(engine: GameEngineState, pending: PendingRelocationChoice, ownedIds: string[]) {
  while (pending.opportunities.length > 0) {
    const [current, ...rest] = pending.opportunities;
    const candidates = liveRelocationCandidates(engine, pending, current.candidateGroupIds);
    if (candidates.length > 0) {
      pending.opportunities = [{ ...current, candidateGroupIds: candidates }, ...rest];
      engine.pendingRelocationChoice = pending;
      engine.stage = "RELOCATION_CHOICE";
      return;
    }
    pending.opportunities = rest;
  }

  engine.pendingRelocationChoice = null;
  const alliedGroupIds = pending.alliedGroupIds.filter((groupId) => currentPlayer(engine).pieces.some((piece) => (
    piece.groupId === groupId && piece.status === "ON_BOARD" && piece.node === pending.destination
  )));
  if (alliedGroupIds.length > 0) {
    engine.stage = "STACK_CHOICE";
    engine.pendingStackChoice = {
      movingGroupId: pending.movingGroupId,
      destination: pending.destination,
      alliedGroupIds,
      captureCount: pending.captureCount,
      captureExtraRollCount: pending.captureExtraRollCount,
      augmentExtraRolls: pending.augmentExtraRolls,
    };
    return;
  }

  finishResolvedMove(engine, pending.captureExtraRollCount, pending.augmentExtraRolls, ownedIds);
}

function relocateOwnGroupIntoMovingGroup(
  engine: GameEngineState,
  userId: string,
  sourceGroupId: string,
  movingGroupId: string,
  destination: number,
) {
  const player = engine.players.find((candidate) => candidate.userId === userId);
  if (!player) throw new Error("플레이어를 찾지 못했습니다.");
  const source = player.pieces.filter((piece) => piece.groupId === sourceGroupId && piece.status === "ON_BOARD");
  const moving = player.pieces.filter((piece) => piece.groupId === movingGroupId && piece.status === "ON_BOARD" && piece.node === destination);
  if (!source.length || !moving.length) throw new Error("재배치할 묶음을 찾지 못했습니다.");

  const mergeIds = [movingGroupId, sourceGroupId];
  transferFixedOneOnStack(engine, userId, mergeIds, movingGroupId);
  transferJunctionBoostOnStack(engine, userId, mergeIds, movingGroupId);
  transferPathControlOnStack(engine, userId, mergeIds, movingGroupId, destination);
  for (const piece of source) {
    piece.node = destination;
    piece.groupId = movingGroupId;
    piece.hasEntered = true;
    piece.pathHistory.push(destination);
  }
}

function resolveSoloLap(engine: GameEngineState, group: PieceState[], ownedIds: string[], setups: PlayerAugmentSetups) {
  if (!ownedIds.includes("P14")) return null;
  const representativeId = setups.P14?.pieceId;
  if (!representativeId || !group.some((piece) => piece.id === representativeId)) return null;
  const player = currentPlayer(engine);
  engine.augmentRuntime ??= {};
  const runtime = engine.augmentRuntime[player.userId] ?? {};
  engine.augmentRuntime[player.userId] = runtime;
  runtime.soloLaps = (runtime.soloLaps ?? 0) + 1;
  if (runtime.soloLaps >= 2) {
    declareWinner(engine, player.userId, "SOLO_RUN", `${player.displayName}: 독주 2바퀴 완주!`);
    return "WIN" as const;
  }
  const representative = player.pieces.find((piece) => piece.id === representativeId);
  if (representative) {
    representative.status = "WAITING";
    representative.node = null;
    representative.groupId = representative.id;
  }
  engine.lastAction = `${player.displayName}: 독주 1바퀴 완주 · 마지막 한 바퀴!`;
  return "LAP" as const;
}

function selectPlan(plans: ForwardTargetPlan[], args: { forwardTarget?: number; forwardPath?: number[] }) {
  if (Array.isArray(args.forwardPath)) return plans.find((plan) => samePath(plan.target.path, args.forwardPath));
  if (args.forwardTarget != null) return plans.find((plan) => plan.target.kind === "CHASE" && plan.target.node === args.forwardTarget);
  const standardPlans = plans.filter((plan) => plan.target.kind !== "CHASE");
  if (standardPlans.length === 1) return standardPlans[0];
  return undefined;
}

export function applyMove(
  engineInput: GameEngineState,
  args: { groupId: string; resultId: string; backwardTarget?: number; forwardTarget?: number; forwardPath?: number[] },
  ownedIds: string[] = [],
  setups: PlayerAugmentSetups = {},
  ownedByUser: Record<string, string[]> = {},
): GameEngineState {
  const engine = clone(engineInput);
  if (engine.stage !== "MOVING") throw new Error("지금은 말을 움직일 수 없습니다.");
  const resultIndex = engine.results.findIndex((result) => result.id === args.resultId);
  if (resultIndex < 0) throw new Error("사용할 수 없는 이동 결과입니다.");
  const result = engine.results[resultIndex];
  const moonwalk = ownedIds.includes("P02");
  const group = groupPieces(engine, args.groupId, moonwalk);
  if (!group.length) throw new Error("움직일 말을 찾지 못했습니다.");
  const mover = currentPlayer(engine);
  if (!moonwalk && !isGroupUsableWithAugments(engine, mover.userId, args.groupId, ownedIds, setups)) {
    throw new Error("이 증강에서는 지정한 대표 말만 움직일 수 있습니다.");
  }

  const representative = group[0];
  const movementStartNode = moonwalk && representative.status === "FINISHED"
    ? FINISH_NODE
    : representative.status === "WAITING" ? 0 : (representative.node ?? 0);
  const effectiveResult = adjustedMoonwalkResult(engine, mover.userId, args.groupId, result, ownedIds, setups);
  const cleanerWasActive = isCleanerActive(engine, mover.userId, ownedIds);
  consumeGroupMoveFixedToOne(engine, mover.userId, args.groupId);

  let destination: number | null = null;
  let finished = false;
  let moonwalkHome = false;
  let backdoReward = false;
  let pathMessage = "";
  let actualPath: number[] = [];
  let selectedInterruption: PathInterruption | null = null;

  if (moonwalk && result.face !== "BACKDO") {
    const plans = buildReverseTargetPlans(engine, mover.userId, representative, effectiveResult, ownedIds, ownedByUser);
    if (!plans.length) throw new Error("문워크로 이동할 수 없는 말입니다.");
    const selected = selectPlan(plans, args);
    if (!selected) throw new Error("문워크 이동 경로를 선택해야 합니다.");

    actualPath = selected.target.path ?? [];
    destination = selected.target.node;
    moonwalkHome = selected.target.finished;
    selectedInterruption = selected.interruption;

    if (cleanerWasActive) {
      const waterGhostStop = firstCleanerWaterGhostStop(engine, mover.userId, actualPath, ownedByUser);
      if (waterGhostStop != null) {
        actualPath = actualPath.slice(0, actualPath.indexOf(waterGhostStop) + 1);
        destination = waterGhostStop;
        moonwalkHome = false;
        selectedInterruption = null;
      }
    }

    pathMessage = " · 문워크 역주행";
    if (selected.target.kind === "CHASE") pathMessage += " · 추격자 조기 정지";
    else if (selected.target.kind === "SHORTCUT") pathMessage += " · 길은 내가 만든다";

    const reachedPlannedStop = samePath(actualPath, selected.target.path);
    if (reachedPlannedStop && selectedInterruption) {
      if (selectedInterruption.reason === "ALLEY_BLOCKADE") {
        consumeAlleyBlockade(engine, selectedInterruption.defenderUserId, selectedInterruption.defenderGroupId);
        pathMessage += ` · 골목대장 자동 봉쇄(${selectedInterruption.blockerNode}번)`;
      } else {
        pathMessage += ` · 성역 통과 차단(${selectedInterruption.blockerNode}번)`;
      }
    }

    applyMoonwalkReversePath(group, actualPath, destination, moonwalkHome);
    consumeJunctionBoostForForwardMove(engine, mover.userId, args.groupId, result, ownedIds);
    if (moonwalkHome || movementStartNode !== destination) clearPathControlForGroup(engine, mover.userId, args.groupId);
  } else if (moonwalk && result.face === "BACKDO") {
    if (representative.status !== "ON_BOARD" || representative.node == null) {
      throw new Error("문워크의 백도는 말판 위의 말에만 사용할 수 있습니다.");
    }
    const forwardResult: RollToken = {
      ...effectiveResult,
      face: "MOVE1",
      baseSteps: Math.max(1, Math.abs(effectiveResult.baseSteps)),
      finalSteps: Math.max(1, Math.abs(effectiveResult.finalSteps)),
    };
    const plans = buildForwardTargetPlans(engine, mover.userId, representative, forwardResult, ownedIds, ownedByUser);
    if (!plans.length) throw new Error("문워크 백도로 이동할 수 없습니다.");
    const selected = selectPlan(plans, args);
    if (!selected) throw new Error("문워크 백도 이동 경로를 선택해야 합니다.");

    actualPath = selected.target.path ?? [];
    destination = selected.target.node;
    finished = selected.target.finished;
    selectedInterruption = selected.interruption;

    if (cleanerWasActive) {
      const waterGhostStop = firstCleanerWaterGhostStop(engine, mover.userId, actualPath, ownedByUser);
      if (waterGhostStop != null) {
        actualPath = actualPath.slice(0, actualPath.indexOf(waterGhostStop) + 1);
        destination = waterGhostStop;
        finished = false;
        selectedInterruption = null;
      }
    }

    pathMessage = " · 문워크 백도 정방향";
    if (selected.target.kind === "CHASE") pathMessage += " · 추격자 조기 정지";
    else if (selected.target.kind === "SHORTCUT") pathMessage += " · 길은 내가 만든다";

    const reachedPlannedStop = samePath(actualPath, selected.target.path);
    if (reachedPlannedStop && selectedInterruption) {
      if (selectedInterruption.reason === "ALLEY_BLOCKADE") {
        consumeAlleyBlockade(engine, selectedInterruption.defenderUserId, selectedInterruption.defenderGroupId);
        pathMessage += ` · 골목대장 자동 봉쇄(${selectedInterruption.blockerNode}번)`;
      } else {
        pathMessage += ` · 성역 통과 차단(${selectedInterruption.blockerNode}번)`;
      }
    }

    applyForwardPath(group, actualPath, destination, finished);
    if (finished || movementStartNode !== destination) clearPathControlForGroup(engine, mover.userId, args.groupId);
  } else if (result.face === "BACKDO") {
    const steps = Math.max(1, Math.abs(effectiveResult.finalSteps));
    if (representative.status !== "ON_BOARD" || representative.node == null) throw new Error("백도는 말판 위의 말에만 사용할 수 있습니다.");
    const backwardStartNode = representative.node;
    if (args.backwardTarget == null) {
      const targets = [...new Set(backwardPaths(backwardStartNode, steps).map((path) => path[path.length - 1]))];
      if (targets.length !== 1) throw new Error("백도 경로를 선택해야 합니다.");
      args.backwardTarget = targets[0];
    }
    const path = backwardPathToTarget(backwardStartNode, steps, args.backwardTarget);
    if (!path) throw new Error("선택할 수 없는 백도 경로입니다.");
    actualPath = path;
    if (cleanerWasActive) {
      const waterGhostStop = firstCleanerWaterGhostStop(engine, mover.userId, actualPath, ownedByUser);
      if (waterGhostStop != null) actualPath = actualPath.slice(0, actualPath.indexOf(waterGhostStop) + 1);
    }
    destination = actualPath[actualPath.length - 1] ?? backwardStartNode;
    applyBackwardPath(group, actualPath, destination);
    if (backwardStartNode !== destination) clearPathControlForGroup(engine, mover.userId, args.groupId);
    backdoReward = grantsBackdoMoveToken(ownedIds);
  } else {
    const plans = buildForwardTargetPlans(engine, mover.userId, representative, effectiveResult, ownedIds, ownedByUser);
    if (!plans.length) throw new Error("유효하지 않은 이동입니다.");
    const selected = selectPlan(plans, args);
    if (!selected) throw new Error("이동 경로를 선택해야 합니다.");

    actualPath = selected.target.path ?? [];
    destination = selected.target.node;
    finished = selected.target.finished;
    selectedInterruption = selected.interruption;

    if (cleanerWasActive) {
      const waterGhostStop = firstCleanerWaterGhostStop(engine, mover.userId, actualPath, ownedByUser);
      if (waterGhostStop != null) {
        actualPath = actualPath.slice(0, actualPath.indexOf(waterGhostStop) + 1);
        destination = waterGhostStop;
        finished = false;
        selectedInterruption = null;
      }
    }

    if (selected.target.kind === "CHASE") pathMessage = " · 추격자 조기 정지";
    else if (selected.target.kind === "SHORTCUT") pathMessage = " · 길은 내가 만든다";

    const reachedPlannedStop = samePath(actualPath, selected.target.path);
    if (reachedPlannedStop && selectedInterruption) {
      if (selectedInterruption.reason === "ALLEY_BLOCKADE") {
        consumeAlleyBlockade(engine, selectedInterruption.defenderUserId, selectedInterruption.defenderGroupId);
        pathMessage += ` · 골목대장 자동 봉쇄(${selectedInterruption.blockerNode}번)`;
      } else {
        pathMessage += ` · 성역 통과 차단(${selectedInterruption.blockerNode}번)`;
      }
    }

    applyForwardPath(group, actualPath, destination, finished);
    consumeJunctionBoostForForwardMove(engine, mover.userId, args.groupId, result, ownedIds);
    if (finished || movementStartNode !== destination) clearPathControlForGroup(engine, mover.userId, args.groupId);
  }

  engine.results.splice(resultIndex, 1);
  if (cleanerWasActive) consumeCleanerMovement(engine, mover.userId, ownedIds);
  if (backdoReward) engine.results.push({ id: `${result.id}:backdo-bonus`, face: "MOVE1", baseSteps: 1, finalSteps: 1, source: "AUGMENT" });

  const captureNodes = cleanerWasActive ? actualPath : (destination != null && !finished && !moonwalkHome ? [destination] : []);
  const captures = captureAlongPath(engine, args.groupId, captureNodes, ownedByUser);
  recordEnemyCaptures(engine, mover.userId, captures.captureCount, ownedIds);

  if (captures.attackerReturned) {
    returnMovingGroupAfterEnemyEffect(engine, mover.userId, args.groupId, ownedIds);
    destination = null;
    finished = false;
    moonwalkHome = false;
  }

  const cleanerText = cleanerWasActive ? ` · 청소부 ${captures.captureCount}묶음 정리` : "";
  const captureText = captures.captureCount > 0 && !cleanerWasActive ? ` · 상대 묶음 ${captures.captureCount}개 잡기` : "";
  const rewardText = backdoReward ? " · 1칸 이동권 획득" : "";
  const waterGhostText = captures.attackerReturned
    ? ownedIds.includes("P02") ? " · 물귀신으로 문워크 출발점 복귀" : " · 물귀신으로 함께 대기"
    : "";

  if (finished) {
    const soloResult = moonwalk ? null : resolveSoloLap(engine, group, ownedIds, setups);
    if (soloResult === "WIN") return engine;
    if (!soloResult) engine.lastAction = `${mover.displayName}의 말 ${group.length}개가 완주했습니다.${pathMessage}${cleanerText}`;
    finishResolvedMove(engine, captures.captureExtraRollCount, 0, ownedIds);
    return engine;
  }

  if (moonwalkHome) {
    engine.lastAction = `${mover.displayName}: 문워크 · 말 ${group.length}개가 대기로 복귀했습니다.${cleanerText}${captureText}`;
    finishResolvedMove(engine, captures.captureExtraRollCount, 0, ownedIds);
    return engine;
  }

  if (destination == null) {
    engine.lastAction = `${mover.displayName}${pathMessage}${cleanerText}${captureText}${rewardText}${waterGhostText}`;
    finishResolvedMove(engine, captures.captureExtraRollCount, 0, ownedIds);
    return engine;
  }

  const alliedGroupIds = captures.attackerReturned ? [] : alliedGroupsAtDestination(engine, mover.userId, args.groupId, destination);
  if (!captures.attackerReturned) {
    armJunctionBoostAtDestination(engine, mover.userId, args.groupId, destination, ownedIds);
    armPathControlAtDestination(engine, mover.userId, args.groupId, destination, ownedIds);
  }
  engine.lastAction = `${mover.displayName} → ${destination}번${pathMessage}${cleanerText}${captureText}${rewardText}${waterGhostText}`;
  if (checkSpecialWinner(engine, ownedIds)) return engine;

  const relocationOpportunities = relocationOpportunitiesAfterMove(
    engine,
    mover.userId,
    args.groupId,
    destination,
    actualPath,
    movementStartNode,
    effectiveResult,
    ownedIds,
  );
  if (relocationOpportunities.length > 0) {
    engine.stage = "RELOCATION_CHOICE";
    engine.pendingRelocationChoice = {
      movingGroupId: args.groupId,
      destination,
      opportunities: relocationOpportunities,
      alliedGroupIds,
      captureCount: captures.captureCount,
      captureExtraRollCount: captures.captureExtraRollCount,
      augmentExtraRolls: 0,
    };
    return engine;
  }

  if (alliedGroupIds.length > 0) {
    engine.stage = "STACK_CHOICE";
    engine.pendingStackChoice = {
      movingGroupId: args.groupId,
      destination,
      alliedGroupIds,
      captureCount: captures.captureCount,
      captureExtraRollCount: captures.captureExtraRollCount,
      augmentExtraRolls: 0,
    };
    return engine;
  }
  finishResolvedMove(engine, captures.captureExtraRollCount, 0, ownedIds);
  return engine;
}

export function applyRelocationChoice(engineInput: GameEngineState, sourceGroupId: string | null, ownedIds: string[] = []): GameEngineState {
  const engine = clone(engineInput);
  if (engine.stage !== "RELOCATION_CHOICE" || !engine.pendingRelocationChoice) throw new Error("지금은 재배치 선택을 할 수 없습니다.");
  const pending = engine.pendingRelocationChoice;
  const current = pending.opportunities[0];
  if (!current) throw new Error("처리할 재배치 효과가 없습니다.");
  const player = currentPlayer(engine);

  if (sourceGroupId != null) {
    const valid = liveRelocationCandidates(engine, pending, current.candidateGroupIds);
    if (!valid.includes(sourceGroupId)) throw new Error("선택할 수 없는 재배치 대상입니다.");
    relocateOwnGroupIntoMovingGroup(engine, player.userId, sourceGroupId, pending.movingGroupId, pending.destination);
    pending.augmentExtraRolls += stackAugmentExtraRolls(true, ownedIds);
    const name = current.kind === "FRIEND" ? "친구와 함께" : "무임승차";
    engine.lastAction = `${player.displayName}: ${name}로 ${sourceGroupId} 묶음을 ${pending.destination}번으로 불러 업었습니다.`;
    if (checkSpecialWinner(engine, ownedIds)) return engine;
  } else {
    const name = current.kind === "FRIEND" ? "친구와 함께" : "무임승차";
    engine.lastAction = `${player.displayName}: ${name} 사용 안 함`;
  }

  pending.opportunities = pending.opportunities.slice(1);
  continuePostRelocation(engine, pending, ownedIds);
  return engine;
}

export function applyStackChoice(engineInput: GameEngineState, stack: boolean, ownedIds: string[] = []): GameEngineState {
  const engine = clone(engineInput);
  if (engine.stage !== "STACK_CHOICE" || !engine.pendingStackChoice) throw new Error("지금은 업기 선택을 할 수 없습니다.");
  const pending = engine.pendingStackChoice;
  const player = currentPlayer(engine);
  if (stack) {
    const mergeIds = new Set([pending.movingGroupId, ...pending.alliedGroupIds]);
    transferFixedOneOnStack(engine, player.userId, [...mergeIds], pending.movingGroupId);
    transferJunctionBoostOnStack(engine, player.userId, [...mergeIds], pending.movingGroupId);
    transferPathControlOnStack(engine, player.userId, [...mergeIds], pending.movingGroupId, pending.destination);
    for (const piece of player.pieces) {
      if (piece.status === "ON_BOARD" && piece.node === pending.destination && mergeIds.has(piece.groupId)) piece.groupId = pending.movingGroupId;
    }
    engine.lastAction = `${player.displayName}: ${pending.destination}번에서 업었습니다.`;
  } else {
    engine.lastAction = `${player.displayName}: 따로 두었습니다.`;
  }
  const augmentExtraRolls = (pending.augmentExtraRolls ?? 0) + stackAugmentExtraRolls(stack, ownedIds);
  engine.pendingStackChoice = null;
  finishResolvedMove(engine, pending.captureExtraRollCount, augmentExtraRolls, ownedIds);
  return engine;
}

export function applyGrandUnity(engineInput: GameEngineState, anchorGroupId: string, ownedIds: string[] = []): GameEngineState {
  const engine = clone(engineInput);
  if (!ownedIds.includes("P11")) throw new Error("대동단결 증강을 보유하고 있지 않습니다.");
  if (engine.stage !== "AWAITING_ROLL" && engine.stage !== "MOVING") throw new Error("지금은 대동단결을 사용할 수 없습니다.");
  const player = currentPlayer(engine);
  engine.augmentRuntime ??= {};
  const runtime = engine.augmentRuntime[player.userId] ?? {};
  engine.augmentRuntime[player.userId] = runtime;
  if (runtime.grandUnityUsed) throw new Error("대동단결은 한 게임에 한 번만 사용할 수 있습니다.");

  const groups = playerBoardGroups(engine, player.userId);
  if (groups.size < 2) throw new Error("말판 위에 모을 다른 묶음이 필요합니다.");
  const anchor = groups.get(anchorGroupId);
  const destination = anchor?.[0]?.node;
  if (!anchor?.length || destination == null) throw new Error("대동단결 기준 묶음을 찾지 못했습니다.");

  const mergeIds = [...groups.keys()];
  transferFixedOneOnStack(engine, player.userId, mergeIds, anchorGroupId);
  transferJunctionBoostOnStack(engine, player.userId, mergeIds, anchorGroupId);
  transferPathControlOnStack(engine, player.userId, mergeIds, anchorGroupId, destination);
  for (const [groupId, pieces] of groups) {
    if (groupId === anchorGroupId) continue;
    for (const piece of pieces) {
      piece.node = destination;
      piece.groupId = anchorGroupId;
      piece.pathHistory.push(destination);
    }
  }

  runtime.grandUnityUsed = true;
  engine.lastAction = `${player.displayName}: 대동단결 · 말판 위 모든 말을 ${destination}번으로 모아 업었습니다.`;
  if (checkSpecialWinner(engine, ownedIds)) return engine;

  const augmentExtraRolls = stackAugmentExtraRolls(true, ownedIds);
  if (augmentExtraRolls > 0) {
    if (engine.stage === "MOVING") {
      engine.pendingRolls.push("AUGMENT");
      engine.stage = "AWAITING_ROLL";
    } else {
      engine.pendingRolls.unshift("AUGMENT");
    }
  }
  return engine;
}

export function isActorsTurn(engine: GameEngineState, userId: string) {
  return currentPlayer(engine).userId === userId;
}

export function groupRepresentatives(engine: GameEngineState, userId: string) {
  const player = engine.players.find((candidate) => candidate.userId === userId);
  if (!player) return [];
  const seen = new Set<string>();
  return player.pieces.filter((piece) => {
    if (piece.status === "FINISHED" || seen.has(piece.groupId)) return false;
    seen.add(piece.groupId);
    return true;
  });
}
