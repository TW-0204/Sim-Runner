import {
  adjustedResultForGroup,
  applyWaterGhostOne,
  armEchoFollowerForDeparture,
  armJunctionBoostAtDestination,
  armPathControlAtDestination,
  betrayalCaptureBonusRoll,
  blocksCaptureExtraRoll,
  chaseTargetsOnPath,
  clearGroupMoveFixedToOne,
  clearJunctionBoostForGroup,
  clearPathControlForGroup,
  clearPlagueForGroup,
  clearTurtleLockForGroup,
  consumeAlleyBlockade,
  consumeSanctuaryPassBlock,
  consumeCleanerMovement,
  consumeBreakthroughCaptureBlock,
  consumeGroupMoveFixedToOne,
  consumeJunctionBoostForForwardMove,
  echoAllowsForwardPath,
  finalStepsForRoll,
  firstForwardPathInterruption,
  grantsBackdoMoveToken,
  consumeFaceExtraRollGrant,
  recordAthleteAccelerationMove,
  resetAthleteAccelerationForGroup,
  isCaptureImmune,
  isCleanerActive,
  infectPlagueGroup,
  infectPlaguePieceIds,
  isGroupUsableWithAugments,
  isPlagueGroup,
  isSanctuaryGroup,
  isTurtleGroupLocked,
  type PathInterruption,
  type PlayerAugmentSetups,
  recordCaptureAgainstPlayer,
  recordEchoFinish,
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
  BOARD_POSITIONS,
  FINISH_NODE,
  forwardMoveOptions,
  legalTargets,
  reverseMoveOptions,
} from "./board";
import { returnPiecesAfterEnemyCapture } from "./capture-return";
import { rehomeGroupAfterPieceRemoval } from "./group-ownership";
import { isMoonwalkHome } from "./passive-win";
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

function runtimeForWormhole(engine: GameEngineState, userId: string) {
  engine.augmentRuntime ??= {};
  const runtime = engine.augmentRuntime[userId] ?? {};
  engine.augmentRuntime[userId] = runtime;
  return runtime;
}

export function armWormholeOnAcquisition(engine: GameEngineState, userId: string) {
  const runtime = runtimeForWormhole(engine, userId);
  runtime.wormholeNextOpenRound = engine.round;
}

export function applyTurtleAndHarePlacement(
  engineInput: GameEngineState,
  userId: string,
  pieceId: string,
): GameEngineState {
  const engine = clone(engineInput);
  const player = engine.players.find((candidate) => candidate.userId === userId);
  const piece = player?.pieces.find((candidate) => candidate.id === pieceId);
  if (!player || !piece) throw new Error("토끼와 거북이 대상 말을 찾지 못했습니다.");
  if (piece.status !== "WAITING") throw new Error("토끼와 거북이는 대기 중인 말만 선택할 수 있습니다.");

  piece.status = "ON_BOARD";
  piece.node = 29;
  piece.groupId = piece.id;
  piece.hasEntered = true;
  piece.pathHistory = [29];

  engine.augmentRuntime ??= {};
  engine.augmentRuntime[userId] ??= {};
  const runtime = engine.augmentRuntime[userId];
  runtime.turtleLockedUntilRoundByPiece ??= {};
  runtime.turtleLockedUntilRoundByPiece[piece.id] = engine.round + 3;
  engine.lastAction = `${player.displayName}: 토끼와 거북이 · 말 1기를 완주 바로 앞 칸에 배치했습니다.`;
  return engine;
}

function renameGroupRuntimeKey(engine: GameEngineState, userId: string, oldGroupId: string, newGroupId: string) {
  if (oldGroupId === newGroupId) return;
  const runtime = engine.augmentRuntime?.[userId];
  if (!runtime) return;
  const remap = <T>(map: Record<string, T> | undefined) => {
    if (!map || !Object.prototype.hasOwnProperty.call(map, oldGroupId)) return;
    map[newGroupId] = map[oldGroupId];
    delete map[oldGroupId];
  };
  remap(runtime.fixedOneGroups);
  remap(runtime.junctionBoostGroups);
  remap(runtime.sanctuaryGroups);
  remap(runtime.sanctuaryPassBlocks);
  remap(runtime.alleyBlockades);
  remap(runtime.universeCenterGroups);
}

export function applyMarginExit(
  engineInput: GameEngineState,
  userId: string,
  pieceId: string,
  ownedIds: string[],
): GameEngineState {
  if (!ownedIds.includes("AUG-059")) throw new Error("여백의 미 증강을 보유하고 있지 않습니다.");
  if (engineInput.stage !== "AWAITING_ROLL" && engineInput.stage !== "MOVING") {
    throw new Error("현재 단계에서는 여백으로 보낼 수 없습니다.");
  }
  const actor = currentPlayer(engineInput);
  if (actor.userId !== userId) throw new Error("현재 플레이어의 말만 여백으로 보낼 수 있습니다.");

  const engine = clone(engineInput);
  const player = currentPlayer(engine);
  const runtime = runtimeForWormhole(engine, userId);
  if (player.pieces.some((candidate) => candidate.status === "MARGIN")) {
    throw new Error("여백에는 자신의 말 1기만 들어갈 수 있습니다.");
  }
  if (runtime.marginSentTurnNumber === engine.turnNumber) throw new Error("한 턴에는 말 1기만 여백으로 보낼 수 있습니다.");
  const piece = player.pieces.find((candidate) => candidate.id === pieceId);
  if (!piece || piece.status !== "ON_BOARD" || piece.node == null) throw new Error("여백으로 보낼 판 위의 말을 찾지 못했습니다.");
  if (isTurtleGroupLocked(engine, userId, piece.groupId)) throw new Error("토끼와 거북이로 이동 제한 중인 말은 여백으로 보낼 수 없습니다.");

  const originNode = piece.node;
  const oldGroupId = piece.groupId;
  const group = player.pieces.filter((candidate) => candidate.groupId === oldGroupId && candidate.status === "ON_BOARD");
  resetAthleteAccelerationForGroup(engine, userId, oldGroupId, ownedIds);

  if (group.length <= 1) {
    clearGroupMoveFixedToOne(engine, userId, oldGroupId);
    clearJunctionBoostForGroup(engine, userId, oldGroupId);
    clearPathControlForGroup(engine, userId, oldGroupId);
  } else if (piece.id === oldGroupId) {
    const remaining = group.filter((candidate) => candidate.id !== piece.id);
    const newGroupId = remaining[0]?.id;
    if (!newGroupId) throw new Error("여백 분리 후 남은 묶음을 찾지 못했습니다.");
    for (const candidate of remaining) candidate.groupId = newGroupId;
    renameGroupRuntimeKey(engine, userId, oldGroupId, newGroupId);
  }

  piece.status = "MARGIN";
  piece.node = null;
  piece.groupId = piece.id;
  runtime.marginOriginByPiece ??= {};
  runtime.marginOriginByPiece[piece.id] = originNode;
  runtime.marginSentTurnNumber = engine.turnNumber;
  engine.lastAction = `${player.displayName}: 여백의 미 · 말 1기를 ${originNode}번 칸에서 여백으로 보냈습니다.`;
  return engine;
}

export function applyMarginReturn(
  engineInput: GameEngineState,
  userId: string,
  pieceId: string,
  resultId: string,
  ownedIds: string[],
  ownedByUser: Record<string, string[]> = {},
): GameEngineState {
  if (!ownedIds.includes("AUG-059")) throw new Error("여백의 미 증강을 보유하고 있지 않습니다.");
  if (engineInput.stage !== "MOVING") throw new Error("이동 결과가 있을 때만 여백에서 복귀할 수 있습니다.");
  const actor = currentPlayer(engineInput);
  if (actor.userId !== userId) throw new Error("현재 플레이어의 말만 여백에서 복귀할 수 있습니다.");

  const engine = clone(engineInput);
  const player = currentPlayer(engine);
  const runtime = runtimeForWormhole(engine, userId);
  const piece = player.pieces.find((candidate) => candidate.id === pieceId);
  const originNode = runtime.marginOriginByPiece?.[pieceId];
  if (!piece || piece.status !== "MARGIN" || originNode == null) throw new Error("여백에 있는 말을 찾지 못했습니다.");

  const resultIndex = engine.results.findIndex((result) => result.id === resultId);
  if (resultIndex < 0) throw new Error("복귀에 사용할 이동 결과를 찾지 못했습니다.");
  const result = engine.results[resultIndex];
  if (!["DO", "GAE", "GEOL", "YUT", "MO"].includes(result.face) || result.numericPool) {
    throw new Error("여백 복귀에는 도, 개, 걸, 윷, 모 결과만 사용할 수 있습니다.");
  }
  engine.results.splice(resultIndex, 1);

  piece.status = "ON_BOARD";
  piece.node = originNode;
  piece.groupId = piece.id;
  piece.hasEntered = true;
  delete runtime.marginOriginByPiece?.[pieceId];

  const captures = captureAtNode(engine, piece.groupId, originNode, ownedByUser);
  recordEnemyCaptures(engine, userId, captures.captureCount, ownedIds);
  if (captures.attackerReturned) {
    returnMovingGroupAfterEnemyEffect(engine, userId, piece.groupId, ownedIds);
    engine.lastAction = `${player.displayName}: 여백의 미 복귀 · ${originNode}번에서 잡기 후 물귀신으로 대기 복귀`;
    finishResolvedMove(engine, captures.captureExtraRollCount, 0, ownedIds);
    return engine;
  }

  armJunctionBoostAtDestination(engine, userId, piece.groupId, originNode, ownedIds);
  armPathControlAtDestination(engine, userId, piece.groupId, originNode, ownedIds);
  const alliedGroupIds = alliedGroupsAtDestination(engine, userId, piece.groupId, originNode);
  const captureText = captures.captureCount > 0 ? ` · 상대 묶음 ${captures.captureCount}개 잡기` : "";
  engine.lastAction = `${player.displayName}: 여백의 미 · ${originNode}번 칸으로 복귀${captureText}`;
  if (checkSpecialWinner(engine, ownedIds)) return engine;

  if (alliedGroupIds.length > 0) {
    engine.stage = "STACK_CHOICE";
    engine.pendingStackChoice = {
      movingGroupId: piece.groupId,
      destination: originNode,
      alliedGroupIds,
      captureCount: captures.captureCount,
      captureExtraRollCount: captures.captureExtraRollCount,
      augmentExtraRolls: universeRewardRolls,
    };
    return engine;
  }
  finishResolvedMove(engine, captures.captureExtraRollCount, 0, ownedIds);
  return engine;
}

export function isForcedRelocationImmune(ownedIds: string[]) {
  return ownedIds.includes("AUG-037");
}

const GRAVITY_INTERNAL_NODES = [11, 12, 13, 14, 15, 16, 17, 23, 24] as const;

export function applyGravityExplosion(
  engineInput: GameEngineState,
  sourceUserId: string,
  ownedByUser: Record<string, string[]>,
  random: () => number = Math.random,
): GameEngineState {
  const engine = clone(engineInput);
  for (const player of engine.players) {
    if (isForcedRelocationImmune(ownedByUser[player.userId] ?? [])) continue;
    const affectedGroups = new Set(player.pieces.filter((piece) => piece.status === "ON_BOARD").map((piece) => piece.groupId));
    for (const groupId of affectedGroups) {
      clearGroupMoveFixedToOne(engine, player.userId, groupId);
      clearJunctionBoostForGroup(engine, player.userId, groupId);
      clearPathControlForGroup(engine, player.userId, groupId);
      resetAthleteAccelerationForGroup(engine, player.userId, groupId, ownedByUser[player.userId] ?? []);
    }
    for (const piece of player.pieces) {
      if (piece.status !== "ON_BOARD") continue;
      const index = Math.min(GRAVITY_INTERNAL_NODES.length - 1, Math.floor(random() * GRAVITY_INTERNAL_NODES.length));
      piece.node = GRAVITY_INTERNAL_NODES[index] ?? GRAVITY_INTERNAL_NODES[0];
      piece.groupId = piece.id;
      piece.hasEntered = true;
    }
  }
  engine.augmentRuntime ??= {};
  engine.augmentRuntime[sourceUserId] ??= {};
  engine.augmentRuntime[sourceUserId].gravityExplosionResolved = false;
  engine.augmentRuntime[sourceUserId].gravityExplosionRound = engine.round + 3;
  const source = engine.players.find((player) => player.userId === sourceUserId);
  engine.lastAction = `${source?.displayName ?? "플레이어"}: 중력 폭발 · 판 위의 말들이 내부 경로로 흩어졌습니다.`;
  return engine;
}

const GACHA_BOARD_NODES = Array.from({ length: 29 }, (_, index) => index + 1);

export function armGachaMachineOnAcquisition(engine: GameEngineState, userId: string) {
  const runtime = runtimeForWormhole(engine, userId);
  runtime.gachaNextUseRound = engine.round + 1;
}

export function gachaMachineIsReady(engine: GameEngineState, userId: string, ownedIds: string[]) {
  if (!ownedIds.includes("AUG-046")) return false;
  const nextUseRound = engine.augmentRuntime?.[userId]?.gachaNextUseRound;
  return nextUseRound != null && engine.round >= nextUseRound;
}

function clearGachaSingletonRuntime(engine: GameEngineState, userId: string, groupId: string) {
  clearGroupMoveFixedToOne(engine, userId, groupId);
  clearJunctionBoostForGroup(engine, userId, groupId);
  clearPathControlForGroup(engine, userId, groupId);
  const runtime = engine.augmentRuntime?.[userId];
  if (!runtime) return;
  delete runtime.sanctuaryGroups?.[groupId];
  delete runtime.sanctuaryPassBlocks?.[groupId];
  delete runtime.alleyBlockades?.[groupId];
  delete runtime.universeCenterGroups?.[groupId];
}

export function applyGachaMachine(
  engineInput: GameEngineState,
  sourceUserId: string,
  targetUserId: string,
  pieceId: string,
  desiredNode: number,
  ownedByUser: Record<string, string[]>,
  random: () => number = Math.random,
): { engine: GameEngineState; success: boolean; landedNode: number } {
  if (engineInput.stage !== "AWAITING_ROLL" || engineInput.pendingRolls[0] !== "BASIC") {
    throw new Error("뽑기 기계는 기본 던지기 전에 사용할 수 있습니다.");
  }
  const actor = currentPlayer(engineInput);
  const sourceOwned = ownedByUser[sourceUserId] ?? [];
  if (actor.userId !== sourceUserId) throw new Error("현재 플레이어만 뽑기 기계를 사용할 수 있습니다.");
  if (!gachaMachineIsReady(engineInput, sourceUserId, sourceOwned)) throw new Error("아직 뽑기 기계를 사용할 수 없습니다.");
  if (!GACHA_BOARD_NODES.includes(desiredNode)) throw new Error("지정 위치는 판 위의 유효 칸이어야 합니다.");

  const engine = clone(engineInput);
  const targetPlayer = engine.players.find((player) => player.userId === targetUserId);
  const piece = targetPlayer?.pieces.find((candidate) => candidate.id === pieceId);
  if (!targetPlayer || !piece || piece.status !== "ON_BOARD" || piece.node == null) {
    throw new Error("뽑기 기계로 이동할 판 위의 말을 찾지 못했습니다.");
  }
  if (isForcedRelocationImmune(ownedByUser[targetUserId] ?? [])) {
    throw new Error("고가도로 효과로 강제 이동할 수 없는 말입니다.");
  }

  const oldGroupId = piece.groupId;
  const group = targetPlayer.pieces.filter((candidate) => candidate.status === "ON_BOARD" && candidate.groupId === oldGroupId);
  resetAthleteAccelerationForGroup(engine, targetUserId, oldGroupId, ownedByUser[targetUserId] ?? []);
  if (group.length <= 1) {
    clearGachaSingletonRuntime(engine, targetUserId, oldGroupId);
  } else if (piece.id === oldGroupId) {
    const remaining = group.filter((candidate) => candidate.id !== piece.id);
    const newGroupId = remaining[0]?.id;
    if (!newGroupId) throw new Error("뽑기 기계 분리 후 남은 묶음을 찾지 못했습니다.");
    for (const candidate of remaining) candidate.groupId = newGroupId;
    renameGroupRuntimeKey(engine, targetUserId, oldGroupId, newGroupId);
  }

  const success = random() < 0.2;
  let landedNode = desiredNode;
  if (!success) {
    const failureNodes = GACHA_BOARD_NODES.filter((node) => node !== desiredNode);
    const index = Math.min(failureNodes.length - 1, Math.floor(random() * failureNodes.length));
    landedNode = failureNodes[index] ?? failureNodes[0] ?? desiredNode;
  }

  piece.status = "ON_BOARD";
  piece.node = landedNode;
  piece.groupId = piece.id;
  piece.hasEntered = true;

  const sourceRuntime = runtimeForWormhole(engine, sourceUserId);
  sourceRuntime.gachaNextUseRound = engine.round + 2;
  const source = engine.players.find((player) => player.userId === sourceUserId);
  engine.lastAction = `${source?.displayName ?? "플레이어"}: 뽑기 기계 · ${success ? "성공" : "실패"} · 말 1기를 ${landedNode}번 칸으로 강제 이동`;
  return { engine, success, landedNode };
}

const UPHEAVAL_BOARD_NODES = Array.from({ length: 29 }, (_, index) => index + 1);

export function applyGreatUpheaval(
  engineInput: GameEngineState,
  sourceUserId: string,
  ownedByUser: Record<string, string[]>,
  setupsByUser: Record<string, PlayerAugmentSetups> = {},
  random: () => number = Math.random,
): GameEngineState {
  const engine = clone(engineInput);

  for (const player of engine.players) {
    if (isForcedRelocationImmune(ownedByUser[player.userId] ?? [])) continue;
    const oldGroupIds = new Set(player.pieces.map((piece) => piece.groupId));
    for (const groupId of oldGroupIds) {
      clearGroupMoveFixedToOne(engine, player.userId, groupId);
      clearJunctionBoostForGroup(engine, player.userId, groupId);
      clearPathControlForGroup(engine, player.userId, groupId);
      resetAthleteAccelerationForGroup(engine, player.userId, groupId, ownedByUser[player.userId] ?? []);
    }

    const runtime = engine.augmentRuntime?.[player.userId];
    if (runtime) {
      runtime.fixedOneGroups = {};
      runtime.junctionBoostGroups = {};
      runtime.sanctuaryGroups = {};
      runtime.universeCenterGroups = {};
      runtime.wormholeTransit = {};
      runtime.marginOriginByPiece = {};
    }

    for (const piece of player.pieces) {
      const stateRoll = Math.min(2, Math.floor(random() * 3));
      piece.groupId = piece.id;
      piece.pathHistory = [];

      if (stateRoll === 0) {
        piece.status = "WAITING";
        piece.node = null;
        piece.hasEntered = false;
        continue;
      }

      if (stateRoll === 1) {
        const nodeIndex = Math.min(UPHEAVAL_BOARD_NODES.length - 1, Math.floor(random() * UPHEAVAL_BOARD_NODES.length));
        piece.status = "ON_BOARD";
        piece.node = UPHEAVAL_BOARD_NODES[nodeIndex] ?? 1;
        piece.hasEntered = true;
        continue;
      }

      piece.status = "FINISHED";
      piece.node = null;
      piece.hasEntered = true;
    }
  }

  returnFinishedBetrayals(engine);

  // AUG-041 replaces normal completion with laps. AUG-051 can place the designated runner
  // directly into FINISHED, so normalize that through the same lap resolver used by moves.
  for (const player of engine.players) {
    const owned = ownedByUser[player.userId] ?? [];
    if (!owned.includes("AUG-041")) continue;
    const setups = setupsByUser[player.userId] ?? {};
    const representativeId = setups["AUG-041"]?.pieceId;
    const representative = player.pieces.find((piece) => piece.id === representativeId);
    if (!representative || representative.status !== "FINISHED") continue;
    const lap = resolveSoloLap(engine, [representative], owned, setups);
    if (lap === "WIN") return engine;
  }

  // The reshuffle can itself complete a normal win. If more than one player completes
  // simultaneously, the AUG-051 owner takes priority, then normal seat order.
  const orderedPlayers = [...engine.players].sort((left, right) => {
    if (left.userId === sourceUserId) return -1;
    if (right.userId === sourceUserId) return 1;
    return left.seat - right.seat;
  });

  for (const player of orderedPlayers) {
    const owned = ownedByUser[player.userId] ?? [];
    if (
      isForcedRelocationImmune(owned)
      || owned.includes("AUG-041")
      || !replacesNormalWinCondition(owned)
    ) continue;
    const special = specialWinForPlayer(engine, player.userId, owned);
    if (!special) continue;
    declareWinner(engine, player.userId, special.condition, special.message);
    return engine;
  }

  for (const player of orderedPlayers) {
    const owned = ownedByUser[player.userId] ?? [];
    if (owned.includes("AUG-031") || replacesNormalWinCondition(owned)) continue;
    if (!player.pieces.every((piece) => piece.status === "FINISHED")) continue;
    declareWinner(engine, player.userId, "NORMAL", `${player.displayName}: 대격변으로 모든 말이 완주했습니다!`);
    return engine;
  }

  const source = engine.players.find((player) => player.userId === sourceUserId);
  engine.lastAction = `${source?.displayName ?? "플레이어"}: 대격변 · 모든 말의 상태와 위치가 무작위로 재배치되었습니다.`;
  return engine;
}

export function applyBombExplosion(
  engineInput: GameEngineState,
  bombOwnerUserIds: string[],
  ownedByUser: Record<string, string[]>,
): { engine: GameEngineState; caughtGroupsByUser: Record<string, number>; bonusRollsByUser: Record<string, number> } {
  const engine = clone(engineInput);
  const caughtGroupsByUser: Record<string, number> = {};
  const bonusRollsByUser: Record<string, number> = {};
  const playerCount = engine.players.length;
  const divisor = playerCount === 2 ? 1 : playerCount === 3 ? 2 : 3;

  for (const ownerUserId of bombOwnerUserIds) {
    const groups = new Set<string>();
    for (const player of engineInput.players) {
      if (player.userId === ownerUserId) continue;
      for (const piece of player.pieces) {
        if (piece.status === "ON_BOARD") groups.add(`${player.userId}:${piece.groupId}`);
      }
    }
    caughtGroupsByUser[ownerUserId] = groups.size;
    bonusRollsByUser[ownerUserId] = Math.floor(groups.size / divisor);
  }

  for (const player of engine.players) {
    const owned = ownedByUser[player.userId] ?? [];
    const boardGroups = new Set(player.pieces.filter((piece) => piece.status === "ON_BOARD").map((piece) => piece.groupId));
    for (const groupId of boardGroups) {
      clearGroupMoveFixedToOne(engine, player.userId, groupId);
      clearJunctionBoostForGroup(engine, player.userId, groupId);
      clearPathControlForGroup(engine, player.userId, groupId);
      resetAthleteAccelerationForGroup(engine, player.userId, groupId, owned);
      clearTurtleLockForGroup(engine, player.userId, groupId);
      clearPlagueForGroup(engine, player.userId, groupId);
    }
    for (const piece of player.pieces) {
      if (piece.status !== "ON_BOARD") continue;
      piece.status = "WAITING";
      piece.node = null;
      piece.groupId = piece.id;
    }
  }

  for (const ownerUserId of bombOwnerUserIds) {
    const runtime = runtimeForWormhole(engine, ownerUserId);
    runtime.bombResolved = true;
    runtime.bombBonusRollsPending = (runtime.bombBonusRollsPending ?? 0) + (bonusRollsByUser[ownerUserId] ?? 0);
  }

  const labels = bombOwnerUserIds.map((ownerUserId) => {
    const player = engine.players.find((candidate) => candidate.userId === ownerUserId);
    return `${player?.displayName ?? ownerUserId} ${caughtGroupsByUser[ownerUserId] ?? 0}묶음`;
  });
  engine.lastAction = `폭탄! · 판 위의 말을 대기로 복귀 · ${labels.join(" / ")}`;
  return { engine, caughtGroupsByUser, bonusRollsByUser };
}

export function wormholeIsOpen(engine: GameEngineState, userId: string, ownedIds: string[]) {
  if (!ownedIds.includes("AUG-056")) return false;
  const nextOpen = engine.augmentRuntime?.[userId]?.wormholeNextOpenRound;
  return nextOpen != null && engine.round >= nextOpen;
}

export function expireWormholeForCurrentRound(
  engineInput: GameEngineState,
  userId: string,
  ownedIds: string[],
) {
  if (!wormholeIsOpen(engineInput, userId, ownedIds)) return engineInput;
  const engine = clone(engineInput);
  const runtime = runtimeForWormhole(engine, userId);
  runtime.wormholeNextOpenRound = engine.round + 2;
  return engine;
}

type WormholeReturnCandidate = { node: number | null; finished: boolean; home: boolean };

function wormholeReturnCandidates(originNode: number, moonwalk: boolean): WormholeReturnCandidate[] {
  const candidates = new Map<string, WormholeReturnCandidate>();
  for (let steps = 3; steps <= 18; steps += 1) {
    if (moonwalk) {
      for (const move of reverseMoveOptions(originNode, steps)) {
        const candidate = { node: move.node, finished: false, home: move.home };
        const key = move.home ? "HOME" : `N:${move.node}`;
        if (!candidates.has(key)) candidates.set(key, candidate);
      }
    } else {
      for (const move of forwardMoveOptions(originNode, steps)) {
        const candidate = { node: move.node, finished: move.finished, home: false };
        const key = move.finished ? "FINISH" : `N:${move.node}`;
        if (!candidates.has(key)) candidates.set(key, candidate);
      }
    }
  }
  return [...candidates.values()];
}

export function applyWormholeTurn(
  engineInput: GameEngineState,
  userId: string,
  groupId: string,
  ownedIds: string[],
): GameEngineState {
  if (engineInput.stage !== "AWAITING_ROLL" || engineInput.pendingRolls[0] !== "BASIC") {
    throw new Error("웜홀은 기본 던지기 전에만 사용할 수 있습니다.");
  }
  const actor = currentPlayer(engineInput);
  if (actor.userId !== userId) throw new Error("현재 플레이어의 웜홀만 사용할 수 있습니다.");
  if (!wormholeIsOpen(engineInput, userId, ownedIds)) throw new Error("현재 라운드에는 웜홀이 열려 있지 않습니다.");

  const engine = clone(engineInput);
  const player = currentPlayer(engine);
  const group = player.pieces.filter((piece) => piece.groupId === groupId && piece.status === "ON_BOARD" && piece.node != null);
  if (!group.length) throw new Error("웜홀에 보낼 판 위의 말 묶음을 찾지 못했습니다.");
  const originNode = group[0].node;
  if (originNode == null || group.some((piece) => piece.node !== originNode)) throw new Error("웜홀 묶음 위치가 일치하지 않습니다.");

  if (engine.results.length > 0) {
    const hasOtherOnBoardPiece = player.pieces.some((piece) => (
      piece.groupId !== groupId && piece.status === "ON_BOARD"
    ));
    const hasWaitingPiece = player.pieces.some((piece) => piece.status === "WAITING");
    const hasForwardResult = engine.results.some((result) => (
      !result.numericPool && ["DO", "GAE", "GEOL", "YUT", "MO"].includes(result.face)
    ));
    const hasOtherResultCompatiblePiece = hasOtherOnBoardPiece || (hasWaitingPiece && hasForwardResult);
    const hasMarginReturn = ownedIds.includes("AUG-059")
      && player.pieces.some((piece) => piece.status === "MARGIN")
      && engine.results.some((result) => !result.numericPool && ["DO", "GAE", "GEOL", "YUT", "MO"].includes(result.face));
    if (!hasOtherResultCompatiblePiece && !hasMarginReturn) {
      throw new Error("남아 있는 이동 결과를 사용할 말이 없어 웜홀에 보낼 수 없습니다.");
    }
  }

  clearJunctionBoostForGroup(engine, userId, groupId);
  clearPathControlForGroup(engine, userId, groupId);
  resetAthleteAccelerationForGroup(engine, userId, groupId, ownedIds);

  const runtime = runtimeForWormhole(engine, userId);
  runtime.wormholeTransit ??= {};
  runtime.wormholeTransit[groupId] = {
    returnRound: engine.round + 1,
    originNode,
    pieceIds: group.map((piece) => piece.id),
  };
  runtime.wormholeNextOpenRound = engine.round + 2;

  for (const piece of group) {
    piece.status = "WORMHOLE";
    piece.node = null;
  }

  // AUG-056 replaces only the BASIC throw. Existing non-roll movement results, if any, remain usable.
  engine.pendingRolls.shift();
  engine.pendingRollChoice = null;
  if (engine.pendingRolls.length > 0) {
    engine.stage = "AWAITING_ROLL";
  } else if (engine.results.length > 0) {
    engine.stage = "MOVING";
  } else {
    advanceTurn(engine);
  }
  engine.lastAction = `${player.displayName}: 웜홀 · 말 ${group.length}개 묶음이 1라운드 동안 사라집니다.`;
  return engine;
}

export function resolveDueWormholeReturns(
  engineInput: GameEngineState,
  userId: string,
  ownedIds: string[],
  setups: PlayerAugmentSetups = {},
  random: () => number = Math.random,
): GameEngineState {
  if (!ownedIds.includes("AUG-056")) return engineInput;
  const transit = engineInput.augmentRuntime?.[userId]?.wormholeTransit;
  if (!transit) return engineInput;
  const due = Object.entries(transit).filter(([, item]) => item.returnRound <= engineInput.round);
  if (!due.length) return engineInput;

  const engine = clone(engineInput);
  const runtime = runtimeForWormhole(engine, userId);
  const player = engine.players.find((candidate) => candidate.userId === userId);
  if (!player) return engineInput;
  const messages: string[] = [];

  for (const [groupId, item] of due) {
    const pieces = player.pieces.filter((piece) => item.pieceIds.includes(piece.id) && piece.status === "WORMHOLE");
    if (!pieces.length) {
      if (runtime.wormholeTransit) delete runtime.wormholeTransit[groupId];
      continue;
    }
    const moonwalk = ownedIds.includes("AUG-031");
    const candidates = wormholeReturnCandidates(item.originNode, moonwalk);
    if (!candidates.length) throw new Error("웜홀 복귀 위치를 찾지 못했습니다.");
    const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
    const selected = candidates[index] ?? candidates[0];

    if (selected.home) {
      for (const piece of pieces) {
        piece.status = "WAITING";
        piece.node = null;
        piece.groupId = piece.id;
        piece.hasEntered = true;
      }
      messages.push(`${pieces.length}개 말이 출발점으로 복귀`);
    } else if (selected.finished) {
      for (const piece of pieces) {
        piece.status = "FINISHED";
        piece.node = null;
        piece.hasEntered = true;
      }
      const soloLap = resolveSoloLap(engine, pieces, ownedIds, setups);
      if (!soloLap) recordEchoFinish(engine, userId, groupId, true, ownedIds);
      messages.push(soloLap === "LAP"
        ? `${pieces.length}개 말이 웜홀 복귀로 독주 한 바퀴를 완주`
        : `${pieces.length}개 말이 완주`);
    } else {
      if (selected.node == null) throw new Error("웜홀 복귀 칸이 비어 있습니다.");
      for (const piece of pieces) {
        piece.status = "ON_BOARD";
        piece.node = selected.node;
        piece.hasEntered = true;
      }
      messages.push(`${pieces.length}개 말이 ${selected.node}번에 등장`);
    }
    if (runtime.wormholeTransit) delete runtime.wormholeTransit[groupId];
  }

  if (checkSpecialWinner(engine, ownedIds) || checkBasicWinner(engine, ownedIds)) return engine;
  engine.lastAction = `${player.displayName}: 웜홀 복귀 · ${messages.join(" / ")}`;
  return engine;
}

function allPieces(engine: GameEngineState) {
  return engine.players.flatMap((player) => player.pieces);
}

function returnFinishedBetrayals(engine: GameEngineState) {
  const returns = engine.players.flatMap((holder) => holder.pieces
    .filter((piece) => (
      piece.status === "FINISHED"
      && piece.betrayalOriginalOwnerUserId != null
      && piece.betrayalOriginalOwnerUserId !== holder.userId
    ))
    .map((piece) => ({
      holderUserId: holder.userId,
      pieceId: piece.id,
      originalOwnerUserId: piece.betrayalOriginalOwnerUserId!,
    })));

  let returned = 0;
  for (const item of returns) {
    const holder = engine.players.find((player) => player.userId === item.holderUserId);
    const originalOwner = engine.players.find((player) => player.userId === item.originalOwnerUserId);
    if (!holder || !originalOwner) throw new Error("배반 말 반환에 필요한 플레이어를 찾지 못했습니다.");
    const index = holder.pieces.findIndex((piece) => piece.id === item.pieceId);
    if (index < 0) continue;
    const departing = holder.pieces[index];
    if (!departing) continue;
    rehomeGroupAfterPieceRemoval(engine, holder.userId, departing.id, departing.groupId);
    const [piece] = holder.pieces.splice(index, 1);
    if (!piece) continue;

    // Finishing clears temporary per-holder piece states before control is returned.
    for (const runtime of Object.values(engine.augmentRuntime ?? {})) {
      if (runtime.plaguePieceIds) delete runtime.plaguePieceIds[piece.id];
      if (runtime.turtleLockedUntilRoundByPiece) delete runtime.turtleLockedUntilRoundByPiece[piece.id];
      if (runtime.marginOriginByPiece) delete runtime.marginOriginByPiece[piece.id];
    }

    piece.ownerUserId = originalOwner.userId;
    piece.seat = originalOwner.seat;
    piece.status = "WAITING";
    piece.node = null;
    piece.groupId = piece.id;
    piece.hasEntered = false;
    piece.pathHistory = [];
    delete piece.betrayalOriginalOwnerUserId;
    originalOwner.pieces.push(piece);
    returned += 1;
  }

  return returned;
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

export function discardUnusableResults(
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
  if (ownedIds.includes("AUG-031") && isMoonwalkHome(engine, player.userId)) {
    declareWinner(engine, player.userId, "MOONWALK", `${player.displayName}: 문워크 · 모든 말을 대기로 되돌렸습니다!`);
    return player.userId;
  }
  const result = specialWinForPlayer(engine, player.userId, ownedIds);
  if (!result) return null;
  declareWinner(engine, player.userId, result.condition, result.message);
  return player.userId;
}

function checkBasicWinner(engine: GameEngineState, ownedIds: string[]) {
  if (ownedIds.includes("AUG-031") || replacesNormalWinCondition(ownedIds)) return null;
  const player = currentPlayer(engine);
  if (player.pieces.every((piece) => piece.status === "FINISHED")) {
    declareWinner(engine, player.userId, "NORMAL", `${player.displayName} 승리!`);
    return player.userId;
  }
  return null;
}

export function advanceTurn(engine: GameEngineState) {
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
  if (consumeFaceExtraRollGrant(engine, player.userId, face, ownedIds)) engine.pendingRolls.push("YUT_MO");
  engine.lastAction = `${player.displayName}: ${faceLabel(face)}`;
  settleAfterRollQueue(engine, ownedIds, setups);
  return engine;
}

function groupPieces(engine: GameEngineState, groupId: string, includeFinished = false) {
  return currentPlayer(engine).pieces.filter((piece) => (
    piece.groupId === groupId
    && (piece.status === "WAITING" || piece.status === "ON_BOARD" || (includeFinished && piece.status === "FINISHED"))
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

function marginShrinkState(engine: GameEngineState, userId: string, ownedIds: string[]) {
  if (!ownedIds.includes("AUG-059")) return null;
  const player = engine.players.find((candidate) => candidate.userId === userId);
  const finishedCount = Math.min(3, player?.pieces.filter((piece) => piece.status === "FINISHED").length ?? 0);
  if (finishedCount <= 0) return null;
  if (finishedCount === 1) return { finishNode: 22, allowed: new Set([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]) };
  if (finishedCount === 2) return { finishNode: 10, allowed: new Set([1,2,3,4,5,6,7,8,9,10]) };
  return { finishNode: 5, allowed: new Set([1,2,3,4,5]) };
}

function applyMarginShrinkToForwardMove(
  movement: ReturnType<typeof forwardMoveOptions>[number],
  shrink: ReturnType<typeof marginShrinkState>,
) {
  if (!shrink) return movement;

  if (shrink.finishNode === 22) {
    const centerIndex = movement.traversed.indexOf(15);
    const removedSuffix = centerIndex >= 0 ? movement.traversed.slice(centerIndex + 1) : [];
    if (centerIndex >= 0 && removedSuffix.some((node) => !shrink.allowed.has(node))) {
      const survivingSuffix = [16, 17, 22].slice(0, removedSuffix.length);
      const rerouted = [
        ...movement.traversed.slice(0, centerIndex + 1),
        ...survivingSuffix,
      ];
      const reroutedFinishIndex = rerouted.indexOf(22);
      if (reroutedFinishIndex >= 0) {
        return {
          ...movement,
          finished: true,
          node: null,
          traversed: rerouted.slice(0, reroutedFinishIndex + 1),
        };
      }
      return {
        ...movement,
        finished: false,
        node: rerouted[rerouted.length - 1] ?? 15,
        traversed: rerouted,
      };
    }
  }

  const finishIndex = movement.traversed.indexOf(shrink.finishNode);
  if (finishIndex >= 0) {
    return { ...movement, finished: true, node: null, traversed: movement.traversed.slice(0, finishIndex + 1) };
  }
  if (movement.traversed.some((node) => !shrink.allowed.has(node))) return null;
  return movement;
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
  const shrink = marginShrinkState(engine, userId, ownedIds);
  if (shrink && start === shrink.finishNode) {
    return [{ target: { node: null, finished: true, kind: "FORCED", path: [] }, interruption: null }];
  }
  if (shrink && start > 0 && !shrink.allowed.has(start)) {
    return [{ target: { node: null, finished: true, kind: "FORCED", path: [] }, interruption: null }];
  }
  const shrinkMovements = (forbidShortcutEntry: boolean) => forwardMoveOptions(start, result.finalSteps, {
    forbidShortcutEntry,
    allowPassingShortcutEntry: ownedIds.includes("AUG-036"),
    allowUniversalCenterChoice: ownedIds.includes("AUG-033"),
  })
    .map((movement) => applyMarginShrinkToForwardMove(movement, shrink))
    .filter((movement): movement is NonNullable<typeof movement> => movement != null);
  let movements = shrinkMovements(Boolean(result.forbidShortcuts));
  if (shrink && movements.length === 0 && !result.forbidShortcuts) {
    movements = shrinkMovements(true);
  }
  if (shrink && movements.length === 0 && start === 15 && shrink.finishNode === 22) {
    movements = forwardMoveOptions(14, result.finalSteps + 1, {
      forbidShortcutEntry: true,
      allowPassingShortcutEntry: false,
      allowUniversalCenterChoice: false,
    })
      .map((movement) => ({
        ...movement,
        traversed: movement.traversed[0] === 15 ? movement.traversed.slice(1) : movement.traversed,
      }))
      .map((movement) => applyMarginShrinkToForwardMove(movement, shrink))
      .filter((movement): movement is NonNullable<typeof movement> => movement != null);
  }
  const echoMovements = movements.filter((movement) => (
    echoAllowsForwardPath(engine, userId, piece, start, movement.traversed, ownedIds)
  ));
  // If another effect makes the stored route impossible, that forced route takes priority.
  const routedMovements = echoMovements.length > 0 ? echoMovements : movements;
  const plans: ForwardTargetPlan[] = [];

  for (const movement of routedMovements) {
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

    const chaseTargets = ownedIds.includes("AUG-025")
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
    allowPassingShortcutEntry: ownedIds.includes("AUG-036"),
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

    const chaseTargets = ownedIds.includes("AUG-025")
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

export function adjustedResultForMove(
  engine: GameEngineState,
  userId: string,
  groupId: string,
  result: RollToken,
  ownedIds: string[],
  setups: PlayerAugmentSetups,
) {
  const adjusted = adjustedResultForGroup(engine, userId, groupId, result, ownedIds, setups);
  if (!ownedIds.includes("AUG-031") || result.face === "BACKDO") return adjusted;
  const player = engine.players.find((candidate) => candidate.userId === userId);
  const group = player?.pieces.filter((piece) => piece.groupId === groupId) ?? [];
  if (!group.length || !group.every((piece) => piece.status === "FINISHED")) return adjusted;

  let bonus = 0;
  if (ownedIds.includes("AUG-065") && group.length >= 2) bonus += group.length - 1;
  else if (ownedIds.includes("AUG-023") && group.length >= 2) bonus += 1;
  const acePieceId = setups["AUG-030"]?.pieceId;
  if (ownedIds.includes("AUG-030") && acePieceId && group.some((piece) => piece.id === acePieceId)) bonus += 1;
  if (ownedIds.includes("AUG-037")) bonus += 2;
  return {
    ...result,
    finalSteps: result.finalSteps + bonus,
    forbidShortcuts: ownedIds.includes("AUG-037") || result.forbidShortcuts,
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
  if (piece.status === "WAITING" && isPlagueGroup(engine, userId, piece.groupId) && !["GEOL", "YUT", "MO"].includes(result.face)) return [];
  if (result.face !== "BACKDO" && result.finalSteps <= 0 && isPlagueGroup(engine, userId, piece.groupId)) {
    return [{ node: null, finished: false, kind: "FORCED", path: [] }];
  }
  if (ownedIds.includes("AUG-031")) {
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


export type EngineLegalMoveOption = {
  groupId: string;
  result: RollToken;
  target: EngineMoveTarget;
};

export function legalMoveOptionsWithAugments(
  engine: GameEngineState,
  userId: string,
  ownedIds: string[] = [],
  setups: PlayerAugmentSetups = {},
  ownedByUser: Record<string, string[]> = {},
  movementOwnedIds: string[] = ownedIds,
): EngineLegalMoveOption[] {
  if (engine.stage !== "MOVING") return [];
  const player = engine.players.find((candidate) => candidate.userId === userId && candidate.seat === engine.currentSeat);
  if (!player) return [];
  const moonwalk = ownedIds.includes("AUG-031");
  const options: EngineLegalMoveOption[] = [];

  for (const result of engine.results) {
    if (result.numericPool) continue;
    const seen = new Set<string>();
    for (const piece of player.pieces) {
      if (seen.has(piece.groupId)) continue;
      if (piece.status === "WORMHOLE" || piece.status === "MARGIN") continue;
      if (piece.status === "FINISHED" && !moonwalk) continue;
      seen.add(piece.groupId);

      if (!moonwalk && !isGroupUsableWithAugments(engine, userId, piece.groupId, ownedIds, setups)) continue;
      if (result.forbiddenPieceIds?.some((pieceId) => player.pieces.some((candidate) => (
        candidate.groupId === piece.groupId
        && candidate.id === pieceId
        && candidate.status !== "FINISHED"
      )))) continue;

      const effective = adjustedResultForMove(
        engine,
        userId,
        piece.groupId,
        result,
        movementOwnedIds,
        setups,
      );
      for (const target of legalMoveTargetsWithAugments(
        engine,
        userId,
        piece,
        effective,
        movementOwnedIds,
        ownedByUser,
      )) {
        options.push({ groupId: piece.groupId, result, target });
      }
    }
  }

  return options;
}

export function discardMovementResultsWhenNoLegalMove(
  engineInput: GameEngineState,
  userId: string,
  ownedIds: string[] = [],
  setups: PlayerAugmentSetups = {},
  ownedByUser: Record<string, string[]> = {},
  movementOwnedIds: string[] = ownedIds,
): GameEngineState {
  if (engineInput.stage !== "MOVING") return engineInput;
  if (legalMoveOptionsWithAugments(
    engineInput,
    userId,
    ownedIds,
    setups,
    ownedByUser,
    movementOwnedIds,
  ).length > 0) return engineInput;

  const engine = clone(engineInput);
  const actor = currentPlayer(engine);
  engine.results = [];
  if (engine.pendingRolls.length > 0) {
    engine.stage = "AWAITING_ROLL";
    engine.lastAction = `${actor.displayName}: 사용할 수 있는 이동 결과가 없어 결과 소멸`;
  } else {
    advanceTurn(engine);
    engine.lastAction = `${actor.displayName}: 사용할 수 있는 이동 결과가 없어 결과 소멸 · ${currentPlayer(engine).displayName}의 턴`;
  }
  return engine;
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
      if (!victimOwned.includes("AUG-064")) continue;
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
  const moverOwned = ownedByUser[mover.userId] ?? [];

  for (const capturedGroup of opponentGroupsAtNode(engine, mover.userId, node)) {
    const victim = capturedGroup[0];
    if (!victim) continue;
    const victimOwned = ownedByUser[victim.ownerUserId] ?? [];
    if (isSanctuaryGroup(engine, victim.ownerUserId, victim.groupId, node)) continue;
    if (isCaptureImmune(engine, victim.ownerUserId, victimOwned)) continue;
    if (consumeBreakthroughCaptureBlock(engine, victim.ownerUserId, victimOwned)) continue;

    captureCount += 1;
    if (!blocksCaptureExtraRoll(capturedGroup.length, victimOwned)) captureExtraRollCount += 1;
    captureExtraRollCount += betrayalCaptureBonusRoll(engine, mover.userId, movingGroupId, victim.ownerUserId);
    recordCaptureAgainstPlayer(engine, victim.ownerUserId, victimOwned);
    applyWaterGhostOne(engine, mover.userId, movingGroupId, victimOwned);
    if (shouldReturnAttackerWithWaterGhostTwo(victimOwned)) attackerReturned = true;
    clearGroupMoveFixedToOne(engine, victim.ownerUserId, victim.groupId);
    clearJunctionBoostForGroup(engine, victim.ownerUserId, victim.groupId);
    clearPathControlForGroup(engine, victim.ownerUserId, victim.groupId);
    resetAthleteAccelerationForGroup(engine, victim.ownerUserId, victim.groupId, victimOwned);
    clearTurtleLockForGroup(engine, victim.ownerUserId, victim.groupId);

    const capturedPieceIds = capturedGroup.map((piece) => piece.id);
    clearPlagueForGroup(engine, victim.ownerUserId, victim.groupId);
    returnPiecesAfterEnemyCapture(capturedGroup, victimOwned);
    if (moverOwned.includes("AUG-057")) infectPlaguePieceIds(engine, victim.ownerUserId, capturedPieceIds);
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
  resetAthleteAccelerationForGroup(engine, userId, groupId, ownedIds);
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
  )].filter((groupId) => !isTurtleGroupLocked(engine, moverUserId, groupId));
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
    if (isTurtleGroupLocked(engine, userId, groupId)) continue;
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
  const actorGroups = playerBoardGroups(engine, userId);
  const movingGroupSize = actorGroups.get(movingGroupId)?.length ?? 0;
  const fitsStackLimit = (candidateGroupId: string, maxPieces: number) => (
    movingGroupSize + (actorGroups.get(candidateGroupId)?.length ?? 0) <= maxPieces
  );

  if (ownedIds.includes("AUG-015")) {
    const neighborNodes = new Set<number>();
    const previousNode = actualPath.length >= 2
      ? actualPath[actualPath.length - 2]
      : startNode > 0 && startNode !== destination
        ? startNode
        : null;
    if (previousNode != null && previousNode !== FINISH_NODE) neighborNodes.add(previousNode);

    if (ownedIds.includes("AUG-031")) {
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
    const candidates = candidateGroupsAtNodes(engine, userId, movingGroupId, neighborNodes, true)
      .filter((groupId) => fitsStackLimit(groupId, 2));
    if (candidates.length) opportunities.push({ kind: "FRIEND", candidateGroupIds: candidates });
  }

  if (ownedIds.includes("AUG-066")) {
    const passedNodes = new Set(actualPath.filter((node) => node !== destination));
    const candidates = candidateGroupsAtNodes(engine, userId, movingGroupId, passedNodes, false)
      .filter((groupId) => fitsStackLimit(groupId, 3));
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

function nearestOuterCorner(node: number) {
  const source = BOARD_POSITIONS[node];
  const corners = [5, 10, 22, 29];
  if (!source) return 29;
  return corners
    .map((corner) => {
      const point = BOARD_POSITIONS[corner];
      const distance = point ? Math.abs(source.x - point.x) + Math.abs(source.y - point.y) : Number.POSITIVE_INFINITY;
      return { corner, distance };
    })
    .sort((left, right) => left.distance - right.distance || left.corner - right.corner)[0]?.corner ?? 29;
}

function applyUniverseCenterRewards(engine: GameEngineState, userId: string, ownedIds: string[]) {
  if (!ownedIds.includes("AUG-033")) return 0;
  const player = engine.players.find((candidate) => candidate.userId === userId);
  if (!player) return 0;
  const centerCount = player.pieces.filter((piece) => piece.status === "ON_BOARD" && piece.node === 15).length;
  const runtime = runtimeForWormhole(engine, userId);
  const previousLevel = runtime.universeCenterRewardLevel ?? 0;
  const nextLevel = Math.max(previousLevel, Math.min(3, centerCount));
  if (nextLevel <= previousLevel) return 0;
  let bonusRolls = 0;
  for (let level = previousLevel + 1; level <= nextLevel; level += 1) {
    if (level === 1) bonusRolls += 1;
    if (level === 2) {
      bonusRolls += 1;
      for (const opponent of engine.players) {
        if (opponent.userId === userId) continue;
        const opponentRuntime = runtimeForWormhole(engine, opponent.userId);
        opponentRuntime.universeFreezeTurnsRemaining = Math.max(1, opponentRuntime.universeFreezeTurnsRemaining ?? 0);
      }
    }
    if (level === 3) {
      const remaining = player.pieces.find((piece) => !(piece.status === "ON_BOARD" && piece.node === 15));
      if (remaining) {
        const oldGroupId = remaining.groupId;
        if (remaining.status === "ON_BOARD") {
          clearGroupMoveFixedToOne(engine, userId, oldGroupId);
          clearJunctionBoostForGroup(engine, userId, oldGroupId);
          clearPathControlForGroup(engine, userId, oldGroupId);
          resetAthleteAccelerationForGroup(engine, userId, oldGroupId, ownedIds);
        }
        const destination = remaining.status === "WAITING" || remaining.node == null ? 29 : nearestOuterCorner(remaining.node);
        remaining.status = "ON_BOARD";
        remaining.node = destination;
        remaining.groupId = remaining.id;
        remaining.hasEntered = true;
        remaining.pathHistory.push(destination);
      }
    }
  }
  runtime.universeCenterRewardLevel = nextLevel;
  return bonusRolls;
}

function finishResolvedMove(engine: GameEngineState, captureExtraRollCount: number, augmentExtraRolls = 0, ownedIds: string[] = []) {
  const betrayalReturns = returnFinishedBetrayals(engine);
  if (betrayalReturns > 0) engine.lastAction += ` · 배반 말 ${betrayalReturns}개가 원래 주인의 대기로 돌아갔습니다.`;
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
  if (!ownedIds.includes("AUG-041")) return null;
  const representativeId = setups["AUG-041"]?.pieceId;
  if (!representativeId || !group.some((piece) => piece.id === representativeId)) return null;
  const player = engine.players.find((candidate) => (
    candidate.pieces.some((piece) => piece.id === representativeId)
  ));
  if (!player) return null;
  engine.augmentRuntime ??= {};
  const runtime = engine.augmentRuntime[player.userId] ?? {};
  engine.augmentRuntime[player.userId] = runtime;
  runtime.soloLaps = (runtime.soloLaps ?? 0) + 1;
  if (runtime.soloLaps >= 3) {
    declareWinner(engine, player.userId, "SOLO_RUN", `${player.displayName}: 독주 3바퀴 완주!`);
    return "WIN" as const;
  }
  const representative = player.pieces.find((piece) => piece.id === representativeId);
  if (representative) {
    representative.status = "WAITING";
    representative.node = null;
    representative.groupId = representative.id;
  }
  engine.lastAction = `${player.displayName}: 독주 ${runtime.soloLaps}바퀴 완주 · ${3 - runtime.soloLaps}바퀴 남음`;
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
  const moonwalk = ownedIds.includes("AUG-031");
  const group = groupPieces(engine, args.groupId, moonwalk);
  if (!group.length) throw new Error("움직일 말을 찾지 못했습니다.");
  const mover = currentPlayer(engine);
  if (!moonwalk && !isGroupUsableWithAugments(engine, mover.userId, args.groupId, ownedIds, setups)) {
    throw new Error("이 증강에서는 지정한 대표 말만 움직일 수 있습니다.");
  }

  const representative = group[0];
  const startedWaiting = representative.status === "WAITING";
  const movementStartNode = moonwalk && representative.status === "FINISHED"
    ? FINISH_NODE
    : startedWaiting ? 0 : (representative.node ?? 0);
  if (!moonwalk) armEchoFollowerForDeparture(engine, mover.userId, args.groupId, startedWaiting, ownedIds);
  const wasPlagueDeparture = startedWaiting && isPlagueGroup(engine, mover.userId, args.groupId);
  const effectiveResult = adjustedResultForMove(engine, mover.userId, args.groupId, result, ownedIds, setups);
  if (result.face !== "BACKDO" && isPlagueGroup(engine, mover.userId, args.groupId) && effectiveResult.finalSteps <= 0) {
    engine.results.splice(resultIndex, 1);
    clearGroupMoveFixedToOne(engine, mover.userId, args.groupId);
    clearJunctionBoostForGroup(engine, mover.userId, args.groupId);
    clearPathControlForGroup(engine, mover.userId, args.groupId);
    resetAthleteAccelerationForGroup(engine, mover.userId, args.groupId, ownedIds);
    clearPlagueForGroup(engine, mover.userId, args.groupId);
    for (const piece of group) {
      piece.status = "WAITING";
      piece.node = null;
      piece.groupId = piece.id;
    }
    engine.lastAction = `${mover.displayName}: 역병 · 이동량이 0 이하가 되어 대기로 돌아갑니다.`;
    finishResolvedMove(engine, 0, 0, ownedIds);
    return engine;
  }
  const cleanerWasActive = isCleanerActive(engine, mover.userId, ownedIds) && !ownedIds.includes("AUG-057");
  consumeGroupMoveFixedToOne(engine, mover.userId, args.groupId);

  let destination: number | null = null;
  let finished = false;
  let moonwalkHome = false;
  let backdoReward = false;
  let pathMessage = "";
  let actualPath: number[] = [];
  let selectedInterruption: PathInterruption | null = null;
  let usedChaseAbility = false;

  if (moonwalk && result.face !== "BACKDO") {
    const plans = buildReverseTargetPlans(engine, mover.userId, representative, effectiveResult, ownedIds, ownedByUser);
    if (!plans.length) throw new Error("문워크로 이동할 수 없는 말입니다.");
    const selected = selectPlan(plans, args);
    if (!selected) throw new Error("문워크 이동 경로를 선택해야 합니다.");

    actualPath = selected.target.path ?? [];
    destination = selected.target.node;
    moonwalkHome = selected.target.finished;
    selectedInterruption = selected.interruption;
    if (selected.target.kind === "CHASE") usedChaseAbility = true;

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
        consumeSanctuaryPassBlock(engine, selectedInterruption.defenderUserId, selectedInterruption.defenderGroupId);
        pathMessage += ` · 성역 통과 1회 차단(${selectedInterruption.blockerNode}번)`;
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
    if (selected.target.kind === "CHASE") usedChaseAbility = true;

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
        consumeSanctuaryPassBlock(engine, selectedInterruption.defenderUserId, selectedInterruption.defenderGroupId);
        pathMessage += ` · 성역 통과 1회 차단(${selectedInterruption.blockerNode}번)`;
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
    if (selected.target.kind === "CHASE") usedChaseAbility = true;

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
        consumeSanctuaryPassBlock(engine, selectedInterruption.defenderUserId, selectedInterruption.defenderGroupId);
        pathMessage += ` · 성역 통과 1회 차단(${selectedInterruption.blockerNode}번)`;
      }
    }

    applyForwardPath(group, actualPath, destination, finished);
    consumeJunctionBoostForForwardMove(engine, mover.userId, args.groupId, result, ownedIds);
    if (finished || movementStartNode !== destination) clearPathControlForGroup(engine, mover.userId, args.groupId);
  }

  if (wasPlagueDeparture && result.face !== "BACKDO") clearPlagueForGroup(engine, mover.userId, args.groupId);
  if (!moonwalk) recordEchoFinish(engine, mover.userId, args.groupId, finished, ownedIds);
  engine.results.splice(resultIndex, 1);
  recordAthleteAccelerationMove(engine, mover.userId, args.groupId, result, ownedIds);
  if (cleanerWasActive) consumeCleanerMovement(engine, mover.userId, ownedIds);
  if (backdoReward) engine.results.push({ id: `${result.id}:backdo-bonus`, face: "MOVE1", baseSteps: 1, finalSteps: 1, source: "AUGMENT" });

  const captureNodes = cleanerWasActive ? actualPath : (destination != null && !finished && !moonwalkHome ? [destination] : []);
  const captures = captureAlongPath(engine, args.groupId, captureNodes, ownedByUser);
  if (usedChaseAbility) captures.captureExtraRollCount = 0;
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
    ? ownedIds.includes("AUG-031") ? " · 물귀신으로 문워크 출발점 복귀" : " · 물귀신으로 함께 대기"
    : "";

  if (finished) {
    const soloResult = moonwalk ? null : resolveSoloLap(engine, group, ownedIds, setups);
    if (soloResult === "WIN") return engine;
    if (soloResult === "LAP") discardUnusableResults(engine, ownedIds, setups);
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
  const universeRewardRolls = applyUniverseCenterRewards(engine, mover.userId, ownedIds);
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
      augmentExtraRolls: universeRewardRolls,
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
  finishResolvedMove(engine, captures.captureExtraRollCount, universeRewardRolls, ownedIds);
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
    if (ownedIds.includes("AUG-017")) {
      const sourceCount = player.pieces.filter((piece) => piece.status === "ON_BOARD" && piece.groupId === sourceGroupId).length;
      const movingCount = player.pieces.filter((piece) => piece.status === "ON_BOARD" && piece.groupId === pending.movingGroupId).length;
      if (sourceCount + movingCount > 2) throw new Error("개판은 한 묶음에 최대 2개의 말만 업을 수 있습니다.");
    }
    relocateOwnGroupIntoMovingGroup(engine, player.userId, sourceGroupId, pending.movingGroupId, pending.destination);
    pending.augmentExtraRolls += stackAugmentExtraRolls(engine, player.userId, true, ownedIds);
    const name = "무임승차";
    engine.lastAction = `${player.displayName}: ${name}로 ${sourceGroupId} 묶음을 ${pending.destination}번으로 불러 업었습니다.`;
    if (checkSpecialWinner(engine, ownedIds)) return engine;
  } else {
    const name = "무임승차";
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
    if (ownedIds.includes("AUG-017")) {
      const mergedPieceCount = player.pieces.filter((piece) => (
        piece.status === "ON_BOARD"
        && piece.node === pending.destination
        && mergeIds.has(piece.groupId)
      )).length;
      if (mergedPieceCount > 2) throw new Error("개판은 한 묶음에 최대 2개의 말만 업을 수 있습니다.");
    }
    transferFixedOneOnStack(engine, player.userId, [...mergeIds], pending.movingGroupId);
    transferJunctionBoostOnStack(engine, player.userId, [...mergeIds], pending.movingGroupId);
    transferPathControlOnStack(engine, player.userId, [...mergeIds], pending.movingGroupId, pending.destination);
    for (const piece of player.pieces) {
      if (piece.status === "ON_BOARD" && piece.node === pending.destination && mergeIds.has(piece.groupId)) piece.groupId = pending.movingGroupId;
    }
    resetAthleteAccelerationForGroup(engine, player.userId, pending.movingGroupId, ownedIds);
    engine.lastAction = `${player.displayName}: ${pending.destination}번에서 업었습니다.`;
  } else {
    engine.lastAction = `${player.displayName}: 따로 두었습니다.`;
  }
  const augmentExtraRolls = (pending.augmentExtraRolls ?? 0) + stackAugmentExtraRolls(engine, player.userId, stack, ownedIds);
  engine.pendingStackChoice = null;
  finishResolvedMove(engine, pending.captureExtraRollCount, augmentExtraRolls, ownedIds);
  return engine;
}

export function applyGrandUnity(engineInput: GameEngineState, anchorGroupId: string, ownedIds: string[] = []): GameEngineState {
  const engine = clone(engineInput);
  if (!ownedIds.includes("AUG-038")) throw new Error("대동단결 증강을 보유하고 있지 않습니다.");
  if (engine.stage !== "AWAITING_ROLL" && engine.stage !== "MOVING") throw new Error("지금은 대동단결을 사용할 수 없습니다.");
  const player = currentPlayer(engine);
  engine.augmentRuntime ??= {};
  const runtime = engine.augmentRuntime[player.userId] ?? {};
  engine.augmentRuntime[player.userId] = runtime;
  if (runtime.grandUnityUsed) throw new Error("대동단결은 한 게임에 한 번만 사용할 수 있습니다.");

  const groups = playerBoardGroups(engine, player.userId);
  for (const groupId of [...groups.keys()]) {
    if (isTurtleGroupLocked(engine, player.userId, groupId)) groups.delete(groupId);
  }
  if (groups.size < 2) throw new Error("말판 위에 모을 다른 묶음이 필요합니다.");
  const anchor = groups.get(anchorGroupId);
  const destination = anchor?.[0]?.node;
  if (!anchor?.length || destination == null) throw new Error("대동단결 기준 묶음을 찾지 못했습니다.");

  const mergeIds = [...groups.keys()];
  if (ownedIds.includes("AUG-017")) {
    const mergedPieceCount = [...groups.values()].reduce((sum, pieces) => sum + pieces.length, 0);
    if (mergedPieceCount > 2) throw new Error("개판은 한 묶음에 최대 2개의 말만 업을 수 있습니다.");
  }
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

  const augmentExtraRolls = stackAugmentExtraRolls(engine, player.userId, true, ownedIds);
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

export function applyMoonwalkAcquisitionScatter(
  engineInput: GameEngineState,
  userId: string,
  random: () => number = Math.random,
) {
  const engine = clone(engineInput);
  const player = engine.players.find((candidate) => candidate.userId === userId);
  if (!player) throw new Error("문워크 소유자를 찾지 못했습니다.");
  const nodes = Array.from({ length: 29 }, (_, index) => index + 1);
  for (const piece of player.pieces) {
    if (piece.status !== "WAITING") continue;
    const index = Math.min(nodes.length - 1, Math.floor(random() * nodes.length));
    piece.status = "ON_BOARD";
    piece.node = nodes[index] ?? 1;
    piece.groupId = piece.id;
    piece.hasEntered = true;
  }
  engine.lastAction = `${player.displayName}: 문워크 · 대기 중인 말을 무작위 위치로 강제 배치`;
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
    if (piece.status === "WORMHOLE" || piece.status === "FINISHED" || seen.has(piece.groupId)) return false;
    seen.add(piece.groupId);
    return true;
  });
}
