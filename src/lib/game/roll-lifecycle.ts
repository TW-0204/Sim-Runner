import { dispatchAllAugmentHooks } from "@/lib/augments/runtime-registry";
import { moveOwnedIdsForAthlete } from "./athlete";
import { legalMoveOptionsWithAugments } from "./engine";
import { FLAT_SIDE_PROBABILITY, castYut } from "./roll";
import {
  applyGodHandRoll,
  beginRollFlow,
  godHandChargeCount,
  keepDoResult,
  rerollDoResult,
} from "./roll-flow";
import { resolveS16Nak } from "./turn-lifecycle";
import {
  executeMoveAction,
  finalizeAction,
  type GameActionContext,
  type GameMoveArgs,
} from "./action-lifecycle";
import type { EngineMoveTarget } from "./engine";
import type { EnginePlayer, GameEngineState, RollFace, RollToken } from "./types";

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

function isSimulationPolicyContext(context: GameActionContext) {
  return typeof (context as GameActionContext & { seed?: unknown }).seed === "string";
}

function playerPositionValue(player: EnginePlayer) {
  let value = 0;
  const groupSizes = new Map<string, number>();

  for (const piece of player.pieces) {
    if (piece.status === "FINISHED") {
      value += 12_000;
      continue;
    }
    if (piece.status === "ON_BOARD") {
      value += 500 + piece.pathHistory.length * 85;
      groupSizes.set(piece.groupId, (groupSizes.get(piece.groupId) ?? 0) + 1);
      continue;
    }
    if (piece.hasEntered) value -= 280;
  }

  for (const size of groupSizes.values()) {
    if (size > 1) value += (size - 1) * 140;
  }
  return value;
}

function positionValue(engine: GameEngineState, userId: string) {
  if (engine.winnerUserId === userId) return 1_000_000_000;
  if (engine.winnerUserId) return -1_000_000_000;

  const player = engine.players.find((candidate) => candidate.userId === userId);
  if (!player) return -1_000_000_000;

  const own = playerPositionValue(player);
  const opponentValues = engine.players
    .filter((candidate) => candidate.userId !== userId)
    .map(playerPositionValue);
  const strongestOpponent = opponentValues.length ? Math.max(...opponentValues) : 0;
  const averageOpponent = opponentValues.length
    ? opponentValues.reduce((sum, value) => sum + value, 0) / opponentValues.length
    : 0;

  const current = engine.players.find((candidate) => candidate.seat === engine.currentSeat);
  const turnResources = current?.userId === userId
    ? engine.pendingRolls.length * 260 + engine.results.reduce((sum, result) => {
      if (result.numericPool) return sum + Math.max(0, result.finalSteps) * 20;
      if (result.face === "BACKDO") return sum + 25;
      return sum + Math.max(0, result.finalSteps) * 45;
    }, 0)
    : 0;

  return own
    - strongestOpponent * 0.72
    - averageOpponent * 0.28
    + turnResources;
}

function moveArgsForTarget(
  groupId: string,
  result: RollToken,
  target: EngineMoveTarget,
  moonwalk: boolean,
): GameMoveArgs {
  const args: GameMoveArgs = { groupId, resultId: result.id };
  if (!moonwalk && result.face === "BACKDO") {
    if (target.node != null) args.backwardTarget = target.node;
    return args;
  }
  if (target.kind === "CHASE" && target.node != null) args.forwardTarget = target.node;
  else if (target.path) args.forwardPath = [...target.path];
  return args;
}

function valueWithMoveLookahead(
  context: GameActionContext,
  engine: GameEngineState,
  userId: string,
) {
  const immediate = positionValue(engine, userId);
  if (engine.winnerUserId || engine.stage !== "MOVING") return immediate;
  const current = engine.players.find((candidate) => candidate.seat === engine.currentSeat);
  if (current?.userId !== userId) return immediate;

  const owned = context.ownedByUser[userId] ?? [];
  const setups = context.setupsByUser[userId] ?? {};
  const moveOwned = moveOwnedIdsForAthlete(owned);
  const legalOptions = legalMoveOptionsWithAugments(
    engine,
    userId,
    owned,
    setups,
    context.ownedByUser,
    moveOwned,
  );

  let best = immediate;
  for (const option of legalOptions) {
    try {
      const next = executeMoveAction(
        context,
        engine,
        userId,
        moveArgsForTarget(option.groupId, option.result, option.target, owned.includes("AUG-031")),
      );
      best = Math.max(best, positionValue(next, userId));
    } catch {
      // Invalid candidates are ignored; the authoritative engine remains final.
    }
  }
  return best;
}

function chooseSimulationGodHandFace(
  context: GameActionContext,
  engine: GameEngineState,
  userId: string,
) {
  const owned = context.ownedByUser[userId] ?? [];
  const setups = context.setupsByUser[userId] ?? {};
  const faces: RollFace[] = ["DO", "GAE", "GEOL", "YUT", "MO"];
  let best: { face: RollFace; score: number } | null = null;

  for (const face of faces) {
    try {
      const next = applyGodHandRoll(
        engine,
        face,
        `sim-policy-eval:god-hand:${face}`,
        owned,
        setups,
      );
      const score = valueWithMoveLookahead(context, next, userId);
      if (!best || score > best.score) best = { face, score };
    } catch {
      // Ignore invalid candidates.
    }
  }

  return best?.face ?? "MO";
}

function yutFaceProbabilities(): ReadonlyArray<readonly [RollFace, number]> {
  const p = FLAT_SIDE_PROBABILITY;
  const q = 1 - p;
  return [
    ["BACKDO", p * q ** 3],
    ["DO", 3 * p * q ** 3],
    ["GAE", 6 * p ** 2 * q ** 2],
    ["GEOL", 4 * p ** 3 * q],
    ["YUT", p ** 4],
    ["MO", q ** 4],
  ];
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
    const selectedFace = isSimulationPolicyContext(context)
      ? chooseSimulationGodHandFace(context, engine, userId)
      : godHandFace;
    let next = applyGodHandRoll(engine, selectedFace, nextTokenId("god-hand"), owned, setups);
    next = dispatchAllAugmentHooks("afterRoll", {
      engine: next,
      before,
      actorUserId: userId,
      ownedByUser: context.ownedByUser,
      setupsByUser: context.setupsByUser,
      actionKind: "god_hand",
      event: { source, face: selectedFace, godHand: true },
    });
    next = finalizeAction(before, next, userId, context, "god_hand", userId, {
      source,
      face: selectedFace,
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

  if (isSimulationPolicyContext(context)) {
    let keepEngine: GameEngineState | null = null;
    let keepScore = Number.NEGATIVE_INFINITY;
    try {
      const kept = keepDoResult(engine, owned);
      keepEngine = finalizeAction(before, kept, userId, context, "keep_do", userId, {
        source: "DO_REROLL",
        kept: true,
      });
      keepScore = valueWithMoveLookahead(context, keepEngine, userId);
    } catch {
      // Keep is only unavailable in a malformed choice state.
    }

    let rerollExpectedScore = 0;
    let probabilityMass = 0;
    for (const [face, probability] of yutFaceProbabilities()) {
      try {
        const next = rerollDoResult(
          engine,
          face,
          `sim-policy-eval:do-reroll:${face}`,
          owned,
          setups,
        );
        rerollExpectedScore += probability * valueWithMoveLookahead(context, next, userId);
        probabilityMass += probability;
      } catch {
        // Ignore invalid outcomes.
      }
    }
    if (probabilityMass > 0) rerollExpectedScore /= probabilityMass;

    if (keepEngine && keepScore >= rerollExpectedScore) return keepEngine;
  }

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
