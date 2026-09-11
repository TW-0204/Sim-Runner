import type { PlayerAugmentSetups } from "@/lib/augments/effects";
import { dispatchAllAugmentHooks } from "@/lib/augments/runtime-registry";
import {
  markAthleteDisqualified,
  markAthleteMovement,
  maybeGrantAthleteExtraRoll,
  moveOwnedIdsForAthlete,
  prepareAthleteCoexistence,
} from "./athlete";
import { maybePauseCaptureChoices } from "./capture-choice";
import {
  applyGrandUnity,
  applyMove,
  applyRelocationChoice,
  applyStackChoice,
} from "./engine";
import { markNumberSplitSibling, normalizeNumberPool } from "./number-cells";
import { maybePauseSelfRelianceAfterMovement } from "./self-reliance";
import { applyPostTransitionAugmentLifecycle } from "./transition-lifecycle";
import type { GameEngineState } from "./types";

export type GameActionContext = {
  ownedByUser: Record<string, string[]>;
  setupsByUser: Record<string, PlayerAugmentSetups>;
};

export type GameMoveArgs = Parameters<typeof applyMove>[1];

function actorOwned(context: GameActionContext, userId: string) {
  return context.ownedByUser[userId] ?? [];
}

function actorSetups(context: GameActionContext, userId: string) {
  return context.setupsByUser[userId] ?? {};
}

/**
 * Common post-action rules belong to the game layer, not to a simulator/client.
 * The caller decides which action to take; this function applies the canonical
 * lifecycle that follows that action.
 */
export function finalizeAction(
  before: GameEngineState,
  after: GameEngineState,
  actorUserId: string,
  context: GameActionContext,
  actionKind: string,
  postActionUserId = actorUserId,
  event: Readonly<Record<string, unknown>> = {},
) {
  let next = after;
  if (next.stage !== "CAPTURE_CHOICE" && actionKind !== "capture_choice") {
    next = maybeGrantAthleteExtraRoll(before, next, actorUserId, actorOwned(context, actorUserId));
  }
  if (next.stage !== "CAPTURE_CHOICE") {
    next = normalizeNumberPool(next, postActionUserId, actorOwned(context, postActionUserId));
  }
  return applyPostTransitionAugmentLifecycle(
    before,
    next,
    actorUserId,
    actionKind,
    context,
    event,
  );
}

export function executeMoveAction(
  context: GameActionContext,
  engineInput: GameEngineState,
  userId: string,
  args: GameMoveArgs,
) {
  const turnSnapshot = structuredClone(engineInput);
  let engine = structuredClone(engineInput);
  const owned = actorOwned(context, userId);
  const moveEvent = {
    groupId: args.groupId,
    resultId: args.resultId,
    backwardTarget: args.backwardTarget,
    forwardTarget: args.forwardTarget,
    forwardPath: args.forwardPath,
  };

  engine = dispatchAllAugmentHooks("beforeMove", {
    engine,
    before: turnSnapshot,
    actorUserId: userId,
    ownedByUser: context.ownedByUser,
    setupsByUser: context.setupsByUser,
    actionKind: "move",
    event: moveEvent,
  });

  markAthleteMovement(engine, userId, owned);
  const coexistence = prepareAthleteCoexistence(engine, userId, owned, context.ownedByUser);
  let next = applyMove(
    engine,
    args,
    moveOwnedIdsForAthlete(owned),
    actorSetups(context, userId),
    coexistence.ownedByUser,
  );
  coexistence.restore(next);
  next = dispatchAllAugmentHooks("afterMove", {
    engine: next,
    before: turnSnapshot,
    actorUserId: userId,
    ownedByUser: context.ownedByUser,
    setupsByUser: context.setupsByUser,
    actionKind: "move",
    event: moveEvent,
  });
  next = markNumberSplitSibling(engine, next, userId, args.groupId, args.resultId);
  next = maybePauseSelfRelianceAfterMovement(turnSnapshot, next, userId, owned);
  next = maybePauseCaptureChoices(turnSnapshot, next, {
    attackerUserId: userId,
    attackerGroupId: args.groupId,
    resultId: args.resultId,
    ownedByUser: context.ownedByUser,
  });
  if (next.stage === "CAPTURE_CHOICE") {
    next.round = turnSnapshot.round;
    next.turnNumber = turnSnapshot.turnNumber;
  }
  return finalizeAction(turnSnapshot, next, userId, context, "move", userId, moveEvent);
}

export function executeStackAction(
  context: GameActionContext,
  engineInput: GameEngineState,
  userId: string,
  stack: boolean,
) {
  const before = structuredClone(engineInput);
  const engine = structuredClone(engineInput);
  const owned = actorOwned(context, userId);
  if (stack) markAthleteDisqualified(engine, userId, owned);
  const next = applyStackChoice(engine, stack, owned);
  return finalizeAction(before, next, userId, context, "stack", userId, { stack });
}

export function executeRelocationAction(
  context: GameActionContext,
  engineInput: GameEngineState,
  userId: string,
  groupId: string | null,
) {
  const before = structuredClone(engineInput);
  const engine = structuredClone(engineInput);
  const owned = actorOwned(context, userId);
  if (groupId) markAthleteDisqualified(engine, userId, owned);
  const next = applyRelocationChoice(engine, groupId, owned);
  return finalizeAction(before, next, userId, context, "relocate", userId, { groupId });
}

export function executeGrandUnityAction(
  context: GameActionContext,
  engineInput: GameEngineState,
  userId: string,
  anchorGroupId: string,
) {
  const before = structuredClone(engineInput);
  const engine = structuredClone(engineInput);
  const owned = actorOwned(context, userId);
  markAthleteDisqualified(engine, userId, owned);
  const next = applyGrandUnity(engine, anchorGroupId, owned);
  return finalizeAction(before, next, userId, context, "grand_unity", userId, { anchorGroupId });
}
