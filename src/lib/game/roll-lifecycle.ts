import { dispatchAllAugmentHooks } from "@/lib/augments/runtime-registry";
import { applyGodHandRoll, beginRollFlow, godHandChargeCount, rerollDoResult } from "./roll-flow";
import { castYut } from "./roll";
import { resolveS16Nak } from "./turn-lifecycle";
import { finalizeAction, type GameActionContext } from "./action-lifecycle";
import type { GameEngineState, RollFace } from "./types";

export type RollLifecycleInput = {
  context: GameActionContext;
  engine: GameEngineState;
  userId: string;
  randomRoll: () => number;
  randomEffect: () => number;
  nextTokenId: (label: string) => string;
  /** Active player policy chooses whether to spend AUG-044 and which face to request. */
  godHandFace?: RollFace | null;
};

export type RollLifecycleResult = {
  engine: GameEngineState;
  s16Checked: boolean;
  s16Occurred: boolean;
  actionKind: "roll" | "god_hand";
};

function withSeededMathRandom<T>(random: () => number, callback: () => T): T {
  const original = Math.random;
  Math.random = random;
  try {
    return callback();
  } finally {
    Math.random = original;
  }
}

/**
 * Canonical execution boundary for a pending roll.
 *
 * The caller may choose optional active decisions (currently AUG-044 God Hand), but all
 * automatic roll rules and before/after roll hooks are owned by the game layer.
 */
export function executeRollLifecycle({
  context,
  engine: engineInput,
  userId,
  randomRoll,
  randomEffect,
  nextTokenId,
  godHandFace = null,
}: RollLifecycleInput): RollLifecycleResult {
  const before = structuredClone(engineInput);
  const owned = context.ownedByUser[userId] ?? [];
  const setups = context.setupsByUser[userId] ?? {};
  const source = engineInput.pendingRolls[0] ?? null;

  let engine = dispatchAllAugmentHooks("beforeRoll", {
    engine: structuredClone(engineInput),
    before,
    actorUserId: userId,
    ownedByUser: context.ownedByUser,
    setupsByUser: context.setupsByUser,
    actionKind: "roll",
    event: { source },
  });

  const nak = resolveS16Nak(
    engine,
    userId,
    context.ownedByUser,
    setups,
    randomEffect,
    () => nextTokenId("nak-compensation"),
  );
  if (nak.occurred) {
    let next = dispatchAllAugmentHooks("afterRoll", {
      engine: nak.engine,
      before,
      actorUserId: userId,
      ownedByUser: context.ownedByUser,
      setupsByUser: context.setupsByUser,
      actionKind: "roll",
      event: { source, nak: true },
    });
    next = finalizeAction(before, next, userId, context, "roll", userId, { source, nak: true });
    return { engine: next, s16Checked: nak.checked, s16Occurred: true, actionKind: "roll" };
  }

  if (godHandFace != null) {
    if (engine.pendingRolls[0] !== "BASIC" || godHandChargeCount(engine, userId, owned) <= 0) {
      throw new Error("신의 손을 사용할 수 없는 던지기입니다.");
    }
    let next = applyGodHandRoll(engine, godHandFace, nextTokenId("god-hand"), owned, setups);
    next = dispatchAllAugmentHooks("afterRoll", {
      engine: next,
      before,
      actorUserId: userId,
      ownedByUser: context.ownedByUser,
      setupsByUser: context.setupsByUser,
      actionKind: "god_hand",
      event: { source, face: godHandFace, godHand: true },
    });
    next = finalizeAction(before, next, userId, context, "god_hand", userId, {
      source,
      face: godHandFace,
      godHand: true,
    });
    return { engine: next, s16Checked: nak.checked, s16Occurred: false, actionKind: "god_hand" };
  }

  const faces: [RollFace, RollFace] = [castYut(randomRoll), castYut(randomRoll)];
  let next = withSeededMathRandom(randomEffect, () => (
    beginRollFlow(engine, faces, nextTokenId("roll"), owned, setups)
  ));
  next = dispatchAllAugmentHooks("afterRoll", {
    engine: next,
    before,
    actorUserId: userId,
    ownedByUser: context.ownedByUser,
    setupsByUser: context.setupsByUser,
    actionKind: "roll",
    event: { source, faces },
  });
  next = finalizeAction(before, next, userId, context, "roll", userId, { source, faces });
  return { engine: next, s16Checked: nak.checked, s16Occurred: false, actionKind: "roll" };
}

export type DoRerollLifecycleInput = {
  context: GameActionContext;
  engine: GameEngineState;
  userId: string;
  randomRoll: () => number;
  nextTokenId: (label: string) => string;
};

/** AUG-012's actual rethrow uses the same roll hook boundary as a normal roll. */
export function executeDoRerollLifecycle({
  context,
  engine: engineInput,
  userId,
  randomRoll,
  nextTokenId,
}: DoRerollLifecycleInput) {
  const before = structuredClone(engineInput);
  const owned = context.ownedByUser[userId] ?? [];
  const setups = context.setupsByUser[userId] ?? {};
  let engine = dispatchAllAugmentHooks("beforeRoll", {
    engine: structuredClone(engineInput),
    before,
    actorUserId: userId,
    ownedByUser: context.ownedByUser,
    setupsByUser: context.setupsByUser,
    actionKind: "reroll_do",
    event: { source: "DO_REROLL" },
  });
  const face = castYut(randomRoll);
  let next = rerollDoResult(engine, face, nextTokenId("do-reroll"), owned, setups);
  next = dispatchAllAugmentHooks("afterRoll", {
    engine: next,
    before,
    actorUserId: userId,
    ownedByUser: context.ownedByUser,
    setupsByUser: context.setupsByUser,
    actionKind: "reroll_do",
    event: { source: "DO_REROLL", face },
  });
  return finalizeAction(before, next, userId, context, "reroll_do", userId, {
    source: "DO_REROLL",
    face,
  });
}
