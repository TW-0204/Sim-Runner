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

export function transformRollFace(
  engine: GameEngineState,
  userId: string,
  face: RollFace,
  source: RollSource,
  ownedIds: string[],
  random: () => number = Math.random,
) {
  if (source === "CAPTURE" && has(ownedIds, "P01")) return "YUT" as RollFace;
  if (source !== "BASIC") return face;

  const controlled = has(ownedIds, "G03") || has(ownedIds, "G04") || has(ownedIds, "G05");
  if (!controlled) return face;

  const runtime = runtimeForPlayer(engine, userId);
  const used = runtime.controlledBasicRollsUsed ?? 0;
  if (used >= 5) return face;
  runtime.controlledBasicRollsUsed = used + 1;

  if (has(ownedIds, "G03")) return FORWARD_SEQUENCE[used] ?? face;
  if (has(ownedIds, "G04")) return REVERSE_SEQUENCE[used] ?? face;
  if (has(ownedIds, "G05")) return random() < 0.5 ? "MO" : "DO";
  return face;
}

export function finalStepsForRoll(face: RollFace, source: RollSource, ownedIds: string[]) {
  let steps = baseStepsForFace(face);
  if (has(ownedIds, "S03")) {
    if (face === "DO") steps = 2;
    if (face === "BACKDO") steps = -2;
  }
  if (face === "GEOL" && has(ownedIds, "S09")) steps += 1;
  if (source === "CAPTURE" && face !== "BACKDO") {
    if (has(ownedIds, "G02")) steps += 2;
    else if (has(ownedIds, "S01")) steps += 1;
  }
  return steps;
}

export function grantsFaceExtraRoll(face: RollFace, ownedIds: string[]) {
  if (has(ownedIds, "G01")) return face === "GAE";
  return face === "YUT" || face === "MO";
}

export function grantsBackdoMoveToken(ownedIds: string[]) {
  return has(ownedIds, "S10");
}

function groupPieces(engine: GameEngineState, userId: string, groupId: string) {
  const player = engine.players.find((candidate) => candidate.userId === userId);
  return player?.pieces.filter((piece) => piece.groupId === groupId && piece.status !== "FINISHED") ?? [];
}

export function isGroupUsableWithAugments(
  engine: GameEngineState,
  userId: string,
  groupId: string,
  ownedIds: string[],
  setups: PlayerAugmentSetups = {},
) {
  if (!has(ownedIds, "P14")) return true;
  const representativeId = setups.P14?.pieceId;
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
  if (has(ownedIds, "S06") && representative.status === "WAITING") bonus += 1;
  if (has(ownedIds, "S08") && player.pieces.filter((piece) => piece.status === "FINISHED").length === 3) bonus += 1;
  if (has(ownedIds, "S14") && engine.augmentRuntime?.[userId]?.junctionBoostGroups?.[groupId]) bonus += 1;
  if (has(ownedIds, "G07") && !isSoloJunctionGroup(engine, userId, groupId) && hasAnySoloJunctionHolder(engine, userId)) bonus += 1;
  if (has(ownedIds, "P15") && group.length >= 2) bonus += group.length - 1;
  else if (has(ownedIds, "G08") && group.length >= 2) bonus += 1;
  const acePieceId = setups.G16?.pieceId;
  if (has(ownedIds, "G16") && acePieceId && group.some((piece) => piece.id === acePieceId)) bonus += 1;
  if (has(ownedIds, "P10")) bonus += 2;
  return bonus;
}

export function isGroupMoveFixedToOne(engine: GameEngineState, userId: string, groupId: string) {
  return Boolean(engine.augmentRuntime?.[userId]?.fixedOneGroups?.[groupId]);
}

export function adjustedResultForGroup(
  engine: GameEngineState,
  userId: string,
  groupId: string,
  result: RollToken,
  ownedIds: string[],
  setups: PlayerAugmentSetups = {},
): RollToken {
  const forbidShortcuts = has(ownedIds, "P10");
  if (isGroupMoveFixedToOne(engine, userId, groupId)) {
    return { ...result, finalSteps: result.face === "BACKDO" ? -1 : 1, forbidShortcuts };
  }
  if (result.suppressMovementBonuses) {
    return forbidShortcuts && !result.forbidShortcuts ? { ...result, forbidShortcuts: true } : result;
  }
  const bonus = movementBonusForGroup(engine, userId, groupId, result, ownedIds, setups);
  if (bonus === 0 && !forbidShortcuts) return result;
  return { ...result, finalSteps: result.finalSteps + bonus, forbidShortcuts };
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
  if (result.face === "BACKDO" || !has(ownedIds, "S14")) return;
  const boosts = engine.augmentRuntime?.[userId]?.junctionBoostGroups;
  if (boosts?.[groupId]) delete boosts[groupId];
}

export function armJunctionBoostAtDestination(engine: GameEngineState, userId: string, groupId: string, destination: number, ownedIds: string[]) {
  if (!has(ownedIds, "S14") || !JUNCTION_NODES.has(destination)) return;
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
  if (runtime?.alleyBlockades?.[groupId] != null) delete runtime.alleyBlockades[groupId];
  if (runtime?.universeCenterGroups?.[groupId]) delete runtime.universeCenterGroups[groupId];
}

export function armPathControlAtDestination(engine: GameEngineState, userId: string, groupId: string, destination: number, ownedIds: string[]) {
  if (!JUNCTION_NODES.has(destination)) return;
  const runtime = runtimeForPlayer(engine, userId);
  if (has(ownedIds, "P13")) {
    runtime.sanctuaryGroups ??= {};
    runtime.sanctuaryGroups[groupId] = destination;
  }
  if (has(ownedIds, "G06")) {
    runtime.alleyBlockades ??= {};
    runtime.alleyBlockades[groupId] = destination;
  }
  if (has(ownedIds, "P04") && destination === 15) {
    runtime.universeCenterGroups ??= {};
    runtime.universeCenterGroups[groupId] = true;
  }
}

export function transferPathControlOnStack(engine: GameEngineState, userId: string, mergedGroupIds: string[], resultGroupId: string, destination: number) {
  const runtime = engine.augmentRuntime?.[userId];
  if (!runtime) return;
  const sanctuaryCarry = mergedGroupIds.some((id) => runtime.sanctuaryGroups?.[id] === destination);
  const blockadeCarry = mergedGroupIds.some((id) => runtime.alleyBlockades?.[id] === destination);
  const universeCenterCarry = destination === 15 && mergedGroupIds.some((id) => Boolean(runtime.universeCenterGroups?.[id]));
  for (const id of mergedGroupIds) {
    if (runtime.sanctuaryGroups?.[id] != null) delete runtime.sanctuaryGroups[id];
    if (runtime.alleyBlockades?.[id] != null) delete runtime.alleyBlockades[id];
    if (runtime.universeCenterGroups?.[id]) delete runtime.universeCenterGroups[id];
  }
  if (sanctuaryCarry) {
    runtime.sanctuaryGroups ??= {};
    runtime.sanctuaryGroups[resultGroupId] = destination;
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
  if (!has(ownedIds, "P06")) return 0;
  return Math.max(0, 3 - (engine.augmentRuntime?.[userId]?.cleanerMovesUsed ?? 0));
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

export function stackAugmentExtraRolls(stack: boolean, ownedIds: string[]) {
  return stack && has(ownedIds, "S02") ? 1 : 0;
}

export function isCaptureImmune(engine: GameEngineState, userId: string, ownedIds: string[]) {
  if (!has(ownedIds, "S04")) return false;
  return (engine.augmentRuntime?.[userId]?.timesCaptured ?? 0) >= 4;
}

export function recordCaptureAgainstPlayer(engine: GameEngineState, userId: string, ownedIds: string[]) {
  if (!has(ownedIds, "S04") && !has(ownedIds, "S07") && !has(ownedIds, "S11")) return;
  const runtime = runtimeForPlayer(engine, userId);
  if (has(ownedIds, "S04")) runtime.timesCaptured = (runtime.timesCaptured ?? 0) + 1;
  if (has(ownedIds, "S07")) runtime.revengeBasicPending = true;
  if (has(ownedIds, "S11")) runtime.counterRollPending = true;
}

export function blocksCaptureExtraRoll(groupSize: number, ownedIds: string[]) {
  return groupSize >= 2 && has(ownedIds, "S05");
}

export function applyWaterGhostOne(engine: GameEngineState, attackerUserId: string, attackerGroupId: string, victimOwnedIds: string[]) {
  if (!has(victimOwnedIds, "G12")) return;
  const runtime = runtimeForPlayer(engine, attackerUserId);
  runtime.fixedOneGroups ??= {};
  runtime.fixedOneGroups[attackerGroupId] = true;
}

export function shouldReturnAttackerWithWaterGhostTwo(victimOwnedIds: string[]) {
  return has(victimOwnedIds, "P07");
}

export function recordEnemyCaptures(engine: GameEngineState, userId: string, captureCount: number, ownedIds: string[]) {
  if (captureCount <= 0 || !has(ownedIds, "P16")) return;
  const runtime = runtimeForPlayer(engine, userId);
  runtime.enemyCaptureCount = (runtime.enemyCaptureCount ?? 0) + captureCount;
}

export function replacesNormalWinCondition(ownedIds: string[]) {
  return ownedIds.some((id) => id === "P03" || id === "P04" || id === "P14" || id === "P16");
}

export function huntCaptureTarget(playerCount: number) {
  return 4 + playerCount;
}

export function specialWinForPlayer(engine: GameEngineState, userId: string, ownedIds: string[]): SpecialWinResult | null {
  const player = engine.players.find((candidate) => candidate.userId === userId);
  if (!player) return null;

  if (has(ownedIds, "P03") || has(ownedIds, "P04") || has(ownedIds, "P16")) {
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

  if (has(ownedIds, "P16")) {
    const count = engine.augmentRuntime?.[userId]?.enemyCaptureCount ?? 0;
    const target = huntCaptureTarget(engine.players.length);
    if (count >= target) return { condition: "HUNT", message: `${player.displayName}: 추노 ${target}회 달성!` };
  }
  if (has(ownedIds, "P03")) {
    const occupied = new Set(player.pieces.filter((piece) => piece.status === "ON_BOARD" && piece.node != null).map((piece) => piece.node as number));
    if (FOUR_GUARDIAN_NODES.every((node) => occupied.has(node))) return { condition: "FOUR_GUARDIANS", message: `${player.displayName}: 사방신 완성!` };
  }
  if (has(ownedIds, "P04")) {
    const centerPieces = player.pieces.filter((piece) => piece.status === "ON_BOARD" && piece.node === 15);
    if (centerPieces.length === 4 && new Set(centerPieces.map((piece) => piece.groupId)).size === 1) {
      return { condition: "CENTER_STACK", message: `${player.displayName}: 우주의 중심 완성!` };
    }
  }
  return null;
}
