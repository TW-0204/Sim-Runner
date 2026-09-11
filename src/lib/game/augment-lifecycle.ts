import {
  applyBetrayalTransfer,
  replacesNormalWinCondition,
  type PlayerAugmentSetups,
} from "@/lib/augments/effects";
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
  repairTransferredSetup(transfer.engine, sourceUserId, transfer.transferredPieceId, setupsByUser);
  maybeDeclareSourceWinnerAfterTransfer(
    transfer.engine,
    sourceUserId,
    ownedByUser[sourceUserId] ?? [],
  );
  return transfer;
}
