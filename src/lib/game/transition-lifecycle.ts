import type { PlayerAugmentSetups } from "@/lib/augments/effects";
import { dispatchAllAugmentHooks } from "@/lib/augments/runtime-registry";
import { repairInvalidAugmentSetups } from "@/lib/augments/setup";
import type { GameEngineState } from "./types";

export type GameLifecycleContext = {
  ownedByUser: Record<string, string[]>;
  setupsByUser: Record<string, PlayerAugmentSetups>;
};

function capturedPieceIds(
  before: GameEngineState,
  after: GameEngineState,
  actorUserId: string,
) {
  const captured: string[] = [];
  for (const beforePlayer of before.players) {
    if (beforePlayer.userId === actorUserId) continue;
    const afterPlayer = after.players.find((candidate) => candidate.userId === beforePlayer.userId);
    if (!afterPlayer) continue;
    for (const piece of beforePlayer.pieces) {
      const next = afterPlayer.pieces.find((candidate) => candidate.id === piece.id);
      if (piece.status === "ON_BOARD" && next?.status === "WAITING") captured.push(piece.id);
    }
  }
  return captured;
}

/**
 * Canonical cross-cutting lifecycle for one completed game-state transition.
 *
 * Low-level rule functions should not know every augment that may react to their
 * transition. Instead the game layer emits stable lifecycle events here. Existing
 * legacy augments are unaffected until migrated; new hooked augments can subscribe
 * without adding another branch to simulation or unrelated engine code.
 */
export function applyPostTransitionAugmentLifecycle(
  before: GameEngineState,
  after: GameEngineState,
  actorUserId: string,
  actionKind: string,
  context: GameLifecycleContext,
  event: Readonly<Record<string, unknown>> = {},
) {
  let next = after;
  const capturedIds = capturedPieceIds(before, next, actorUserId);

  if (capturedIds.length > 0) {
    next = dispatchAllAugmentHooks("afterCapture", {
      engine: next,
      before,
      actorUserId,
      ownedByUser: context.ownedByUser,
      setupsByUser: context.setupsByUser,
      actionKind,
      event: { ...event, capturedPieceIds: capturedIds },
    });
  }

  next = dispatchAllAugmentHooks("afterAction", {
    engine: next,
    before,
    actorUserId,
    ownedByUser: context.ownedByUser,
    setupsByUser: context.setupsByUser,
    actionKind,
    event,
  });

  next = dispatchAllAugmentHooks("checkWin", {
    engine: next,
    before,
    actorUserId,
    ownedByUser: context.ownedByUser,
    setupsByUser: context.setupsByUser,
    actionKind,
    event,
  });

  const beforeTurnOwner = before.players.find((player) => player.seat === before.currentSeat)?.userId;
  const afterTurnOwner = next.players.find((player) => player.seat === next.currentSeat)?.userId;
  if (beforeTurnOwner && afterTurnOwner && beforeTurnOwner !== afterTurnOwner && !next.winnerUserId) {
    next = dispatchAllAugmentHooks("onTurnEnd", {
      engine: next,
      before,
      actorUserId: beforeTurnOwner,
      ownedByUser: context.ownedByUser,
      setupsByUser: context.setupsByUser,
      actionKind,
      event: { ...event, previousTurnOwnerUserId: beforeTurnOwner, nextTurnOwnerUserId: afterTurnOwner },
    });
    next = dispatchAllAugmentHooks("onTurnStart", {
      engine: next,
      before,
      actorUserId: afterTurnOwner,
      ownedByUser: context.ownedByUser,
      setupsByUser: context.setupsByUser,
      actionKind,
      event: { ...event, previousTurnOwnerUserId: beforeTurnOwner, nextTurnOwnerUserId: afterTurnOwner },
    });
  }

  return repairInvalidAugmentSetups(next, context.ownedByUser, context.setupsByUser);
}
