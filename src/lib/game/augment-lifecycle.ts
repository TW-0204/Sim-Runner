import {
  applyBetrayalTransfer,
  armA04OnAcquisition,
  replacesNormalWinCondition,
  type PlayerAugmentSetups,
} from "@/lib/augments/effects";
import { dispatchAugmentHook } from "@/lib/augments/runtime-registry";
import { initializeAugmentSetup, repairInvalidAugmentSetups } from "@/lib/augments/setup";
import {
  applyGreatUpheaval,
  applyMoonwalkAcquisitionScatter,
  applyTurtleAndHarePlacement,
  armGachaMachineOnAcquisition,
  armWormholeOnAcquisition,
} from "./engine";
import { rehomeGroupAfterPieceRemoval } from "./group-ownership";
import type { GameEngineState } from "./types";

export type SetupsByUser = Record<string, PlayerAugmentSetups>;

/**
 * AUG-053 can transfer a piece that itself came from an earlier Betrayal. The low-level
 * transfer deliberately preserves the original-owner marker, so the lifecycle must
 * normalize the ownership graph after the container move.
 */
function normalizeBetrayalTransfer(
  engine: GameEngineState,
  sourceUserId: string,
  recipientUserId: string,
  transferredPieceId: string,
) {
  rehomeGroupAfterPieceRemoval(
    engine,
    sourceUserId,
    transferredPieceId,
    transferredPieceId,
  );

  const recipient = engine.players.find((player) => player.userId === recipientUserId);
  const transferred = recipient?.pieces.find((piece) => piece.id === transferredPieceId);
  if (!recipient || !transferred) {
    throw new Error("배반 이동 후 소유권을 정규화할 말을 찾지 못했습니다.");
  }

  if (transferred.betrayalOriginalOwnerUserId === recipientUserId) {
    delete transferred.betrayalOriginalOwnerUserId;
  }
}

function maybeDeclareSourceWinnerAfterTransfer(
  engine: GameEngineState,
  userId: string,
  ownedIds: string[],
) {
  if (ownedIds.includes("AUG-031") || replacesNormalWinCondition(ownedIds)) return;
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

function betrayalRandomForSelectedPiece(
  engine: GameEngineState,
  sourceUserId: string,
  sourcePieceId: string | undefined,
  random: () => number,
) {
  if (!sourcePieceId) return random;
  const source = engine.players.find((player) => player.userId === sourceUserId);
  const waiting = source?.pieces.filter((piece) => piece.status === "WAITING") ?? [];
  const index = waiting.findIndex((piece) => piece.id === sourcePieceId);
  if (index < 0) throw new Error("배반으로 넘길 선택 말이 대기 상태가 아닙니다.");
  let firstCall = true;
  return () => {
    if (!firstCall) return random();
    firstCall = false;
    random();
    return Math.min(0.999999999999, (index + 0.5) / waiting.length);
  };
}

export function applyBetrayalAcquisitionLifecycle(
  engineInput: GameEngineState,
  sourceUserId: string,
  ownedByUser: Record<string, string[]>,
  setupsByUser: SetupsByUser,
  random: () => number = Math.random,
  sourcePieceId?: string,
) {
  const transfer = applyBetrayalTransfer(
    engineInput,
    sourceUserId,
    betrayalRandomForSelectedPiece(engineInput, sourceUserId, sourcePieceId, random),
  );
  normalizeBetrayalTransfer(
    transfer.engine,
    sourceUserId,
    transfer.recipientUserId,
    transfer.transferredPieceId,
  );
  transfer.engine = repairInvalidAugmentSetups(transfer.engine, ownedByUser, setupsByUser);
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
  acquisitionChoice?: { pieceId?: string };
  randomNext?: () => number;
  randomInt?: (maxExclusive: number) => number;
};

export type AugmentAcquisitionLifecycleResult = {
  engine: GameEngineState;
  immediateTransitionFrom?: GameEngineState;
};

/**
 * Canonical acquisition boundary.
 *
 * Existing augments keep their legacy behavior while migration is in progress.
 * New augments can register onAcquire hooks in the runtime registry without adding
 * another simulator/client-specific branch here.
 */
export function applyAugmentAcquisitionLifecycle({
  engine: engineInput,
  userId,
  augmentId,
  ownedByUser,
  setupsByUser,
  consumeA04UpgradePending = false,
  acquisitionChoice,
  randomNext = Math.random,
  randomInt = (maxExclusive) => Math.min(maxExclusive - 1, Math.floor(Math.random() * maxExclusive)),
}: AugmentAcquisitionLifecycleInput): AugmentAcquisitionLifecycleResult {
  let engine = engineInput;
  let immediateTransitionFrom: GameEngineState | undefined;

  // Preserve the effective-v11 ordering: AUG-031 scatters before common idea-runtime setup.
  if (augmentId === "AUG-031") {
    engine = applyMoonwalkAcquisitionScatter(engine, userId, randomNext);
  }

  engine.augmentRuntime ??= {};
  engine.augmentRuntime[userId] ??= {};
  const runtime = engine.augmentRuntime[userId];
  if (consumeA04UpgradePending) delete runtime.a04UpgradeNextAugment;

  if (augmentId === "AUG-047") armA04OnAcquisition(engine, userId);
  if (augmentId === "AUG-055") runtime.walkingTrailSegment = randomInt(4);
  if (augmentId === "AUG-045") {
    runtime.gravityExplosionRound = engine.round;
    runtime.gravityExplosionResolved = false;
  }
  if (augmentId === "AUG-046") armGachaMachineOnAcquisition(engine, userId);

  if (augmentId === "AUG-051") {
    immediateTransitionFrom = engine;
    engine = applyGreatUpheaval(
      engine,
      userId,
      ownedByUser,
      setupsByUser,
      randomNext,
    );
  }

  if (augmentId === "AUG-056") armWormholeOnAcquisition(engine, userId);
  if (augmentId === "AUG-058") {
    const owner = engine.players.find((candidate) => candidate.userId === userId);
    const waiting = owner?.pieces.filter((piece) => piece.status === "WAITING") ?? [];
    if (waiting.length > 0) {
      const target = acquisitionChoice?.pieceId
        ? waiting.find((piece) => piece.id === acquisitionChoice.pieceId)
        : waiting[randomInt(waiting.length)] ?? waiting[0];
      if (!target) throw new Error("토끼와 거북이로 선택한 대기 말을 찾지 못했습니다.");
      engine = applyTurtleAndHarePlacement(engine, userId, target.id);
    }
  }

  if (augmentId === "AUG-053") {
    engine = applyBetrayalAcquisitionLifecycle(
      engine,
      userId,
      ownedByUser,
      setupsByUser,
      randomNext,
      acquisitionChoice?.pieceId,
    ).engine;
  }

  initializeAugmentSetup(engine, userId, augmentId, setupsByUser);
  engine = dispatchAugmentHook("onAcquire", {
    engine,
    ownerUserId: userId,
    actorUserId: userId,
    augmentId,
    ownedByUser,
    setupsByUser,
    randomNext,
    randomInt,
    event: { acquiredAugmentId: augmentId },
  });
  engine = repairInvalidAugmentSetups(engine, ownedByUser, setupsByUser);

  return { engine, immediateTransitionFrom };
}
