import type { PlayerAugmentSetups } from "./effects";
import {
  getAugmentRuntime,
  registeredAugmentReferencePolicies,
  registeredPieceSetupAugmentIds,
} from "./runtime-registry";
import type { GameEngineState, PieceState } from "@/lib/game/types";

export type PieceSetupPayload = {
  pieceId: string;
};

export function requiresPieceSetup(augmentId: string | null | undefined) {
  return getAugmentRuntime(augmentId)?.setup?.kind === "piece";
}

export function pieceSetupOptions(seat: number) {
  return Array.from({ length: 4 }, (_, index) => ({
    pieceId: `${seat}-${index + 1}`,
    label: `말 ${index + 1}`,
  }));
}

export function isValidPieceSetup(seat: number, payload: unknown): payload is PieceSetupPayload {
  if (!payload || typeof payload !== "object") return false;
  const pieceId = (payload as { pieceId?: unknown }).pieceId;
  return typeof pieceId === "string" && pieceSetupOptions(seat).some((option) => option.pieceId === pieceId);
}

/**
 * Returns every piece currently referenced by a registered piece-setup augment.
 * Simulator/client policy can use this generically (for example, avoid voluntarily
 * sacrificing a referenced piece) without knowing augment IDs such as G16/P14.
 */
export function referencedSetupPieceIds(setups: PlayerAugmentSetups | undefined) {
  const ids = new Set<string>();
  if (!setups) return ids;
  for (const augmentId of registeredPieceSetupAugmentIds()) {
    const pieceId = setups[augmentId]?.pieceId;
    if (pieceId) ids.add(pieceId);
  }
  return ids;
}

function statusScore(piece: PieceState) {
  if (piece.status === "FINISHED") return 3;
  if (piece.status === "ON_BOARD") return 2;
  if (piece.hasEntered) return 1;
  return 0;
}

function rankedPiece(pieces: PieceState[]) {
  return [...pieces].sort((left, right) => {
    const statusDelta = statusScore(right) - statusScore(left);
    if (statusDelta !== 0) return statusDelta;
    const historyDelta = right.pathHistory.length - left.pathHistory.length;
    if (historyDelta !== 0) return historyDelta;
    return left.id.localeCompare(right.id);
  })[0];
}

function eligiblePieces(engine: GameEngineState, userId: string, augmentId: string) {
  const player = engine.players.find((candidate) => candidate.userId === userId);
  const policy = getAugmentRuntime(augmentId)?.setup;
  if (!player || policy?.kind !== "piece") return [];
  return policy.allowBorrowed
    ? player.pieces
    : player.pieces.filter((piece) => piece.betrayalOriginalOwnerUserId == null);
}

function selectReplacementPiece(engine: GameEngineState, userId: string, augmentId: string) {
  const policy = getAugmentRuntime(augmentId)?.setup;
  if (policy?.kind !== "piece") return undefined;
  const eligible = eligiblePieces(engine, userId, augmentId);
  const nonFinished = eligible.filter((piece) => piece.status !== "FINISHED");
  return rankedPiece(policy.preferNonFinished && nonFinished.length > 0 ? nonFinished : eligible);
}

export function initializeAugmentSetup(
  engine: GameEngineState,
  userId: string,
  augmentId: string,
  setupsByUser: Record<string, PlayerAugmentSetups>,
) {
  const policy = getAugmentRuntime(augmentId)?.setup;
  if (policy?.kind !== "piece") return;
  const piece = selectReplacementPiece(engine, userId, augmentId);
  if (!piece) return;
  setupsByUser[userId] ??= {};
  setupsByUser[userId][augmentId] = { pieceId: piece.id };
}

function pieceSetupIsValid(
  engine: GameEngineState,
  userId: string,
  augmentId: string,
  pieceId: string | undefined,
) {
  if (!pieceId) return false;
  return eligiblePieces(engine, userId, augmentId).some((piece) => piece.id === pieceId);
}

/**
 * Repairs every mutable augment reference using the runtime registry.
 *
 * Piece setup is the first built-in reference kind. Augments that retain group ids,
 * result ids, target players, map entities, or other mutable identifiers can attach a
 * custom reference policy in the registry without adding another branch here.
 */
export function repairInvalidAugmentSetups(
  engineInput: GameEngineState,
  ownedByUser: Record<string, string[]>,
  setupsByUser: Record<string, PlayerAugmentSetups>,
) {
  let engine = engineInput;

  for (const player of engine.players) {
    const owned = ownedByUser[player.userId] ?? [];
    for (const augmentId of registeredPieceSetupAugmentIds()) {
      if (!owned.includes(augmentId)) continue;
      setupsByUser[player.userId] ??= {};
      const currentPieceId = setupsByUser[player.userId]?.[augmentId]?.pieceId;
      if (pieceSetupIsValid(engine, player.userId, augmentId, currentPieceId)) continue;

      const replacement = selectReplacementPiece(engine, player.userId, augmentId);
      if (!replacement) {
        delete setupsByUser[player.userId]?.[augmentId];
        continue;
      }

      const policy = getAugmentRuntime(augmentId)?.setup;
      if (policy?.kind === "piece" && policy.resetFinishedReplacementToWaiting && replacement.status === "FINISHED") {
        replacement.status = "WAITING";
        replacement.node = null;
        replacement.groupId = replacement.id;
      }
      setupsByUser[player.userId][augmentId] = { pieceId: replacement.id };
    }
  }

  for (const { augmentId, policy } of registeredAugmentReferencePolicies()) {
    if (!policy.repair) continue;
    for (const player of engine.players) {
      if (!(ownedByUser[player.userId] ?? []).includes(augmentId)) continue;
      const repaired = policy.repair({
        engine,
        ownerUserId: player.userId,
        augmentId,
        ownedByUser,
        setupsByUser,
      });
      if (repaired) engine = repaired;
    }
  }

  return engine;
}

export function augmentSetupProblems(
  engine: GameEngineState,
  ownedByUser: Record<string, string[]> | undefined,
  setupsByUser: Record<string, PlayerAugmentSetups> | undefined,
) {
  if (!setupsByUser) return [];
  const problems: string[] = [];

  for (const [userId, setups] of Object.entries(setupsByUser)) {
    const player = engine.players.find((candidate) => candidate.userId === userId);
    if (!player) {
      problems.push(`setup container exists for missing player ${userId}.`);
      continue;
    }
    for (const augmentId of registeredPieceSetupAugmentIds()) {
      const pieceId = setups?.[augmentId]?.pieceId;
      if (!pieceId) continue;
      if (!pieceSetupIsValid(engine, userId, augmentId, pieceId)) {
        problems.push(`${augmentId} setup for ${userId} references invalid piece ${pieceId}.`);
      }
    }
  }

  if (ownedByUser) {
    for (const player of engine.players) {
      const owned = ownedByUser[player.userId] ?? [];
      for (const augmentId of registeredPieceSetupAugmentIds()) {
        if (!owned.includes(augmentId)) continue;
        const pieceId = setupsByUser[player.userId]?.[augmentId]?.pieceId;
        if (!pieceSetupIsValid(engine, player.userId, augmentId, pieceId)) {
          problems.push(`${player.userId} owns ${augmentId} without a valid setup piece.`);
        }
      }
    }

    for (const { augmentId, policy } of registeredAugmentReferencePolicies()) {
      if (!policy.problems) continue;
      for (const player of engine.players) {
        if (!(ownedByUser[player.userId] ?? []).includes(augmentId)) continue;
        problems.push(...policy.problems({
          engine,
          ownerUserId: player.userId,
          augmentId,
          ownedByUser,
          setupsByUser,
        }));
      }
    }
  }

  return problems;
}
