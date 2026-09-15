import type { PlayerAugmentSetups } from "@/lib/augments/effects";
import { applyLoneWolfAllyCapture } from "@/lib/game/ally-capture";
import {
  executeGrandUnityAction,
  executeMoveAction,
  executeRelocationAction,
  executeStackAction,
  finalizeAction,
  type GameActionContext,
  type GameMoveArgs,
} from "@/lib/game/action-lifecycle";
import {
  applyGachaMachine,
  applyWormholeTurn,
  expireWormholeForCurrentRound,
  gachaMachineIsReady,
  legalMoveOptionsWithAugments,
  wormholeIsOpen,
  type EngineMoveTarget,
} from "@/lib/game/engine";
import { moveOwnedIdsForAthlete } from "@/lib/game/athlete";
import { allocateNumberPool, splitNumberResult } from "@/lib/game/number-cells";
import { FLAT_SIDE_PROBABILITY } from "@/lib/game/roll";
import {
  applyGodHandRoll,
  beginRollFlow,
  godHandChargeCount,
  keepDoResult,
  rerollDoResult,
  resolveDualRollChoice,
} from "@/lib/game/roll-flow";
import { executeDoRerollLifecycle, executeRollLifecycle, type RollLifecycleResult } from "@/lib/game/roll-lifecycle";
import { applySelfRelianceSplit } from "@/lib/game/self-reliance";
import { saveResultForTomorrow } from "@/lib/game/tomorrow";
import type { GameEngineState, PieceState, RollFace, RollToken } from "@/lib/game/types";
import { resolveCandidateActions, type CandidateAction } from "./candidate-action";
import type { SimulationActionKind } from "./triggers";

const GACHA_NODES = Array.from({ length: 29 }, (_, index) => index + 1);

type PolicyContext = GameActionContext & {
  seed: string;
  randomRoll: () => number;
  randomEffect: () => number;
  nextTokenId: (label: string) => string;
  scoreTransition: (before: GameEngineState, after: GameEngineState, userId: string) => number;
  canonicalizeActual: (
    before: GameEngineState,
    after: GameEngineState,
    actorUserId: string,
    actionKind: SimulationActionKind,
    event?: Readonly<Record<string, unknown>>,
  ) => GameEngineState;
};

export type SimulationDecision = {
  before: GameEngineState;
  engine: GameEngineState;
  actionKind: SimulationActionKind;
  candidateKey: string;
  augmentId: string | null;
  payload: Record<string, unknown>;
  score: number;
  rollLifecycle?: Pick<RollLifecycleResult, "s16Checked" | "s16Occurred">;
};

type EngineCandidate = CandidateAction<GameEngineState>;

function previewContext(context: PolicyContext): GameActionContext {
  return {
    ownedByUser: structuredClone(context.ownedByUser),
    setupsByUser: structuredClone(context.setupsByUser),
  };
}

function actorOwned(context: PolicyContext, userId: string) {
  return context.ownedByUser[userId] ?? [];
}

function actorSetups(context: PolicyContext, userId: string) {
  return context.setupsByUser[userId] ?? {};
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

function moveArgsForTarget(groupId: string, result: RollToken, target: EngineMoveTarget, moonwalk: boolean): GameMoveArgs {
  const args: GameMoveArgs = { groupId, resultId: result.id };
  if (!moonwalk && result.face === "BACKDO") {
    if (target.node != null) args.backwardTarget = target.node;
    return args;
  }
  if (target.kind === "CHASE" && target.node != null) args.forwardTarget = target.node;
  else if (target.path) args.forwardPath = [...target.path];
  return args;
}

function evaluatePreview(
  context: PolicyContext,
  before: GameEngineState,
  userId: string,
  preview: () => GameEngineState,
  withMoveLookahead = false,
) {
  const after = preview();
  const immediate = context.scoreTransition(before, after, userId);
  if (!withMoveLookahead || after.winnerUserId || after.stage !== "MOVING") return immediate;
  const actor = after.players.find((player) => player.seat === after.currentSeat);
  if (actor?.userId !== userId) return immediate;

  const moveCandidates = movementCandidates(context, after, userId, false);
  let best = immediate;
  for (const candidate of moveCandidates) {
    try {
      const score = candidate.evaluate?.() ?? Number.NEGATIVE_INFINITY;
      if (score > best) best = score;
    } catch {
      // Invalid preview is not a candidate.
    }
  }
  return best;
}

function evaluatedCandidate(input: {
  key: string;
  actionKind: SimulationActionKind;
  augmentId?: string;
  payload?: Record<string, unknown>;
  context: PolicyContext;
  before: GameEngineState;
  userId: string;
  preview: () => GameEngineState;
  execute: () => GameEngineState;
  moveLookahead?: boolean;
  scoreOverride?: () => number;
}): EngineCandidate {
  return {
    key: input.key,
    action: input.actionKind,
    augmentId: input.augmentId,
    payload: input.payload ?? {},
    evaluate: input.scoreOverride ?? (() => evaluatePreview(
      input.context,
      input.before,
      input.userId,
      input.preview,
      Boolean(input.moveLookahead),
    )),
    execute: input.execute,
  };
}

function resolve(
  context: PolicyContext,
  before: GameEngineState,
  userId: string,
  candidates: EngineCandidate[],
  rollLifecycleRef?: () => RollLifecycleResult | null,
): SimulationDecision | null {
  const resolved = resolveCandidateActions(candidates, { scoreState: () => 0 });
  if (!resolved) return null;
  const rollLifecycle = rollLifecycleRef?.() ?? null;
  return {
    before,
    engine: resolved.state,
    actionKind: resolved.candidate.action as SimulationActionKind,
    candidateKey: resolved.candidate.key,
    augmentId: resolved.candidate.augmentId ?? null,
    payload: resolved.candidate.payload,
    score: resolved.score,
    rollLifecycle: rollLifecycle
      ? { s16Checked: rollLifecycle.s16Checked, s16Occurred: rollLifecycle.s16Occurred }
      : undefined,
  };
}

function movementCandidates(
  context: PolicyContext,
  engine: GameEngineState,
  userId: string,
  withMoveLookahead = false,
): EngineCandidate[] {
  const owned = actorOwned(context, userId);
  const setups = actorSetups(context, userId);
  const moveOwned = moveOwnedIdsForAthlete(owned);
  const legalOptions = legalMoveOptionsWithAugments(
    engine,
    userId,
    owned,
    setups,
    context.ownedByUser,
    moveOwned,
  );

  return legalOptions.map((option) => {
    const args = moveArgsForTarget(option.groupId, option.result, option.target, owned.includes("AUG-031"));
    const pathKey = option.target.path?.join("-") ?? "";
    return evaluatedCandidate({
      key: `move:${option.groupId}:${option.result.id}:${option.target.kind}:${option.target.node ?? "none"}:${pathKey}`,
      actionKind: "move",
      context,
      before: engine,
      userId,
      payload: {
        groupId: option.groupId,
        resultId: option.result.id,
        targetKind: option.target.kind,
        targetNode: option.target.node,
      },
      preview: () => executeMoveAction(previewContext(context), engine, userId, args),
      execute: () => executeMoveAction(context, engine, userId, args),
      moveLookahead: withMoveLookahead,
    });
  });
}

function naturalRollExpectedScore(context: PolicyContext, engine: GameEngineState, userId: string) {
  const owned = actorOwned(context, userId);
  const setups = actorSetups(context, userId);
  let weighted = 0;
  let mass = 0;
  for (const [firstFace, firstProbability] of yutFaceProbabilities()) {
    for (const [secondFace, secondProbability] of yutFaceProbabilities()) {
      const probability = firstProbability * secondProbability;
      try {
        const previewCtx = previewContext(context);
        const rolled = beginRollFlow(
          engine,
          [firstFace, secondFace],
          `candidate:natural:${engine.turnNumber}:${firstFace}:${secondFace}`,
          owned,
          setups,
        );
        const next = finalizeAction(engine, rolled, userId, previewCtx, "roll");
        weighted += probability * evaluatePreview(context, engine, userId, () => next, true);
        mass += probability;
      } catch {
        // Invalid transformed pair is excluded from the expectation.
      }
    }
  }
  return mass > 0 ? weighted / mass : Number.NEGATIVE_INFINITY;
}

function grandUnityCandidates(context: PolicyContext, engine: GameEngineState, userId: string) {
  const owned = actorOwned(context, userId);
  if (!owned.includes("AUG-038") || owned.includes("AUG-017") || engine.stage !== "AWAITING_ROLL") return [];
  if (engine.augmentRuntime?.[userId]?.grandUnityUsed) return [];
  const player = engine.players.find((candidate) => candidate.userId === userId);
  if (!player) return [];
  const groupIds = [...new Set(player.pieces
    .filter((piece) => piece.status === "ON_BOARD" && piece.node != null)
    .map((piece) => piece.groupId))].sort();
  if (groupIds.length < 3) return [];

  return groupIds.map((anchorGroupId) => evaluatedCandidate({
    key: `augment:AUG-038:grand-unity:${anchorGroupId}`,
    actionKind: "grand_unity",
    augmentId: "AUG-038",
    payload: { anchorGroupId },
    context,
    before: engine,
    userId,
    preview: () => executeGrandUnityAction(previewContext(context), engine, userId, anchorGroupId),
    execute: () => executeGrandUnityAction(context, engine, userId, anchorGroupId),
    moveLookahead: true,
  }));
}

function wormholeGroups(engine: GameEngineState, userId: string) {
  const player = engine.players.find((candidate) => candidate.userId === userId);
  if (!player) return [];
  return [...new Set(player.pieces
    .filter((piece) => piece.status === "ON_BOARD" && piece.node != null)
    .map((piece) => piece.groupId))].sort();
}

function wormholeCandidates(context: PolicyContext, engine: GameEngineState, userId: string) {
  const owned = actorOwned(context, userId);
  if (!wormholeIsOpen(engine, userId, owned)) return [];
  return wormholeGroups(engine, userId).map((groupId) => evaluatedCandidate({
    key: `augment:AUG-056:wormhole:${groupId}`,
    actionKind: "wormhole",
    augmentId: "AUG-056",
    payload: { groupId },
    context,
    before: engine,
    userId,
    preview: () => applyWormholeTurn(engine, userId, groupId, owned),
    execute: () => context.canonicalizeActual(
      engine,
      applyWormholeTurn(engine, userId, groupId, owned),
      userId,
      "wormhole",
      { groupId },
    ),
  }));
}

function gachaLandingScore(
  context: PolicyContext,
  engine: GameEngineState,
  sourceUserId: string,
  targetUserId: string,
  pieceId: string,
  landedNode: number,
) {
  const result = applyGachaMachine(
    engine,
    sourceUserId,
    targetUserId,
    pieceId,
    landedNode,
    context.ownedByUser,
    () => 0,
  );
  return context.scoreTransition(engine, result.engine, sourceUserId);
}

function gachaCandidates(context: PolicyContext, engine: GameEngineState, userId: string) {
  const owned = actorOwned(context, userId);
  if (!gachaMachineIsReady(engine, userId, owned)) return [];

  const targets = engine.players.flatMap((player) => player.pieces
    .filter((piece) => piece.status === "ON_BOARD" && piece.node != null)
    .map((piece) => ({ targetUserId: player.userId, pieceId: piece.id })));
  const scoreCache = new Map<string, Map<number, number>>();

  const scoresFor = (targetUserId: string, pieceId: string) => {
    const cacheKey = `${targetUserId}:${pieceId}`;
    const cached = scoreCache.get(cacheKey);
    if (cached) return cached;
    const scores = new Map<number, number>();
    for (const node of GACHA_NODES) {
      try {
        scores.set(node, gachaLandingScore(context, engine, userId, targetUserId, pieceId, node));
      } catch {
        // Invalid targets are omitted from the expected value cache.
      }
    }
    scoreCache.set(cacheKey, scores);
    return scores;
  };

  const candidates: EngineCandidate[] = [];
  for (const target of targets) {
    for (const desiredNode of GACHA_NODES) {
      candidates.push(evaluatedCandidate({
        key: `augment:AUG-046:gacha:${target.targetUserId}:${target.pieceId}:${desiredNode}`,
        actionKind: "augment_event",
        augmentId: "AUG-046",
        payload: { targetUserId: target.targetUserId, pieceId: target.pieceId, desiredNode },
        context,
        before: engine,
        userId,
        scoreOverride: () => {
          const scores = scoresFor(target.targetUserId, target.pieceId);
          const desired = scores.get(desiredNode);
          if (desired == null || scores.size !== GACHA_NODES.length) return Number.NEGATIVE_INFINITY;
          const total = [...scores.values()].reduce((sum, score) => sum + score, 0);
          return 0.2 * desired + (0.8 / (GACHA_NODES.length - 1)) * (total - desired);
        },
        preview: () => engine,
        execute: () => {
          const result = applyGachaMachine(
            engine,
            userId,
            target.targetUserId,
            target.pieceId,
            desiredNode,
            context.ownedByUser,
            context.randomEffect,
          );
          return context.canonicalizeActual(
            engine,
            result.engine,
            userId,
            "augment_event",
            { kind: "gacha_machine", augmentId: "AUG-046", desiredNode },
          );
        },
      }));
    }
  }
  return candidates;
}

function rollCandidate(
  context: PolicyContext,
  engine: GameEngineState,
  userId: string,
  lifecycleRef: { current: RollLifecycleResult | null },
): EngineCandidate {
  return evaluatedCandidate({
    key: "roll:natural",
    actionKind: "roll",
    context,
    before: engine,
    userId,
    scoreOverride: () => naturalRollExpectedScore(context, engine, userId),
    preview: () => engine,
    execute: () => {
      const result = executeRollLifecycle({
        context,
        engine,
        userId,
        randomRoll: context.randomRoll,
        randomEffect: context.randomEffect,
        nextTokenId: context.nextTokenId,
        godHandFace: null,
      });
      lifecycleRef.current = result;
      return result.engine;
    },
  });
}

function godHandCandidates(
  context: PolicyContext,
  engine: GameEngineState,
  userId: string,
  lifecycleRef: { current: RollLifecycleResult | null },
) {
  const owned = actorOwned(context, userId);
  if (engine.pendingRolls[0] !== "BASIC" || !owned.includes("AUG-044") || godHandChargeCount(engine, userId, owned) <= 0) return [];
  const setups = actorSetups(context, userId);
  const faces: RollFace[] = ["DO", "GAE", "GEOL", "YUT", "MO"];
  return faces.map((face) => evaluatedCandidate({
    key: `augment:AUG-044:god-hand:${face}`,
    actionKind: "roll",
    augmentId: "AUG-044",
    payload: { face },
    context,
    before: engine,
    userId,
    preview: () => {
      const previewCtx = previewContext(context);
      const next = applyGodHandRoll(
        engine,
        face,
        `candidate:god-hand:${engine.turnNumber}:${face}`,
        owned,
        setups,
      );
      return finalizeAction(engine, next, userId, previewCtx, "god_hand");
    },
    execute: () => {
      const result = executeRollLifecycle({
        context,
        engine,
        userId,
        randomRoll: context.randomRoll,
        randomEffect: context.randomEffect,
        nextTokenId: context.nextTokenId,
        godHandFace: face,
      });
      lifecycleRef.current = result;
      return result.engine;
    },
    moveLookahead: true,
  }));
}

export function resolveAwaitingRollDecision(
  context: PolicyContext,
  engineInput: GameEngineState,
  userId: string,
): SimulationDecision | null {
  const owned = actorOwned(context, userId);
  let engine = engineInput;
  if (wormholeIsOpen(engine, userId, owned) && wormholeGroups(engine, userId).length === 0) {
    engine = expireWormholeForCurrentRound(engine, userId, owned);
  }

  const lifecycleRef = { current: null as RollLifecycleResult | null };
  const candidates: EngineCandidate[] = [
    rollCandidate(context, engine, userId, lifecycleRef),
    ...godHandCandidates(context, engine, userId, lifecycleRef),
    ...grandUnityCandidates(context, engine, userId),
    ...wormholeCandidates(context, engine, userId),
    ...gachaCandidates(context, engine, userId),
  ];
  return resolve(context, engine, userId, candidates, () => lifecycleRef.current);
}

function dualRollCandidates(context: PolicyContext, engine: GameEngineState, userId: string) {
  const pending = engine.pendingRollChoice;
  if (!pending || pending.kind !== "DUAL") return [];
  const owned = actorOwned(context, userId);
  const setups = actorSetups(context, userId);
  return ([0, 1] as const).map((choiceIndex) => evaluatedCandidate({
    key: `roll-choice:dual:${choiceIndex}`,
    actionKind: "choose_roll",
    payload: { choiceIndex },
    context,
    before: engine,
    userId,
    preview: () => {
      const next = resolveDualRollChoice(
        engine,
        choiceIndex,
        `candidate:dual:${engine.turnNumber}:${choiceIndex}`,
        owned,
        setups,
      );
      return finalizeAction(engine, next, userId, previewContext(context), "choose_roll");
    },
    execute: () => {
      const next = resolveDualRollChoice(engine, choiceIndex, context.nextTokenId("dual"), owned, setups);
      return finalizeAction(engine, next, userId, context, "choose_roll");
    },
    moveLookahead: true,
  }));
}

function doRerollCandidates(context: PolicyContext, engine: GameEngineState, userId: string) {
  const pending = engine.pendingRollChoice;
  if (!pending || pending.kind !== "DO_REROLL") return [];
  const owned = actorOwned(context, userId);
  const setups = actorSetups(context, userId);

  const keep = evaluatedCandidate({
    key: "augment:AUG-012:keep-do",
    actionKind: "reroll_do",
    augmentId: "AUG-012",
    payload: { choice: "keep" },
    context,
    before: engine,
    userId,
    preview: () => finalizeAction(
      engine,
      keepDoResult(engine, owned),
      userId,
      previewContext(context),
      "keep_do",
    ),
    execute: () => finalizeAction(engine, keepDoResult(engine, owned), userId, context, "keep_do"),
    moveLookahead: true,
  });

  const reroll = evaluatedCandidate({
    key: "augment:AUG-012:reroll-do",
    actionKind: "reroll_do",
    augmentId: "AUG-012",
    payload: { choice: "reroll" },
    context,
    before: engine,
    userId,
    scoreOverride: () => {
      let weighted = 0;
      let mass = 0;
      for (const [face, probability] of yutFaceProbabilities()) {
        try {
          const next = rerollDoResult(
            engine,
            face,
            `candidate:do-reroll:${engine.turnNumber}:${face}`,
            owned,
            setups,
          );
          const finalized = finalizeAction(engine, next, userId, previewContext(context), "reroll_do");
          weighted += probability * evaluatePreview(context, engine, userId, () => finalized, true);
          mass += probability;
        } catch {
          // Invalid transformed result is excluded.
        }
      }
      return mass > 0 ? weighted / mass : Number.NEGATIVE_INFINITY;
    },
    preview: () => engine,
    execute: () => executeDoRerollLifecycle({
      context,
      engine,
      userId,
      randomRoll: context.randomRoll,
      nextTokenId: context.nextTokenId,
    }),
  });
  return [keep, reroll];
}

export function resolveRollChoiceDecision(context: PolicyContext, engine: GameEngineState, userId: string) {
  return resolve(context, engine, userId, [
    ...dualRollCandidates(context, engine, userId),
    ...doRerollCandidates(context, engine, userId),
  ]);
}

function tomorrowCandidates(context: PolicyContext, engine: GameEngineState, userId: string) {
  const owned = actorOwned(context, userId);
  if (!owned.includes("AUG-028") || engine.stage !== "MOVING") return [];
  const runtime = engine.augmentRuntime?.[userId];
  if (runtime?.tomorrowStoredResult || runtime?.tomorrowSavedAtTurnNumber === engine.turnNumber) return [];
  return engine.results
    .filter((result) => !result.numericPool && !result.id.startsWith("tomorrow:"))
    .map((result) => evaluatedCandidate({
      key: `augment:AUG-028:save:${result.id}`,
      actionKind: "save_result",
      augmentId: "AUG-028",
      payload: { resultId: result.id },
      context,
      before: engine,
      userId,
      preview: () => finalizeAction(
        engine,
        saveResultForTomorrow(engine, userId, result.id, owned),
        userId,
        previewContext(context),
        "save_result",
      ),
      execute: () => finalizeAction(
        engine,
        saveResultForTomorrow(engine, userId, result.id, owned),
        userId,
        context,
        "save_result",
      ),
      moveLookahead: true,
    }));
}

function numberSplitCandidates(context: PolicyContext, engine: GameEngineState, userId: string) {
  const owned = actorOwned(context, userId);
  if (!owned.includes("AUG-024") || owned.includes("AUG-063") || engine.stage !== "MOVING") return [];
  if (engine.results.some((result) => result.numericBatchId)) return [];
  const actions: EngineCandidate[] = [];
  for (const result of engine.results) {
    if (result.face === "BACKDO" || result.numericAllocated || result.numericPool || result.finalSteps < 2) continue;
    for (let firstSteps = 1; firstSteps < result.finalSteps; firstSteps += 1) {
      actions.push(evaluatedCandidate({
        key: `augment:AUG-024:split-number:${result.id}:${firstSteps}`,
        actionKind: "split_number",
        augmentId: "AUG-024",
        payload: { resultId: result.id, firstSteps },
        context,
        before: engine,
        userId,
        preview: () => finalizeAction(
          engine,
          splitNumberResult(engine, userId, result.id, firstSteps, owned),
          userId,
          previewContext(context),
          "split_number",
        ),
        execute: () => finalizeAction(
          engine,
          splitNumberResult(engine, userId, result.id, firstSteps, owned),
          userId,
          context,
          "split_number",
        ),
        moveLookahead: true,
      }));
    }
  }
  return actions;
}

function numberPoolCandidates(context: PolicyContext, engine: GameEngineState, userId: string) {
  const owned = actorOwned(context, userId);
  if (!owned.includes("AUG-063") || engine.stage !== "MOVING") return [];
  const pool = engine.results.find((result) => result.numericPool);
  if (!pool) return [];
  const actions: EngineCandidate[] = [];
  for (let steps = 1; steps <= pool.finalSteps; steps += 1) {
    actions.push(evaluatedCandidate({
      key: `augment:AUG-063:allocate:${steps}`,
      actionKind: "allocate_number_pool",
      augmentId: "AUG-063",
      payload: { steps },
      context,
      before: engine,
      userId,
      preview: () => finalizeAction(
        engine,
        allocateNumberPool(engine, userId, steps, owned),
        userId,
        previewContext(context),
        "allocate_number_pool",
      ),
      execute: () => finalizeAction(
        engine,
        allocateNumberPool(engine, userId, steps, owned),
        userId,
        context,
        "allocate_number_pool",
      ),
      moveLookahead: true,
    }));
  }
  return actions;
}

export function resolveMovingDecision(context: PolicyContext, engine: GameEngineState, userId: string) {
  return resolve(context, engine, userId, [
    ...movementCandidates(context, engine, userId, true),
    ...tomorrowCandidates(context, engine, userId),
    ...numberSplitCandidates(context, engine, userId),
    ...numberPoolCandidates(context, engine, userId),
  ]);
}

function captureCandidates(context: PolicyContext, engine: GameEngineState) {
  const pending = engine.pendingCaptureChoice;
  const decision = pending?.decisions[0];
  if (!pending || !decision) return { userId: null, candidates: [] as EngineCandidate[] };
  const chooserUserId = decision.chooserUserId;
  const attackerUserId = pending.attackerUserId;
  const choices = decision.kind === "INSURANCE"
    ? decision.pieceIds.map((pieceId) => ({ pieceId, targetKey: null as string | null }))
    : [
        { pieceId: null as string | null, targetKey: null as string | null },
        ...decision.targets.map((target) => ({ pieceId: null as string | null, targetKey: target.key })),
      ];

  const candidates = choices.map((choice) => {
    const payload = choice.pieceId ? { pieceId: choice.pieceId } : { targetKey: choice.targetKey };
    return evaluatedCandidate({
      key: decision.kind === "INSURANCE"
        ? `augment:AUG-026:insurance:${choice.pieceId}`
        : `augment:AUG-035:double-hit:${choice.targetKey ?? "skip"}`,
      actionKind: "capture_choice",
      augmentId: decision.kind === "INSURANCE" ? "AUG-026" : "AUG-035",
      payload,
      context,
      before: engine,
      userId: chooserUserId,
      preview: () => finalizeAction(
        engine,
        applyCaptureChoice(engine, chooserUserId, payload, context.ownedByUser),
        chooserUserId,
        previewContext(context),
        "capture_choice",
        attackerUserId,
      ),
      execute: () => finalizeAction(
        engine,
        applyCaptureChoice(engine, chooserUserId, payload, context.ownedByUser),
        chooserUserId,
        context,
        "capture_choice",
        attackerUserId,
      ),
    });
  });
  return { userId: chooserUserId, candidates };
}

export function resolveCaptureDecision(context: PolicyContext, engine: GameEngineState) {
  const generated = captureCandidates(context, engine);
  if (!generated.userId) return null;
  return resolve(context, engine, generated.userId, generated.candidates);
}

export function resolveRelocationDecision(context: PolicyContext, engine: GameEngineState, userId: string) {
  const current = engine.pendingRelocationChoice?.opportunities[0];
  if (!current) return null;
  const augmentId = current.kind === "FRIEND" ? "AUG-015" : "AUG-066";
  const candidates = [null, ...current.candidateGroupIds].map((groupId) => evaluatedCandidate({
    key: `augment:${augmentId}:relocate:${groupId ?? "skip"}`,
    actionKind: "relocate",
    augmentId,
    payload: { groupId },
    context,
    before: engine,
    userId,
    preview: () => executeRelocationAction(previewContext(context), engine, userId, groupId),
    execute: () => executeRelocationAction(context, engine, userId, groupId),
  }));
  return resolve(context, engine, userId, candidates);
}

export function resolveStackDecision(context: PolicyContext, engine: GameEngineState, userId: string) {
  const candidates: EngineCandidate[] = ([false, true] as const).map((stack) => evaluatedCandidate({
    key: `stack:${stack ? "yes" : "no"}`,
    actionKind: "stack",
    payload: { stack },
    context,
    before: engine,
    userId,
    preview: () => executeStackAction(previewContext(context), engine, userId, stack),
    execute: () => executeStackAction(context, engine, userId, stack),
  }));

  if (actorOwned(context, userId).includes("AUG-043")) {
    candidates.push(evaluatedCandidate({
      key: "augment:AUG-043:ally-capture",
      actionKind: "ally_capture",
      augmentId: "AUG-043",
      context,
      before: engine,
      userId,
      preview: () => finalizeAction(
        engine,
        applyLoneWolfAllyCapture(engine, actorOwned(context, userId)),
        userId,
        previewContext(context),
        "ally_capture",
      ),
      execute: () => finalizeAction(
        engine,
        applyLoneWolfAllyCapture(engine, actorOwned(context, userId)),
        userId,
        context,
        "ally_capture",
      ),
    }));
  }
  return resolve(context, engine, userId, candidates);
}

function setPartitions(pieceIds: string[]) {
  const results: string[][][] = [];
  const build = (index: number, groups: string[][]) => {
    if (index >= pieceIds.length) {
      if (groups.length >= 2) results.push(groups.map((group) => [...group]));
      return;
    }
    const pieceId = pieceIds[index];
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      groups[groupIndex].push(pieceId);
      build(index + 1, groups);
      groups[groupIndex].pop();
    }
    groups.push([pieceId]);
    build(index + 1, groups);
    groups.pop();
  };
  build(0, []);
  const unique = new Map<string, string[][]>();
  for (const partition of results) {
    const normalized = partition
      .map((group) => [...group].sort())
      .sort((left, right) => left.join("|").localeCompare(right.join("|")));
    unique.set(normalized.map((group) => group.join(",")).join("/"), normalized);
  }
  return [...unique.values()];
}

export function resolveSplitDecision(context: PolicyContext, engine: GameEngineState, userId: string) {
  const pending = engine.pendingSplitChoice;
  const owned = actorOwned(context, userId);
  if (!pending || !owned.includes("AUG-061")) return null;
  const partitions: Array<string[][] | null> = [null, ...setPartitions(pending.pieceIds)];
  const candidates = partitions.map((partition) => evaluatedCandidate({
    key: `augment:AUG-061:split:${partition ? partition.map((group) => group.join("+")).join("/") : "skip"}`,
    actionKind: "split",
    augmentId: "AUG-061",
    payload: { partition },
    context,
    before: engine,
    userId,
    preview: () => finalizeAction(
      engine,
      applySelfRelianceSplit(engine, userId, partition, owned),
      userId,
      previewContext(context),
      "split",
    ),
    execute: () => finalizeAction(
      engine,
      applySelfRelianceSplit(engine, userId, partition, owned),
      userId,
      context,
      "split",
    ),
  }));
  return resolve(context, engine, userId, candidates);
}
