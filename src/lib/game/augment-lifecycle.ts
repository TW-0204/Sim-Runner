import {
  applyBetrayalTransfer,
  armA04OnAcquisition,
  replacesNormalWinCondition,
  type PlayerAugmentSetups,
} from "@/lib/augments/effects";
import {
  applyGreatUpheaval,
  applyMoonwalkAcquisitionScatter,
  applyTurtleAndHarePlacement,
  armGachaMachineOnAcquisition,
  armWormholeOnAcquisition,
} from "./engine";
import type { GameEngineState, PieceState } from "./types";

export type SetupsByUser = Record<string, PlayerAugmentSetups>;

function rankedSetupPiece(pieces: PieceState[]) {
  return [...pieces].sort((left, right) => {
    const statusScore = (piece: PieceState) => piece.status === "FINISHED" ? 3 : piece.status === "ON_BOARD" ? 2 : piece.hasEntered ? 1 : 0;
    const statusDelta = statusScore(right) - statusScore(left);
    if (statusDelta !== 0) return statusDelta;
    const historyDelta = right.pathHistory.length - left.pathHistory.length;
    if (historyDelta !== 0) return historyDelta;
    return left.id.localeCompare(right.id);
  })[0];
}

function setupPieceId(
  engine: GameEngineState,
  userId: string,
  augmentId: "G16" | "P14",
) {
  const player = engine.players.find((candidate) => candidate.userId === userId);
  if (!player) return undefined;
  const candidates = augmentId === "P14"
    ? player.pieces.filter((piece) => piece.betrayalOriginalOwnerUserId == null)
    : player.pieces;
  return rankedSetupPiece(candidates)?.id;
}

export function initializeAcquiredPieceSetup(
  engine: GameEngineState,
  userId: string,
  augmentId: "G16" | "P14",
  setupsByUser: SetupsByUser,
) {
  const pieceId = setupPieceId(engine, userId, augmentId);
  if (!pieceId) return;
  setupsByUser[userId] ??= {};
  setupsByUser[userId][augmentId] = { pieceId };
}

/**
 * A10 can transfer a piece that itself came from an earlier Betrayal. The low-level
 * transfer deliberately preserves the original-owner marker, so the lifecycle must
 * normalize the ownership graph after the container move:
 * - if the piece returned to its original owner it is native again;
 * - if the removed piece was the root id of a surviving group, re-root that group to
 *   one of the remaining pieces so no piece points at an id outside its container.
 */
function normalizeBetrayalTransfer(
  engine: GameEngineState,
  sourceUserId: string,
  recipientUserId: string,
  transferredPieceId: string,
) {
  const source = engine.players.find((player) => player.userId === sourceUserId);
  const recipient = engine.players.find((player) => player.userId === recipientUserId);
  const transferred = recipient?.pieces.find((piece) => piece.id === transferredPieceId);
  if (!recipient || !transferred) {
    throw new Error("배반 이동 후 소유권을 정규화할 말을 찾지 못했습니다.");
  }

  const survivingGroup = source?.pieces.filter((piece) => piece.groupId === transferredPieceId) ?? [];
  if (survivingGroup.length > 0) {
    const replacementGroupId = [...survivingGroup]
      .sort((left, right) => left.id.localeCompare(right.id))[0]?.id;
    if (replacementGroupId) {
      for (const piece of survivingGroup) piece.groupId = replacementGroupId;
    }
  }

  if (transferred.betrayalOriginalOwnerUserId === recipientUserId) {
    delete transferred.betrayalOriginalOwnerUserId;
  }
}

function repairTransferredSetup(
  engine: GameEngineState,
  sourceUserId: string,
  transferredPieceId: string,
  setupsByUser: SetupsByUser,
) {
  const setups = setupsByUser[sourceUserId];
  if (!setups) return;
  const source = engine.players.find((player) => player.userId === sourceUserId);

  for (const augmentId of ["G16", "P14"] as const) {
    if (setups[augmentId]?.pieceId !== transferredPieceId) continue;

    if (augmentId === "P14") {
      const nativePieces = source?.pieces.filter((piece) => piece.betrayalOriginalOwnerUserId == null) ?? [];
      const nonFinished = nativePieces.filter((piece) => piece.status !== "FINISHED");
      const replacement = rankedSetupPiece(nonFinished.length > 0 ? nonFinished : nativePieces);
      if (!replacement) {
        delete setups[augmentId];
        continue;
      }
      if (replacement.status === "FINISHED") {
        replacement.status = "WAITING";
        replacement.node = null;
        replacement.groupId = replacement.id;
      }
      setups[augmentId] = { pieceId: replacement.id };
      continue;
    }

    const replacementId = source?.pieces[0]?.id;
    if (replacementId) setups[augmentId] = { pieceId: replacementId };
    else delete setups[augmentId];
  }
}

function maybeDeclareSourceWinnerAfterTransfer(
  engine: GameEngineState,
  userId: string,
  ownedIds: string[],
) {
  if (ownedIds.includes("P02") || replacesNormalWinCondition(ownedIds)) return;
  const player = engine.players.find((candidate) => candidate.userId === userId);
  if (!player || !player.pieces.every((piece) => piece.status === "FINISHED")) return;

  engine.winnerUserId = userId;
  engine.winnerCondition = "NORMAL";
  engine.stage = "FINISHED";
  engine.pendingRolls = [];
  engine.results = [];
  engine.pendingRollChoice = null;
  engine.pendingSplitChoice = null;
  engine.pendingCaptureChoice = null;
  engine.pendingRelocationChoice = null;
  engine.pendingStackChoice = null;
  engine.lastAction = `${player.displayName}: 배반 후 남은 현재 말이 모두 완주되어 승리!`;
}

export function applyBetrayalAcquisitionLifecycle(
  engineInput: GameEngineState,
  sourceUserId: string,
  ownedByUser: Record<string, string[]>,
  setupsByUser: SetupsByUser,
  random: () => number = Math.random,
) {
  const transfer = applyBetrayalTransfer(engineInput, sourceUserId, random);
  normalizeBetrayalTransfer(
    transfer.engine,
    sourceUserId,
    transfer.recipientUserId,
    transfer.transferredPieceId,
  );
  repairTransferredSetup(transfer.engine, sourceUserId, transfer.transferredPieceId, setupsByUser);
  maybeDeclareSourceWinnerAfterTransfer(
    transfer.engine,
    sourceUserId,
    ownedByUser[sourceUserId] ?? [],
  );
  return transfer;
}

export type AugmentAcquisitionLifecycleInput = {
  engine: GameEngineState;
  userId: string;
  augmentId: string;
  ownedByUser: Record<string, string[]>;
  setupsByUser: SetupsByUser;
  consumeA04UpgradePending?: boolean;
  randomNext?: () => number;
  randomInt?: (maxExclusive: number) => number;
};

export type AugmentAcquisitionLifecycleResult = {
  engine: GameEngineState;
  immediateTransitionFrom?: GameEngineState;
};

/**
 * Applies the game-state side effects of acquiring one augment.
 * Offer generation and which card to pick remain caller policy; the acquired card's
 * state transition belongs to the game layer.
 */
export function applyAugmentAcquisitionLifecycle({
  engine: engineInput,
  userId,
  augmentId,
  ownedByUser,
  setupsByUser,
  consumeA04UpgradePending = false,
  randomNext = Math.random,
  randomInt = (maxExclusive) => Math.min(maxExclusive - 1, Math.floor(Math.random() * maxExclusive)),
}: AugmentAcquisitionLifecycleInput): AugmentAcquisitionLifecycleResult {
  let engine = engineInput;

  // Preserve the effective-v11 ordering: P02 scatters before common idea-runtime setup.
  if (augmentId === "P02") {
    engine = applyMoonwalkAcquisitionScatter(engine, userId, randomNext);
  }

  engine.augmentRuntime ??= {};
  engine.augmentRuntime[userId] ??= {};
  const runtime = engine.augmentRuntime[userId];
  if (consumeA04UpgradePending) delete runtime.a04UpgradeNextAugment;

  if (augmentId === "A04") armA04OnAcquisition(engine, userId);
  if (augmentId === "A12") runtime.walkingTrailSegment = randomInt(4);
  if (augmentId === "A01") {
    runtime.gravityExplosionRound = engine.round;
    runtime.gravityExplosionResolved = false;
  }
  if (augmentId === "A02") armGachaMachineOnAcquisition(engine, userId);

  if (augmentId === "A08") {
    const before = engine;
    const after = applyGreatUpheaval(
      before,
      userId,
      ownedByUser,
      setupsByUser,
      randomNext,
    );
    return { engine: after, immediateTransitionFrom: before };
  }

  if (augmentId === "A13") armWormholeOnAcquisition(engine, userId);
  if (augmentId === "A15") {
    const owner = engine.players.find((candidate) => candidate.userId === userId);
    const waiting = owner?.pieces.filter((piece) => piece.status === "WAITING") ?? [];
    if (waiting.length > 0) {
      const target = waiting[randomInt(waiting.length)] ?? waiting[0];
      engine = applyTurtleAndHarePlacement(engine, userId, target.id);
    }
  }

  if (augmentId === "A10") {
    engine = applyBetrayalAcquisitionLifecycle(
      engine,
      userId,
      ownedByUser,
      setupsByUser,
      randomNext,
    ).engine;
  }

  if (augmentId === "G16" || augmentId === "P14") {
    initializeAcquiredPieceSetup(engine, userId, augmentId, setupsByUser);
  }

  return { engine };
}
