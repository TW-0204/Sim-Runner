import type { PlayerAugmentSetups } from "@/lib/augments/effects";
import { dispatchAllAugmentHooks } from "@/lib/augments/runtime-registry";
import { repairInvalidAugmentSetups } from "@/lib/augments/setup";
import { applyPassiveSpecialWinner } from "./passive-win";
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

function turnOwnerUserId(engine: GameEngineState) {
  return engine.players.find((player) => player.seat === engine.currentSeat)?.userId ?? null;
}

function clearFinishedPlagueTurn(
  before: GameEngineState,
  after: GameEngineState,
  beforeTurnOwner: string | null,
  afterTurnOwner: string | null,
) {
  if (!beforeTurnOwner || !afterTurnOwner || beforeTurnOwner === afterTurnOwner) return;
  const runtime = after.augmentRuntime?.[beforeTurnOwner];
  if (!runtime?.plagueTurnActive) return;
  runtime.plaguePieceIds = {};
  runtime.plagueTurnActive = false;
}

/**
 * Idempotent legacy tail shared by every transition boundary.
 *
 * Keeping these cross-cutting rules in the game layer prevents simulators/clients
 * from carrying their own plague cleanup or passive-win mutations. It is safe to
 * call after a transition that already passed through the full hook lifecycle.
 */
export function applyCrossTransitionLegacyRules(
  before: GameEngineState,
  after: GameEngineState,
  context: GameLifecycleContext,
) {
  const beforeTurnOwner = turnOwnerUserId(before);
  const afterTurnOwner = turnOwnerUserId(after);
  clearFinishedPlagueTurn(before, after, beforeTurnOwner, afterTurnOwner);
  return applyPassiveSpecialWinner(after, context.ownedByUser);
}

/**
 * Canonical cross-cutting lifecycle for one completed game-state transition.
 *
 * Low-level rule functions should not know every augment that may react to their
 * transition. Instead the game layer emits stable lifecycle events here. Existing
 * legacy augments are unaffected until migrated; new hooked augments can subscribe
 * without adding another branch to simulation or unrelated engine code.
 *
 * This boundary also owns legacy cross-cutting cleanup/win rules that previously
 * lived in the simulator. That keeps every caller (simulation, UI, future network
 * runtime) on the same state-transition semantics.
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

  const beforeTurnOwner = turnOwnerUserId(before);
  const afterTurnOwner = turnOwnerUserId(next);
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

  next = repairInvalidAugmentSetups(next, context.ownedByUser, context.setupsByUser);
  return applyCrossTransitionLegacyRules(before, next, context);
}
