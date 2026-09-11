import { baseStepsForFace } from "@/lib/game/roll";
import type {
  GameEngineState,
  GameWinCondition,
  PieceState,
  RollFace,
  RollSource,
  RollToken,
} from "@/lib/game/types";

const JUNCTION_NODES = new Set([5, 10, 15, 22, 29]);
const FOUR_GUARDIAN_NODES = [5, 10, 22, 29] as const;
const FORWARD_SEQUENCE: RollFace[] = ["DO", "GAE", "GEOL", "YUT", "MO"];
const REVERSE_SEQUENCE: RollFace[] = ["MO", "YUT", "GEOL", "GAE", "DO"];
const WALKING_TRAIL_SEGMENTS = [
  new Set([1, 2, 3, 4, 5]),
  new Set([5, 6, 7, 8, 9, 10]),
  new Set([10, 18, 19, 20, 21, 22]),
  new Set([22, 25, 26, 27, 28, 29]),
] as const;

export type PlayerAugmentSetups = Record<string, { pieceId?: string } | null | undefined>;
export type SpecialWinResult = { condition: GameWinCondition; message: string };
export type PathInterruption = {
  reason: "SANCTUARY" | "ALLEY_BLOCKADE";
  stopNode: number;
  blockerNode: number;
  defenderUserId: string;
  defenderGroupId: string;
};

function has(ownedIds: string[], id: string) {
  return ownedIds.includes(id);
}

function runtimeForPlayer(engine: GameEngineState, userId: string) {
  engine.augmentRuntime ??= {};
  const runtime = engine.augmentRuntime[userId] ?? {};
  engine.augmentRuntime[userId] = runtime;
  return runtime;
}

function withoutDo(face: RollFace, ownedIds: string[], random: () => number) {
  if (!has(ownedIds, "AUG-054") || face !== "DO") return face;
  const roll = random() * 0.8464;
  if (roll < 0.3456) return "GAE" as RollFace;
  if (roll < 0.6912) return "GEOL" as RollFace;
  if (roll < 0.8208) return "YUT" as RollFace;
  return "MO" as RollFace;
}

export function transformRollFace(
  engine: GameEngineState,
  userId: string,
  face: RollFace,
  source: RollSource,
  ownedIds: string[],
  random: () => number = Math.random,
) {
  let transformed = face;
  if (source === "CAPTURE" && has(ownedIds, "AUG-062")) {
    transformed = "YUT";
  } else if (source === "BASIC") {
    const controlled = has(ownedIds, "AUG-018") || has(ownedIds, "AUG-019") || has(ownedIds, "AUG-020");
    if (controlled) {
      const runtime = runtimeForPlayer(engine, userId);
      const used = runtime.controlledBasicRollsUsed ?? 0;
      let active = true;
      if (has(ownedIds, "AUG-020")) {
        runtime.g05StartRound ??= engine.round;
        if (engine.round >= runtime.g05StartRound + 3) active = false;
      } else if (used >= 5) {
        active = false;
      } else {
        runtime.controlledBasicRollsUsed = used + 1;
      }

      if (active) {
        if (has(ownedIds, "AUG-018")) transformed = FORWARD_SEQUENCE[used] ?? face;
        else if (has(ownedIds, "AUG-019")) transformed = REVERSE_SEQUENCE[used] ?? face;
        else if (has(ownedIds, "AUG-020")) transformed = random() < 0.5 ? "MO" : "DO";
      }
    }
  }
  return withoutDo(transformed, ownedIds, random);
}

export function finalStepsForRoll(face: RollFace, source: RollSource, ownedIds: string[]) {
  let steps = baseStepsForFace(face);
  if (has(ownedIds, "AUG-003")) {
    if (face === "DO") steps = 2;
    if (face === "BACKDO") steps = -2;
  }
  if (face === "GEOL" && has(ownedIds, "AUG-009")) steps += 1;
  if (source === "CAPTURE" && face !== "BACKDO") {
    if (has(ownedIds, "AUG-060")) steps += 2;
    else if (has(ownedIds, "AUG-001")) steps += 1;
  }
  return steps;
}

export function grantsFaceExtraRoll(face: RollFace, ownedIds: string[]) {
  if (has(ownedIds, "AUG-017")) return face === "GAE";
  return face === "YUT" || face === "MO";
}

export function canGrantFaceExtraRoll(
  engine: GameEngineState,
  userId: string,
  face: RollFace,
  ownedIds: string[],
) {
  if (!grantsFaceExtraRoll(face, ownedIds)) return false;
  if (!has(ownedIds, "AUG-017")) return true;
  const runtime = engine.augmentRuntime?.[userId];
  if (runtime?.g01ExtraTurnNumber !== engine.turnNumber) return true;
  return (runtime.g01ExtraRollsGranted ?? 0) < 2;
}

export function consumeFaceExtraRollGrant(
  engine: GameEngineState,
  userId: string,
  face: RollFace,
  ownedIds: string[],
) {
  if (!canGrantFaceExtraRoll(engine, userId, face, ownedIds)) return false;
  if (!has(ownedIds, "AUG-017")) return true;
  const runtime = runtimeForPlayer(engine, userId);
  if (runtime.g01ExtraTurnNumber !== engine.turnNumber) {
    runtime.g01ExtraTurnNumber = engine.turnNumber;
    runtime.g01ExtraRollsGranted = 0;
  }
  runtime.g01ExtraRollsGranted = (runtime.g01ExtraRollsGranted ?? 0) + 1;
  return true;
}

export function armA04OnAcquisition(engine: GameEngineState, userId: string) {
  const runtime = runtimeForPlayer(engine, userId);
  runtime.a04NextBasicBonusPending = true;
  runtime.a04UpgradeNextAugment = true;
}

export function queueA04BonusForNextBasic(engine: GameEngineState, userId: string, ownedIds: string[]) {
  if (!has(ownedIds, "AUG-047") || engine.stage !== "AWAITING_ROLL" || engine.pendingRolls[0] !== "BASIC") return false;
  const runtime = runtimeForPlayer(engine, userId);
  if (!runtime.a04NextBasicBonusPending) return false;
  runtime.a04NextBasicBonusPending = false;
  engine.pendingRolls.push("AUGMENT");
  return true;
}

const ECHO_BRANCH_OPTIONS = new Map<number, Set<number>>([
  [5, new Set([6, 13])],
  [10, new Set([18, 11])],
  [15, new Set([16, 23])],
]);

function echoBranchChoicesFromHistory(history: number[]) {
  const choices: Record<string, number> = {};
  for (let index = 0; index + 1 < history.length; index += 1) {
    const node = history[index];
    const next = history[index + 1];
    const valid = ECHO_BRANCH_OPTIONS.get(node);
    if (!valid?.has(next) || choices[String(node)] != null) continue;
    choices[String(node)] = next;
  }
  return choices;
}

function groupContainsPiece(engine: GameEngineState, userId: string, groupId: string, pieceId: string) {
  const player = engine.players.find((candidate) => candidate.userId === userId);
  return Boolean(player?.pieces.some((piece) => piece.id === pieceId && piece.groupId === groupId));
}

export function echoAllowsForwardPath(
  engine: GameEngineState,
  userId: string,
  piece: PieceState,
  startNode: number,
  traversed: number[],
  ownedIds: string[],
) {
  if (!has(ownedIds, "AUG-052") || has(ownedIds, "AUG-031")) return true;
  const runtime = engine.augmentRuntime?.[userId];
  if (!runtime?.echoRouteCaptured || runtime.echoCompleted) return true;

  const followerId = runtime.echoFollowerPieceId;
  const affected = followerId
    ? groupContainsPiece(engine, userId, piece.groupId, followerId)
    : piece.status === "WAITING";
  if (!affected) return true;

  const choices = runtime.echoBranchChoices ?? {};
  const nodes = [startNode, ...traversed];
  for (let index = 0; index + 1 < nodes.length; index += 1) {
    const requiredNext = choices[String(nodes[index])];
    if (requiredNext != null && nodes[index + 1] !== requiredNext) return false;
  }
  return true;
}

export function armEchoFollowerForDeparture(
  engine: GameEngineState,
  userId: string,
  groupId: string,
  startedWaiting: boolean,
  ownedIds: string[],
) {
  if (!has(ownedIds, "AUG-052") || has(ownedIds, "AUG-031") || !startedWaiting) return;
  const runtime = runtimeForPlayer(engine, userId);
  if (!runtime.echoRouteCaptured || runtime.echoCompleted || runtime.echoFollowerPieceId || (runtime.echoFollowersRemaining ?? 0) <= 0) return;
  const player = engine.players.find((candidate) => candidate.userId === userId);
  const piece = player?.pieces.find((candidate) => candidate.groupId === groupId && candidate.status === "WAITING");
  if (piece) runtime.echoFollowerPieceId = piece.id;
}

export function recordEchoFinish(
  engine: GameEngineState,
  userId: string,
  groupId: string,
  finished: boolean,
  ownedIds: string[],
) {
  if (!finished || !has(ownedIds, "AUG-052") || has(ownedIds, "AUG-031")) return;
  const runtime = runtimeForPlayer(engine, userId);
  const player = engine.players.find((candidate) => candidate.userId === userId);
  const group = player?.pieces.filter((piece) => piece.groupId === groupId) ?? [];
  if (!group.length) return;

  if (!runtime.echoRouteCaptured) {
    const source = group[0];
    runtime.echoRouteCaptured = true;
    runtime.echoSourcePieceId = source.id;
    runtime.echoBranchChoices = echoBranchChoicesFromHistory(source.pathHistory);
    runtime.echoFollowersRemaining = 2;
    return;
  }

  const followerId = runtime.echoFollowerPieceId;
  if (followerId && group.some((piece) => piece.id === followerId)) {
    runtime.echoFollowersRemaining = Math.max(0, (runtime.echoFollowersRemaining ?? 1) - 1);
    delete runtime.echoFollowerPieceId;
    if ((runtime.echoFollowersRemaining ?? 0) <= 0) runtime.echoCompleted = true;
  }
}

export function applyBetrayalTransfer(
  engineInput: GameEngineState,
  sourceUserId: string,
  random: () => number = Math.random,
) {
  const engine = structuredClone(engineInput);
  const source = engine.players.find((player) => player.userId === sourceUserId);
  if (!source) throw new Error("배반 소유자를 찾지 못했습니다.");
  const waiting = source.pieces.filter((piece) => piece.status === "WAITING");
  if (!waiting.length) throw new Error("배반으로 넘길 대기 중인 말이 없습니다.");
  const opponents = engine.players.filter((player) => player.userId !== sourceUserId);
  if (!opponents.length) throw new Error("배반으로 말을 받을 상대가 없습니다.");

  const piece = waiting[Math.floor(random() * waiting.length)] ?? waiting[0];
  const recipient = opponents[Math.floor(random() * opponents.length)] ?? opponents[0];
  const index = source.pieces.findIndex((candidate) => candidate.id === piece.id);
  if (index < 0) throw new Error("배반 대상 말을 찾지 못했습니다.");
  const [transferred] = source.pieces.splice(index, 1);
  if (!transferred) throw new Error("배반 대상 말을 옮기지 못했습니다.");

  transferred.ownerUserId = recipient.userId;
  transferred.seat = recipient.seat;
  transferred.status = "WAITING";
  transferred.node = null;
  transferred.groupId = transferred.id;
  transferred.hasEntered = false;
  transferred.pathHistory = [];
  transferred.betrayalOriginalOwnerUserId ??= source.userId;
  recipient.pieces.push(transferred);

  const sourceRuntime = engine.augmentRuntime?.[sourceUserId];
  if (sourceRuntime?.echoFollowerPieceId === transferred.id) sourceRuntime.echoCompleted = true;

  return { engine, transferredPieceId: transferred.id, recipientUserId: recipient.userId };
}

export function betrayalCaptureBonusRoll(
  engine: GameEngineState,
  attackerUserId: string,
  attackerGroupId: string,
  victimUserId: string,
) {
  const attacker = engine.players.find((player) => player.userId === attackerUserId);
  if (!attacker) return 0;
  return attacker.pieces.some((piece) => (
    piece.groupId === attackerGroupId
    && piece.status === "ON_BOARD"
    && piece.betrayalOriginalOwnerUserId === victimUserId
  )) ? 1 : 0;
}

export function grantsBackdoMoveToken(ownedIds: string[]) {
  return has(ownedIds, "AUG-010");
}

function groupPieces(engine: GameEngineState, userId: string, groupId: string) {
  const player = engine.players.find((candidate) => candidate.userId === userId);
  return player?.pieces.filter((piece) => (
    piece.groupId === groupId && (piece.status === "WAITING" || piece.status === "ON_BOARD")
  )) ?? [];
}

export function isTurtleGroupLocked(engine: GameEngineState, userId: string, groupId: string) {
  const locks = engine.augmentRuntime?.[userId]?.turtleLockedUntilRoundByPiece;
  if (!locks) return false;
  const player = engine.players.find((candidate) => candidate.userId === userId);
  return Boolean(player?.pieces.some((piece) => (
    piece.groupId === groupId
    && piece.status === "ON_BOARD"
    && (locks[piece.id] ?? 0) > engine.round
  )));
}

export function clearTurtleLockForGroup(engine: GameEngineState, userId: string, groupId: string) {
  const locks = engine.augmentRuntime?.[userId]?.turtleLockedUntilRoundByPiece;
  const player = engine.players.find((candidate) => candidate.userId === userId);
  if (!locks || !player) return;
  for (const piece of player.pieces) {
    if (piece.groupId === groupId) delete locks[piece.id];
  }
}

export function isGroupUsableWithAugments(
  engine: GameEngineState,
  userId: string,
  groupId: string,
  ownedIds: string[],
  setups: PlayerAugmentSetups = {},
) {
  if (isTurtleGroupLocked(engine, userId, groupId)) return false;
  if (!has(ownedIds, "AUG-041")) return true;
  const representativeId = setups["AUG-041"]?.pieceId;
  if (!representativeId) return false;
  return groupPieces(engine, userId, groupId).some((piece) => piece.id === representativeId);
}

function isSoloJunctionGroup(engine: GameEngineState, userId: string, groupId: string) {
  const player = engine.players.find((candidate) => candidate.userId === userId);
  if (!player) return false;
  const group = player.pieces.filter((piece) => piece.groupId === groupId && piece.status === "ON_BOARD");
  if (group.length !== 1) return false;
  const node = group[0].node;
  if (node == null || !JUNCTION_NODES.has(node)) return false;
  const occupants = engine.players.flatMap((candidate) => candidate.pieces)
    .filter((piece) => piece.status === "ON_BOARD" && piece.node === node);
  return occupants.length === 1;
}

function hasAnySoloJunctionHolder(engine: GameEngineState, userId: string) {
  const player = engine.players.find((candidate) => candidate.userId === userId);
  if (!player) return false;
  const seen = new Set<string>();
  for (const piece of player.pieces) {
    if (seen.has(piece.groupId)) continue;
    seen.add(piece.groupId);
    if (isSoloJunctionGroup(engine, userId, piece.groupId)) return true;
  }
  return false;
}

export function movementBonusForGroup(
  engine: GameEngineState,
  userId: string,
  groupId: string,
  result: RollToken,
  ownedIds: string[],
  setups: PlayerAugmentSetups = {},
) {
  if (result.face === "BACKDO") return 0;
  const player = engine.players.find((candidate) => candidate.userId === userId);
  const group = groupPieces(engine, userId, groupId);
  const representative: PieceState | undefined = group[0];
  if (!player || !representative) return 0;
  let bonus = 0;
  if (has(ownedIds, "AUG-013") && engine.augmentRuntime?.[userId]?.vacancyInitialized && (engine.augmentRuntime?.[userId]?.vacancySkipsRemaining ?? 2) <= 0) bonus += 1;
  if (has(ownedIds, "AUG-029") && ["DO", "GAE", "GEOL", "YUT", "MO"].includes(result.face)) {
    const runtime = engine.augmentRuntime?.[userId];
    if (runtime?.athleteAcceleratingGroupId === groupId) {
      bonus += Math.min(2, runtime.athleteConsecutiveMoves ?? 0);
    }
  }
  if (has(ownedIds, "AUG-055") && representative.status === "ON_BOARD" && representative.node != null) {
    const segment = engine.augmentRuntime?.[userId]?.walkingTrailSegment;
    if (segment != null && WALKING_TRAIL_SEGMENTS[segment]?.has(representative.node)) bonus += 1;
  }
  if (has(ownedIds, "AUG-006") && representative.status === "WAITING") bonus += 2;
  if (has(ownedIds, "AUG-008") && player.pieces.filter((piece) => piece.status === "FINISHED").length === 3) bonus += 1;
  if (has(ownedIds, "AUG-014") && engine.augmentRuntime?.[userId]?.junctionBoostGroups?.[groupId]) bonus += 1;
  if (has(ownedIds, "AUG-022") && !isSoloJunctionGroup(engine, userId, groupId) && hasAnySoloJunctionHolder(engine, userId)) bonus += 1;
  if (has(ownedIds, "AUG-065") && group.length >= 2) bonus += group.length - 1;
  else if (has(ownedIds, "AUG-023") && group.length >= 2) bonus += 1;
  const acePieceId = setups["AUG-030"]?.pieceId;
  if (has(ownedIds, "AUG-030") && acePieceId && group.some((piece) => piece.id === acePieceId)) bonus += 1;
  return bonus;
}

export function recordAthleteAccelerationMove(
  engine: GameEngineState,
  userId: string,
  groupId: string,
  result: RollToken,
  ownedIds: string[],
) {
  if (!has(ownedIds, "AUG-029")) return;
  if (!["DO", "GAE", "GEOL", "YUT", "MO", "BACKDO"].includes(result.face)) return;
  const runtime = runtimeForPlayer(engine, userId);
  if (runtime.athleteAcceleratingGroupId === groupId) {
    runtime.athleteConsecutiveMoves = (runtime.athleteConsecutiveMoves ?? 0) + 1;
  } else {
    runtime.athleteAcceleratingGroupId = groupId;
    runtime.athleteConsecutiveMoves = 1;
  }
}

export function resetAthleteAccelerationForGroup(
  engine: GameEngineState,
  userId: string,
  groupId: string,
  ownedIds: string[],
) {
  if (!has(ownedIds, "AUG-029")) return;
  const runtime = engine.augmentRuntime?.[userId];
  if (runtime?.athleteAcceleratingGroupId !== groupId) return;
  delete runtime.athleteAcceleratingGroupId;
  delete runtime.athleteConsecutiveMoves;
}

export function isGroupMoveFixedToOne(engine: GameEngineState, userId: string, groupId: string) {
  return Boolean(engine.augmentRuntime?.[userId]?.fixedOneGroups?.[groupId]);
}

export function isPlagueGroup(engine: GameEngineState, userId: string, groupId: string) {
  const infected = engine.augmentRuntime?.[userId]?.plaguePieceIds;
  if (!infected) return false;
  const player = engine.players.find((candidate) => candidate.userId === userId);
  return Boolean(player?.pieces.some((piece) => (
    piece.groupId === groupId
    && (piece.status === "WAITING" || piece.status === "ON_BOARD")
    && infected[piece.id]
  )));
}

export function infectPlagueGroup(engine: GameEngineState, userId: string, groupId: string) {
  const player = engine.players.find((candidate) => candidate.userId === userId);
  if (!player) return;
  const runtime = runtimeForPlayer(engine, userId);
  runtime.plaguePieceIds ??= {};
  for (const piece of player.pieces) {
    if (piece.groupId === groupId && piece.status === "ON_BOARD") runtime.plaguePieceIds[piece.id] = true;
  }
}

export function clearPlagueForGroup(engine: GameEngineState, userId: string, groupId: string) {
  const infected = engine.augmentRuntime?.[userId]?.plaguePieceIds;
  const player = engine.players.find((candidate) => candidate.userId === userId);
  if (!infected || !player) return;
  for (const piece of player.pieces) {
    if (piece.groupId === groupId) delete infected[piece.id];
  }
}

export function infectPlaguePieceIds(engine: GameEngineState, userId: string, pieceIds: string[]) {
  const runtime = runtimeForPlayer(engine, userId);
  runtime.plaguePieceIds ??= {};
  for (const pieceId of pieceIds) runtime.plaguePieceIds[pieceId] = true;
}

export function adjustedResultForGroup(
  engine: GameEngineState,
  userId: string,
  groupId: string,
  result: RollToken,
  ownedIds: string[],
  setups: PlayerAugmentSetups = {},
): RollToken {
  const forbidShortcuts = has(ownedIds, "AUG-037");
  const plaguePenalty = 0;
  if (isGroupMoveFixedToOne(engine, userId, groupId)) {
    return { ...result, finalSteps: result.face === "BACKDO" ? -1 : 1 - plaguePenalty, forbidShortcuts };
  }
  if (result.suppressMovementBonuses) {
    const finalSteps = result.finalSteps - plaguePenalty;
    if (plaguePenalty === 0 && (!forbidShortcuts || result.forbidShortcuts)) return result;
    return { ...result, finalSteps, forbidShortcuts: forbidShortcuts || result.forbidShortcuts };
  }
  const bonus = movementBonusForGroup(engine, userId, groupId, result, ownedIds, setups);
  if (bonus === 0 && plaguePenalty === 0 && !forbidShortcuts) return result;
  return { ...result, finalSteps: result.finalSteps + bonus - plaguePenalty, forbidShortcuts };
}

export function consumeGroupMoveFixedToOne(engine: GameEngineState, userId: string, groupId: string) {
  const locks = engine.augmentRuntime?.[userId]?.fixedOneGroups;
  if (locks?.[groupId]) delete locks[groupId];
}

export function clearGroupMoveFixedToOne(engine: GameEngineState, userId: string, groupId: string) {
  const locks = engine.augmentRuntime?.[userId]?.fixedOneGroups;
  if (locks?.[groupId]) delete locks[groupId];
}

export function transferFixedOneOnStack(engine: GameEngineState, userId: string, mergedGroupIds: string[], resultGroupId: string) {
  const locks = engine.augmentRuntime?.[userId]?.fixedOneGroups;
  if (!locks) return;
  const shouldCarry = mergedGroupIds.some((groupId) => Boolean(locks[groupId]));
  for (const groupId of mergedGroupIds) delete locks[groupId];
  if (shouldCarry) locks[resultGroupId] = true;
}

export function consumeJunctionBoostForForwardMove(engine: GameEngineState, userId: string, groupId: string, result: RollToken, ownedIds: string[]) {
  if (result.face === "BACKDO" || !has(ownedIds, "AUG-014")) return;
  const boosts = engine.augmentRuntime?.[userId]?.junctionBoostGroups;
  if (boosts?.[groupId]) delete boosts[groupId];
}

export function armJunctionBoostAtDestination(engine: GameEngineState, userId: string, groupId: string, destination: number, ownedIds: string[]) {
  if (!has(ownedIds, "AUG-014") || !JUNCTION_NODES.has(destination)) return;
  const runtime = runtimeForPlayer(engine, userId);
  runtime.junctionBoostGroups ??= {};
  runtime.junctionBoostGroups[groupId] = true;
}

export function clearJunctionBoostForGroup(engine: GameEngineState, userId: string, groupId: string) {
  const boosts = engine.augmentRuntime?.[userId]?.junctionBoostGroups;
  if (boosts?.[groupId]) delete boosts[groupId];
}

export function transferJunctionBoostOnStack(engine: GameEngineState, userId: string, mergedGroupIds: string[], resultGroupId: string) {
  const boosts = engine.augmentRuntime?.[userId]?.junctionBoostGroups;
  if (!boosts) return;
  const shouldCarry = mergedGroupIds.some((groupId) => Boolean(boosts[groupId]));
  for (const groupId of mergedGroupIds) delete boosts[groupId];
  if (shouldCarry) boosts[resultGroupId] = true;
}

export function clearPathControlForGroup(engine: GameEngineState, userId: string, groupId: string) {
  const player = engine.players.find((candidate) => candidate.userId === userId);
  for (const piece of player?.pieces ?? []) {
    if (
      piece.groupId === groupId
      && piece.status === "ON_BOARD"
      && piece.node == null
      && piece.hasEntered
      && piece.pathHistory[piece.pathHistory.length - 1] === 29
    ) {
      piece.status = "FINISHED";
    }
  }
  const runtime = engine.augmentRuntime?.[userId];
  if (runtime?.sanctuaryGroups?.[groupId] != null) delete runtime.sanctuaryGroups[groupId];
  if (runtime?.sanctuaryPassBlocks?.[groupId]) delete runtime.sanctuaryPassBlocks[groupId];
  if (runtime?.alleyBlockades?.[groupId] != null) delete runtime.alleyBlockades[groupId];
  if (runtime?.universeCenterGroups?.[groupId]) delete runtime.universeCenterGroups[groupId];
}

export function armPathControlAtDestination(engine: GameEngineState, userId: string, groupId: string, destination: number, ownedIds: string[]) {
  if (!JUNCTION_NODES.has(destination)) return;
  const runtime = runtimeForPlayer(engine, userId);
  if (has(ownedIds, "AUG-040")) {
    runtime.sanctuaryGroups ??= {};
    runtime.sanctuaryGroups[groupId] = destination;
    runtime.sanctuaryPassBlocks ??= {};
    runtime.sanctuaryPassBlocks[groupId] = true;
  }
  if (has(ownedIds, "AUG-021")) {
    runtime.alleyBlockades ??= {};
    runtime.alleyBlockades[groupId] = destination;
  }
  if (has(ownedIds, "AUG-033") && destination === 15) {
    runtime.universeCenterGroups ??= {};
    runtime.universeCenterGroups[groupId] = true;
  }
}

export function transferPathControlOnStack(engine: GameEngineState, userId: string, mergedGroupIds: string[], resultGroupId: string, destination: number) {
  const runtime = engine.augmentRuntime?.[userId];
  if (!runtime) return;
  const sanctuaryCarry = mergedGroupIds.some((id) => runtime.sanctuaryGroups?.[id] === destination);
  const sanctuaryPassCarry = mergedGroupIds.some((id) => Boolean(runtime.sanctuaryPassBlocks?.[id]));
  const blockadeCarry = mergedGroupIds.some((id) => runtime.alleyBlockades?.[id] === destination);
  const universeCenterCarry = destination === 15 && mergedGroupIds.some((id) => Boolean(runtime.universeCenterGroups?.[id]));
  for (const id of mergedGroupIds) {
    if (runtime.sanctuaryGroups?.[id] != null) delete runtime.sanctuaryGroups[id];
    if (runtime.sanctuaryPassBlocks?.[id]) delete runtime.sanctuaryPassBlocks[id];
    if (runtime.alleyBlockades?.[id] != null) delete runtime.alleyBlockades[id];
    if (runtime.universeCenterGroups?.[id]) delete runtime.universeCenterGroups[id];
  }
  if (sanctuaryCarry) {
    runtime.sanctuaryGroups ??= {};
    runtime.sanctuaryGroups[resultGroupId] = destination;
  }
  if (sanctuaryPassCarry) {
    runtime.sanctuaryPassBlocks ??= {};
    runtime.sanctuaryPassBlocks[resultGroupId] = true;
  }
  if (blockadeCarry) {
    runtime.alleyBlockades ??= {};
    runtime.alleyBlockades[resultGroupId] = destination;
  }
  if (universeCenterCarry) {
    runtime.universeCenterGroups ??= {};
    runtime.universeCenterGroups[resultGroupId] = true;
  }
}

export function isSanctuaryGroup(engine: GameEngineState, userId: string, groupId: string, node?: number) {
  const universeCenterProtected = Boolean(engine.augmentRuntime?.[userId]?.universeCenterGroups?.[groupId]);
  if (universeCenterProtected && (node == null || node === 15)) {
    const activeAtCenter = groupPieces(engine, userId, groupId)
      .some((piece) => piece.status === "ON_BOARD" && piece.node === 15);
    if (activeAtCenter) return true;
  }

  const saved = engine.augmentRuntime?.[userId]?.sanctuaryGroups?.[groupId];
  if (saved == null || (node != null && saved !== node)) return false;
  return groupPieces(engine, userId, groupId).some((piece) => piece.status === "ON_BOARD" && piece.node === saved);
}

function activeControlAtNode(engine: GameEngineState, moverUserId: string, node: number, kind: "SANCTUARY" | "ALLEY_BLOCKADE") {
  for (const player of engine.players) {
    if (player.userId === moverUserId) continue;
    const entries = kind === "SANCTUARY"
      ? engine.augmentRuntime?.[player.userId]?.sanctuaryGroups
      : engine.augmentRuntime?.[player.userId]?.alleyBlockades;
    if (!entries) continue;
    for (const [groupId, savedNode] of Object.entries(entries)) {
      if (savedNode !== node) continue;
      if (kind === "SANCTUARY" && !engine.augmentRuntime?.[player.userId]?.sanctuaryPassBlocks?.[groupId]) continue;
      const active = player.pieces.some((piece) => piece.groupId === groupId && piece.status === "ON_BOARD" && piece.node === node);
      if (active) return { defenderUserId: player.userId, defenderGroupId: groupId };
    }
  }
  return null;
}

export function firstForwardPathInterruption(engine: GameEngineState, moverUserId: string, startNode: number, traversed: number[]): PathInterruption | null {
  for (let index = 0; index < traversed.length; index += 1) {
    const node = traversed[index];
    const stopNode = index === 0 ? startNode : traversed[index - 1];
    if (stopNode === 0) continue;
    const sanctuary = activeControlAtNode(engine, moverUserId, node, "SANCTUARY");
    if (sanctuary) return { reason: "SANCTUARY", stopNode, blockerNode: node, ...sanctuary };
    if (index < traversed.length - 1) {
      const blockade = activeControlAtNode(engine, moverUserId, node, "ALLEY_BLOCKADE");
      if (blockade) return { reason: "ALLEY_BLOCKADE", stopNode, blockerNode: node, ...blockade };
    }
  }
  return null;
}

export function consumeSanctuaryPassBlock(engine: GameEngineState, defenderUserId: string, defenderGroupId: string) {
  const blocks = engine.augmentRuntime?.[defenderUserId]?.sanctuaryPassBlocks;
  if (blocks?.[defenderGroupId]) delete blocks[defenderGroupId];
}

export function consumeAlleyBlockade(engine: GameEngineState, defenderUserId: string, defenderGroupId: string) {
  const blockades = engine.augmentRuntime?.[defenderUserId]?.alleyBlockades;
  if (blockades?.[defenderGroupId] != null) delete blockades[defenderGroupId];
}

export function chaseTargetsOnPath(engine: GameEngineState, moverUserId: string, traversed: number[], ownedByUser: Record<string, string[]> = {}) {
  const targets: number[] = [];
  for (const node of traversed) {
    const opponents = engine.players.filter((player) => player.userId !== moverUserId)
      .flatMap((player) => {
        const groups = new Map<string, PieceState[]>();
        for (const piece of player.pieces.filter((piece) => piece.status === "ON_BOARD" && piece.node === node)) {
          const list = groups.get(piece.groupId) ?? [];
          list.push(piece);
          groups.set(piece.groupId, list);
        }
        return [...groups.entries()].map(([groupId]) => ({ userId: player.userId, groupId }));
      });
    const capturable = opponents.some(({ userId, groupId }) => {
      if (isSanctuaryGroup(engine, userId, groupId, node)) return false;
      return !isCaptureImmune(engine, userId, ownedByUser[userId] ?? []);
    });
    if (capturable) targets.push(node);
  }
  return [...new Set(targets)];
}

export function cleanerMovesRemaining(engine: GameEngineState, userId: string, ownedIds: string[]) {
  if (!has(ownedIds, "AUG-034")) return 0;
  return Math.max(0, 4 - (engine.augmentRuntime?.[userId]?.cleanerMovesUsed ?? 0));
}

export function isCleanerActive(engine: GameEngineState, userId: string, ownedIds: string[]) {
  return cleanerMovesRemaining(engine, userId, ownedIds) > 0;
}

export function consumeCleanerMovement(engine: GameEngineState, userId: string, ownedIds: string[]) {
  if (!isCleanerActive(engine, userId, ownedIds)) return false;
  const runtime = runtimeForPlayer(engine, userId);
  runtime.cleanerMovesUsed = (runtime.cleanerMovesUsed ?? 0) + 1;
  return true;
}

export function stackAugmentExtraRolls(
  engine: GameEngineState,
  userId: string,
  stack: boolean,
  ownedIds: string[],
) {
  if (!stack || !has(ownedIds, "AUG-002")) return 0;
  const runtime = runtimeForPlayer(engine, userId);
  runtime.piggybackStackCount = (runtime.piggybackStackCount ?? 0) + 1;
  return runtime.piggybackStackCount % 4 === 0 ? 1 : 0;
}

export function isCaptureImmune(_engine: GameEngineState, _userId: string, _ownedIds: string[]) {
  return false;
}

export function consumeBreakthroughCaptureBlock(engine: GameEngineState, userId: string, ownedIds: string[]) {
  if (!has(ownedIds, "AUG-004")) return false;
  const runtime = runtimeForPlayer(engine, userId);
  const remaining = runtime.breakthroughBlocksRemaining ?? 0;
  if (remaining <= 0) return false;
  runtime.breakthroughBlocksRemaining = remaining - 1;
  return true;
}

export function recordCaptureAgainstPlayer(engine: GameEngineState, userId: string, ownedIds: string[]) {
  if (!has(ownedIds, "AUG-004") && !has(ownedIds, "AUG-007") && !has(ownedIds, "AUG-011")) return;
  const runtime = runtimeForPlayer(engine, userId);
  if (has(ownedIds, "AUG-004")) {
    runtime.timesCaptured = (runtime.timesCaptured ?? 0) + 1;
    if (runtime.timesCaptured === 5) runtime.breakthroughBlocksRemaining = 2;
  }
  if (has(ownedIds, "AUG-007")) runtime.revengeBasicPending = true;
  if (has(ownedIds, "AUG-011")) runtime.counterRollPending = true;
}

export function blocksCaptureExtraRoll(groupSize: number, ownedIds: string[]) {
  return groupSize >= 2 && has(ownedIds, "AUG-005");
}

export function applyWaterGhostOne(engine: GameEngineState, attackerUserId: string, attackerGroupId: string, victimOwnedIds: string[]) {
  if (!has(victimOwnedIds, "AUG-027")) return;
  const runtime = runtimeForPlayer(engine, attackerUserId);
  runtime.fixedOneGroups ??= {};
  runtime.fixedOneGroups[attackerGroupId] = true;
}

export function shouldReturnAttackerWithWaterGhostTwo(victimOwnedIds: string[]) {
  return has(victimOwnedIds, "AUG-064");
}

export function recordEnemyCaptures(engine: GameEngineState, userId: string, captureCount: number, ownedIds: string[]) {
  if (captureCount <= 0 || !has(ownedIds, "AUG-042")) return;
  const runtime = runtimeForPlayer(engine, userId);
  runtime.enemyCaptureCount = (runtime.enemyCaptureCount ?? 0) + captureCount;
}

export function replacesNormalWinCondition(ownedIds: string[]) {
  return ownedIds.some((id) => id === "AUG-032" || id === "AUG-033" || id === "AUG-041" || id === "AUG-042");
}

export function huntCaptureTarget(playerCount: number) {
  if (playerCount === 2) return 7;
  if (playerCount === 3) return 19;
  if (playerCount === 4) return 30;
  return 30;
}

export function specialWinForPlayer(engine: GameEngineState, userId: string, ownedIds: string[]): SpecialWinResult | null {
  const player = engine.players.find((candidate) => candidate.userId === userId);
  if (!player) return null;

  if (has(ownedIds, "AUG-032") || has(ownedIds, "AUG-033") || has(ownedIds, "AUG-042")) {
    const finished = player.pieces.filter((piece) => piece.status === "FINISHED");
    if (finished.length > 0) {
      for (const piece of finished) {
        piece.status = "WAITING";
        piece.node = null;
        piece.groupId = piece.id;
      }
      engine.lastAction = `${engine.lastAction} · 특수 승리 목표로 완주 말 대기 복귀`;
    }
  }

  if (has(ownedIds, "AUG-042")) {
    const count = engine.augmentRuntime?.[userId]?.enemyCaptureCount ?? 0;
    const target = huntCaptureTarget(engine.players.length);
    if (count >= target) return { condition: "HUNT", message: `${player.displayName}: 추노 ${target}회 달성!` };
  }
  if (has(ownedIds, "AUG-032")) {
    const occupied = new Set(player.pieces.filter((piece) => piece.status === "ON_BOARD" && piece.node != null).map((piece) => piece.node as number));
    if (FOUR_GUARDIAN_NODES.every((node) => occupied.has(node))) return { condition: "FOUR_GUARDIANS", message: `${player.displayName}: 사방신 완성!` };
  }
  if (has(ownedIds, "AUG-033")) {
    const centerPieces = player.pieces.filter((piece) => piece.status === "ON_BOARD" && piece.node === 15);
    if (centerPieces.length === 4 && new Set(centerPieces.map((piece) => piece.groupId)).size === 1) {
      return { condition: "CENTER_STACK", message: `${player.displayName}: 우주의 중심 완성!` };
    }
  }
  return null;
}
