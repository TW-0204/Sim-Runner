import { AUGMENTS, AUGMENT_BY_ID, type AugmentTier } from "@/lib/augments/catalog";
import {
  canGrantFaceExtraRoll,
  isGroupUsableWithAugments,
  type PlayerAugmentSetups,
} from "@/lib/augments/effects";
import { referencedSetupPieceIds } from "@/lib/augments/setup";
import { buildPhaseOffers, canOffer, chancePerDrawForMaxGameExposure, pickTierSequence, SPECIAL_AUGMENT_IDS } from "@/lib/augments/server";
import { applyLoneWolfAllyCapture } from "@/lib/game/ally-capture";
import { applyAugmentAcquisitionLifecycle } from "@/lib/game/augment-lifecycle";
import {
  executeGrandUnityAction,
  executeMoveAction,
  executeRelocationAction,
  executeStackAction,
  finalizeAction,
  type GameMoveArgs,
} from "@/lib/game/action-lifecycle";
import { assertGameStateInvariants } from "@/lib/game/invariants";
import { moveOwnedIdsForAthlete } from "@/lib/game/athlete";
import { applyCaptureChoice } from "@/lib/game/capture-choice";
import {
  applyGachaMachine,
  applyMarginExit,
  applyMarginReturn,
  applyWormholeTurn,
  createInitialEngine,
  currentPlayer,
  expireWormholeForCurrentRound,
  legalMoveOptionsWithAugments,
  discardMovementResultsWhenNoLegalMove,
  gachaMachineIsReady,
  isForcedRelocationImmune,
  resolveDueWormholeReturns,
  wormholeIsOpen,
} from "@/lib/game/engine";
import {
  allocateNumberPool,
  normalizeNumberPool,
  splitNumberResult,
} from "@/lib/game/number-cells";
import {
  applyCrossTransitionLegacyRules,
  applyPostTransitionAugmentLifecycle,
} from "@/lib/game/transition-lifecycle";
import { baseStepsForFace } from "@/lib/game/roll";
import {
  godHandChargeCount,
  keepDoResult,
  resolveDualRollChoice,
} from "@/lib/game/roll-flow";
import { executeDoRerollLifecycle, executeRollLifecycle } from "@/lib/game/roll-lifecycle";
import { applySelfRelianceSplit } from "@/lib/game/self-reliance";
import { injectTomorrowResult, saveResultForTomorrow } from "@/lib/game/tomorrow";
import {
  activatePlagueTurnIfNeeded,
  injectBombBonusRolls,
  prepareBasicRollAugments,
  resolveDueAutomaticAugmentEvent,
  resolveUniverseFreezeTurn,
  resolveVacancyTurn,
} from "@/lib/game/turn-lifecycle";
import type { EngineMoveTarget } from "@/lib/game/engine";
import type { GameEngineState, PieceState, RollToken } from "@/lib/game/types";
import type { BalanceRuleset } from "./rulesets";
import { createSimulationRandomStreams, type SimulationRandomStreams } from "./rng";
import {
  applyG01TriggerBreakdown,
  buildFirstAugmentLeaderCheckpoint,
  detectG01TriggerBreakdown,
  type FirstAugmentLeaderCheckpoint,
  type G01TriggerBreakdownByUser,
} from "./telemetry";
import {
  applyTriggerEvents,
  detectAugmentTriggers,
  type SimulationActionKind,
  type TriggerCountsByUser,
} from "./triggers";
import { injectRareSpecialOffer, type SpecialOfferShown } from "./special-offers";
import { BALANCE_BOT_VERSION, type AugmentAcquisition, type SimulationGameResult } from "./types";

type SimulationOptions = {
  seed: string;
  ruleset: BalanceRuleset;
  playerCount: number;
  maxActions?: number;
  maxRounds?: number;
  forcedAugmentId?: string;
  forcedAcquisitionIndex?: number;
};

type MoveArgs = GameMoveArgs;

type SimulationContext = {
  engine: GameEngineState;
  ownedByUser: Record<string, string[]>;
  setupsByUser: Record<string, PlayerAugmentSetups>;
  acquisitions: AugmentAcquisition[];
  specialOffersShown: SpecialOfferShown[];
  appliedAugmentEvents: Set<number>;
  triggerCountsByUser: TriggerCountsByUser;
  g01TriggerBreakdownByUser: G01TriggerBreakdownByUser;
  firstAugmentAppliedRound: number | null;
  firstAugmentLeaderCheckpoint: FirstAugmentLeaderCheckpoint | null;
  rng: SimulationRandomStreams;
  seed: string;
  ruleset: BalanceRuleset;
  forcedAugmentId?: string;
  forcedAcquisitionIndex?: number;
  tokenCounter: number;
  actions: number;
  s16BasicRollsByUser: Record<string, number>;
  s16NakByUser: Record<string, number>;
};

const FOUR_GUARDIAN_NODES = [5, 10, 22, 29] as const;
const CENTER_NODE = 15;
const UNIVERSE_CENTER_APPROACH_SCORE = new Map<number, number>([
  [13, 45], [14, 90],
  [11, 45], [12, 90],
  [17, 45], [16, 90],
  [24, 45], [23, 90],
]);
const LONE_WOLF_EXTRA_ROLL_FUTURE_BONUS = 32;

function nextTokenId(context: SimulationContext, label: string) {
  context.tokenCounter += 1;
  return `sim:${context.seed}:${context.tokenCounter}:${label}`;
}

function playerSeeds(playerCount: number) {
  return Array.from({ length: playerCount }, (_, index) => ({
    userId: `sim-p${index + 1}`,
    displayName: `Sim P${index + 1}`,
    seat: index + 1,
  }));
}

function resizePieces(engine: GameEngineState, pieceCount: number) {
  if (!Number.isInteger(pieceCount) || pieceCount < 1) throw new Error("pieceCount must be at least 1.");
  for (const player of engine.players) {
    if (player.pieces.length > pieceCount) {
      player.pieces = player.pieces.slice(0, pieceCount);
      continue;
    }
    for (let index = player.pieces.length; index < pieceCount; index += 1) {
      const id = `${player.seat}-${index + 1}`;
      player.pieces.push({
        id,
        ownerUserId: player.userId,
        seat: player.seat,
        status: "WAITING",
        node: null,
        groupId: id,
        hasEntered: false,
        pathHistory: [],
      });
    }
  }
}

function upgradeOwnedList(existing: string[], selectedId: string) {
  const selected = AUGMENT_BY_ID.get(selectedId);
  if (!selected?.family) return existing.includes(selectedId) ? existing : [...existing, selectedId];
  return [...existing.filter((id) => AUGMENT_BY_ID.get(id)?.family !== selected.family), selectedId];
}

function playerHasWaitingPiece(context: SimulationContext, userId: string) {
  return Boolean(context.engine.players.find((player) => player.userId === userId)?.pieces.some((piece) => piece.status === "WAITING"));
}

function upgradedAugmentTier(tier: AugmentTier): AugmentTier {
  if (tier === "silver") return "gold";
  if (tier === "gold") return "prism";
  return "prism";
}

function canReceiveA04(context: SimulationContext, eventIndex: number) {
  const nextEvent = context.ruleset.augmentEvents[eventIndex + 1];
  if (!nextEvent) return false;
  const sequence = pickTierSequence(context.seed);
  return sequence[nextEvent.logicalPhase - 1] !== "prism";
}

function immediateReplacementId(
  context: SimulationContext,
  userId: string,
  phase: number,
  eventIndex: number,
  sourceId: "A05" | "A06",
) {
  const targetTier: AugmentTier = sourceId === "A05" ? "gold" : "prism";
  const ownedIds = context.ownedByUser[userId] ?? [];
  const alreadyClaimedUnique = new Set(
    context.acquisitions
      .map((item) => item.augmentId)
      .filter((id) => AUGMENT_BY_ID.get(id)?.uniquePerGame),
  );
  const candidates = AUGMENTS
    .filter((augment) => augment.tier === targetTier)
    .filter((augment) => augment.id !== "A05" && augment.id !== "A06")
    .filter((augment) => augment.id !== "A10" || playerHasWaitingPiece(context, userId))
    .filter((augment) => augment.id !== "A04" || canReceiveA04(context, eventIndex))
    .filter((augment) => augment.id !== "A10" || playerHasWaitingPiece(context, userId))
    .filter((augment) => canOffer(augment, phase, ownedIds))
    .filter((augment) => !augment.uniquePerGame || !alreadyClaimedUnique.has(augment.id));
  if (!candidates.length) {
    throw new Error(`${sourceId} replacement pool has no eligible ${targetTier} augment.`);
  }
  return context.rng.augment.pick(candidates).id;
}

function ownedIdsForOffers(context: SimulationContext) {
  return Object.fromEntries(context.engine.players.map((player) => {
    const consumedReplacementCards = context.acquisitions
      .filter((item) => item.userId === player.userId && (item.augmentId === "A05" || item.augmentId === "A06"))
      .map((item) => item.augmentId);
    return [player.userId, [...(context.ownedByUser[player.userId] ?? []), ...consumedReplacementCards]];
  }));
}

function commitTransition(
  context: SimulationContext,
  before: GameEngineState,
  after: GameEngineState,
  actorUserId: string,
  actionKind: SimulationActionKind,
) {
  applyTriggerEvents(context.triggerCountsByUser, detectAugmentTriggers({
    before,
    after,
    actorUserId,
    actionKind,
    ownedByUser: context.ownedByUser,
    setupsByUser: context.setupsByUser,
  }));
  applyG01TriggerBreakdown(
    context.g01TriggerBreakdownByUser,
    actorUserId,
    detectG01TriggerBreakdown(before, after, actorUserId, context.ownedByUser),
  );
  context.engine = applyCrossTransitionLegacyRules(before, after, context);
  assertGameStateInvariants(context.engine, {
    ownedByUser: context.ownedByUser,
    setupsByUser: context.setupsByUser,
    label: `${actionKind}@${context.actions}`,
  });
}

function canonicalizeRawTransition(
  context: SimulationContext,
  before: GameEngineState,
  after: GameEngineState,
  actorUserId: string,
  actionKind: SimulationActionKind,
  event: Readonly<Record<string, unknown>> = {},
) {
  return applyPostTransitionAugmentLifecycle(
    before,
    after,
    actorUserId,
    actionKind,
    context,
    event,
  );
}

function applyRawTransitionWithoutTelemetry(
  context: SimulationContext,
  before: GameEngineState,
  after: GameEngineState,
  actorUserId: string,
  actionKind: SimulationActionKind,
  label: string,
  event: Readonly<Record<string, unknown>> = {},
) {
  context.engine = canonicalizeRawTransition(context, before, after, actorUserId, actionKind, event);
  assertGameStateInvariants(context.engine, {
    ownedByUser: context.ownedByUser,
    setupsByUser: context.setupsByUser,
    label,
  });
}

function applyDueAugmentEvents(context: SimulationContext) {
  let changed = false;
  const sequence = pickTierSequence(context.seed);

  context.ruleset.augmentEvents.forEach((event, eventIndex) => {
    if (context.appliedAugmentEvents.has(eventIndex)) return;
    if (event.afterRound >= context.engine.round) return;
    if (context.engine.winnerUserId) return;

    const tier = sequence[event.logicalPhase - 1];
    const baseExcludedIds = context.ruleset.excludedAugmentIdsByLogicalPhase?.[event.logicalPhase] ?? [];
    const excludedIds = [...baseExcludedIds, ...(canReceiveA04(context, eventIndex) ? [] : ["A04"])];
    const excludedIdsByUser = Object.fromEntries(context.engine.players.map((player) => [
      player.userId,
      player.pieces.some((piece) => piece.status === "WAITING") ? [] : ["A10"],
    ]));
    const a04UpgradePendingByUser = Object.fromEntries(context.engine.players.map((player) => [
      player.userId,
      Boolean(context.engine.augmentRuntime?.[player.userId]?.a04UpgradeNextAugment),
    ]));
    const tierByUser = Object.fromEntries(context.engine.players.map((player) => [
      player.userId,
      a04UpgradePendingByUser[player.userId] ? upgradedAugmentTier(tier) : tier,
    ])) as Record<string, AugmentTier>;
    const rareSpecialChance = context.ruleset.rareSpecialOfferChancePerEvent;
    const slotSpecialMaxGameExposure = context.ruleset.specialMaxGameExposureByLogicalPhase?.[event.logicalPhase];
    const specialChancePerDraw = slotSpecialMaxGameExposure != null
      ? chancePerDrawForMaxGameExposure(slotSpecialMaxGameExposure, context.engine.players.length)
      : undefined;
    const offerOwnedByUser = ownedIdsForOffers(context);
    let offers = buildPhaseOffers({
      seed: context.seed,
      phase: event.logicalPhase,
      tier,
      tierByUser,
      players: context.engine.players.map((player) => ({ userId: player.userId, seat: player.seat })),
      excludedIdsByUser,
      ownedByUser: offerOwnedByUser,
      excludedIds,
      excludeSpecial: specialChancePerDraw == null && rareSpecialChance != null,
      specialChancePerDraw,
    });
    if (specialChancePerDraw != null) {
      for (const offer of offers) {
        offer.offerIds.slice(0, 3).forEach((augmentId, slot) => {
          if (!SPECIAL_AUGMENT_IDS.has(augmentId)) return;
          context.specialOffersShown.push({
            eventIndex,
            logicalPhase: event.logicalPhase,
            userId: offer.userId,
            augmentId,
            slot,
          });
        });
      }
    }
    if (rareSpecialChance != null) {
      const injected = injectRareSpecialOffer({
        seed: context.seed,
        eventIndex,
        logicalPhase: event.logicalPhase,
        chance: rareSpecialChance,
        offers,
        ownedByUser: context.ownedByUser,
        excludedIds,
      });
      offers = injected.offers;
      if (injected.shown) context.specialOffersShown.push(injected.shown);
    }

    for (const offer of offers) {
      const visible = offer.offerIds.slice(0, 3);
      const player = context.engine.players.find((candidate) => candidate.userId === offer.userId);
      if (!player) throw new Error(`Missing simulation player ${offer.userId}.`);
      const currentlyEligible = visible.filter((id) => id !== "A10" || playerHasWaitingPiece(context, offer.userId));
      const numericSeed = Number(context.seed);
      const forcedSeat = (Number.isFinite(numericSeed) ? numericSeed : 0) % context.engine.players.length + 1;
      const forceEligible = context.forcedAugmentId !== "A10" || playerHasWaitingPiece(context, offer.userId);
      const shouldForce = Boolean(context.forcedAugmentId)
        && forceEligible
        && eventIndex + 1 === (context.forcedAcquisitionIndex ?? 1)
        && player.seat === forcedSeat;
      const selectedId = shouldForce
        ? context.forcedAugmentId!
        : context.rng.augment.pick(currentlyEligible.length > 0 ? currentlyEligible : visible);

      const acquiredId = selectedId === "A05" || selectedId === "A06"
        ? immediateReplacementId(context, offer.userId, event.logicalPhase, eventIndex, selectedId)
        : selectedId;

      context.ownedByUser[offer.userId] = upgradeOwnedList(context.ownedByUser[offer.userId] ?? [], acquiredId);
      const acquisitionLifecycle = applyAugmentAcquisitionLifecycle({
        engine: context.engine,
        userId: offer.userId,
        augmentId: acquiredId,
        ownedByUser: context.ownedByUser,
        setupsByUser: context.setupsByUser,
        consumeA04UpgradePending: Boolean(a04UpgradePendingByUser[offer.userId]),
        randomNext: () => context.rng.effect.next(),
        randomInt: (maxExclusive) => context.rng.effect.int(maxExclusive),
      });
      if (acquisitionLifecycle.immediateTransitionFrom) {
        const acquisitionNext = canonicalizeRawTransition(
          context,
          acquisitionLifecycle.immediateTransitionFrom,
          acquisitionLifecycle.engine,
          offer.userId,
          "augment_event",
          { acquiredAugmentId: acquiredId },
        );
        commitTransition(
          context,
          acquisitionLifecycle.immediateTransitionFrom,
          acquisitionNext,
          offer.userId,
          "augment_event",
        );
      } else {
        context.engine = acquisitionLifecycle.engine;
      }

      context.acquisitions.push({
        userId: offer.userId,
        seat: player.seat,
        augmentId: selectedId,
        acquisitionIndex: eventIndex + 1,
        logicalPhase: event.logicalPhase,
        afterRound: event.afterRound,
        tier: AUGMENT_BY_ID.get(selectedId)?.tier ?? tier,
      });
      if (acquiredId !== selectedId) {
        context.acquisitions.push({
          userId: offer.userId,
          seat: player.seat,
          augmentId: acquiredId,
          acquisitionIndex: eventIndex + 1,
          logicalPhase: event.logicalPhase,
          afterRound: event.afterRound,
          tier: AUGMENT_BY_ID.get(acquiredId)?.tier ?? tier,
        });
      }
      assertGameStateInvariants(context.engine, {
        ownedByUser: context.ownedByUser,
        setupsByUser: context.setupsByUser,
        label: `acquire:${acquiredId}:${offer.userId}`,
      });
    }

    if (eventIndex === 0 && context.firstAugmentAppliedRound == null) {
      context.firstAugmentAppliedRound = context.engine.round;
    }
    context.appliedAugmentEvents.add(eventIndex);
    const passiveBefore = structuredClone(context.engine);
    const passiveAfter = applyCrossTransitionLegacyRules(passiveBefore, context.engine, context);
    commitTransition(context, passiveBefore, passiveAfter, currentPlayer(passiveBefore).userId, "augment_event");
    changed = true;
  });

  return changed;
}

function maybeUseGachaMachine(context: SimulationContext) {
  const engine = context.engine;
  if (engine.stage !== "AWAITING_ROLL" || engine.pendingRolls[0] !== "BASIC") return false;
  const actor = currentPlayer(engine);
  const owned = actorOwned(context, actor.userId);
  if (!gachaMachineIsReady(engine, actor.userId, owned)) return false;

  const ownCandidates = isForcedRelocationImmune(owned)
    ? []
    : actor.pieces
      .filter((piece) => piece.status === "ON_BOARD" && piece.node != null && piece.node !== 29)
      .sort((left, right) => left.pathHistory.length - right.pathHistory.length);
  const opponentCandidates = engine.players
    .filter((player) => (
      player.userId !== actor.userId
      && !isForcedRelocationImmune(actorOwned(context, player.userId))
    ))
    .flatMap((player) => player.pieces.map((piece) => ({ player, piece })))
    .filter(({ piece }) => piece.status === "ON_BOARD" && piece.node != null && piece.node !== 1)
    .sort((left, right) => right.piece.pathHistory.length - left.piece.pathHistory.length);

  const ownTarget = ownCandidates[0];
  const opponentTarget = opponentCandidates[0];
  if (!ownTarget && !opponentTarget) return false;

  const ownValue = ownTarget ? Math.max(0, 18 - ownTarget.pathHistory.length) : -1;
  const opponentValue = opponentTarget ? opponentTarget.piece.pathHistory.length : -1;
  const targetUserId = opponentValue > ownValue && opponentTarget ? opponentTarget.player.userId : actor.userId;
  const targetPiece = opponentValue > ownValue && opponentTarget ? opponentTarget.piece : ownTarget;
  const desiredNode = targetUserId === actor.userId ? 29 : 1;
  if (!targetPiece) return false;

  const before = context.engine;
  const result = applyGachaMachine(
    before,
    actor.userId,
    targetUserId,
    targetPiece.id,
    desiredNode,
    context.ownedByUser,
    context.rng.effect.next,
  );
  const next = canonicalizeRawTransition(
    context,
    before,
    result.engine,
    actor.userId,
    "augment_event",
    { kind: "gacha_machine", augmentId: "A02" },
  );
  commitTransition(context, before, next, actor.userId, "augment_event");
  return true;
}

function maybeUseMarginExit(_context: SimulationContext) {
  return false;
}

function maybeReturnMargin(_context: SimulationContext, _engine: GameEngineState, _userId: string) {
  return null;
}

function maybeUseWormhole(context: SimulationContext) {
  const engine = context.engine;
  if (engine.stage !== "AWAITING_ROLL" || engine.pendingRolls[0] !== "BASIC") return false;
  const actor = currentPlayer(engine);
  const owned = context.ownedByUser[actor.userId] ?? [];
  if (!wormholeIsOpen(engine, actor.userId, owned)) return false;

  const groups = new Map<string, PieceState[]>();
  for (const piece of actor.pieces) {
    if (piece.status !== "ON_BOARD" || piece.node == null) continue;
    const list = groups.get(piece.groupId) ?? [];
    list.push(piece);
    groups.set(piece.groupId, list);
  }

  if (!groups.size) {
    context.engine = expireWormholeForCurrentRound(engine, actor.userId, owned);
    return false;
  }

  if (engine.results.length > 0 && groups.size === 1) {
    const onlyGroupId = groups.keys().next().value as string | undefined;
    const hasCompatibleWaitingPiece = actor.pieces.some((piece) => (
      piece.status === "WAITING"
      && isGroupUsableWithAugments(engine, actor.userId, piece.groupId, owned, actorSetups(context, actor.userId))
    )) && engine.results.some((result) => (
      !result.numericPool && ["DO", "GAE", "GEOL", "YUT", "MO"].includes(result.face)
    ));
    const hasMarginReturn = owned.includes("A16")
      && actor.pieces.some((piece) => piece.status === "MARGIN")
      && engine.results.some((result) => !result.numericPool && ["DO", "GAE", "GEOL", "YUT", "MO"].includes(result.face));
    if (onlyGroupId && !hasCompatibleWaitingPiece && !hasMarginReturn) {
      context.engine = expireWormholeForCurrentRound(engine, actor.userId, owned);
      return false;
    }
  }

  const selected = [...groups.entries()].sort((left, right) => {
    const leftProgress = Math.max(...left[1].map((piece) => piece.pathHistory.length));
    const rightProgress = Math.max(...right[1].map((piece) => piece.pathHistory.length));
    if (leftProgress !== rightProgress) return leftProgress - rightProgress;
    if (left[1].length !== right[1].length) return right[1].length - left[1].length;
    return left[0].localeCompare(right[0]);
  })[0];
  if (!selected) return false;

  const before = structuredClone(engine);
  const rawNext = applyWormholeTurn(engine, actor.userId, selected[0], owned);
  const next = canonicalizeRawTransition(
    context,
    before,
    rawNext,
    actor.userId,
    "wormhole",
    { groupId: selected[0] },
  );
  commitTransition(context, before, next, actor.userId, "wormhole");
  return true;
}

function actorOwned(context: SimulationContext, userId: string) {
  return context.ownedByUser[userId] ?? [];
}

function actorSetups(context: SimulationContext, userId: string) {
  return context.setupsByUser[userId] ?? {};
}

function playerPositionScore(engine: GameEngineState, userId: string, owned: string[], setups: PlayerAugmentSetups) {
  if (engine.winnerUserId === userId) return 1_000_000_000;
  if (engine.winnerUserId && engine.winnerUserId !== userId) return -1_000_000_000;
  const player = engine.players.find((candidate) => candidate.userId === userId);
  if (!player) return -1_000_000_000;

  if (owned.includes("P02")) {
    const waiting = player.pieces.filter((piece) => piece.status === "WAITING").length;
    const onBoard = player.pieces.filter((piece) => piece.status === "ON_BOARD").length;
    const reverseProgress = player.pieces.reduce((sum, piece) => sum + piece.pathHistory.length, 0);
    return waiting * 320 + onBoard * 35 + reverseProgress * 1.5;
  }

  let score = 0;
  for (const piece of player.pieces) {
    if (piece.status === "FINISHED") score += 300;
    else if (piece.status === "ON_BOARD") score += 45 + piece.pathHistory.length * 1.5;
    else if (piece.hasEntered) score += 4;
  }

  if (owned.includes("P16")) {
    score += (engine.augmentRuntime?.[userId]?.enemyCaptureCount ?? 0) * 130;
  }
  if (owned.includes("P03")) {
    const occupied = new Set(player.pieces.filter((piece) => piece.status === "ON_BOARD" && piece.node != null).map((piece) => piece.node));
    score += FOUR_GUARDIAN_NODES.filter((node) => occupied.has(node)).length * 160;
  }
  if (owned.includes("P04")) {
    const center = player.pieces.filter((piece) => piece.status === "ON_BOARD" && piece.node === CENTER_NODE);
    score += center.length * 130;
    if (center.length > 1 && new Set(center.map((piece) => piece.groupId)).size === 1) score += center.length * 35;

    for (const piece of player.pieces) {
      if (piece.status !== "ON_BOARD" || piece.node == null || piece.node === CENTER_NODE) continue;
      const approachScore = UNIVERSE_CENTER_APPROACH_SCORE.get(piece.node) ?? 0;
      if (approachScore <= 0) continue;
      const lastCenter = piece.pathHistory.lastIndexOf(CENTER_NODE);
      const lastCorner = Math.max(...FOUR_GUARDIAN_NODES.map((node) => piece.pathHistory.lastIndexOf(node)));
      if (lastCorner > lastCenter) score += approachScore;
    }
  }
  if (owned.includes("P14")) {
    const laps = engine.augmentRuntime?.[userId]?.soloLaps ?? 0;
    score += laps * 420;
    const representativeId = setups.P14?.pieceId;
    const representative = player.pieces.find((piece) => piece.id === representativeId);
    if (representative?.status === "ON_BOARD") score += representative.pathHistory.length * 4;
  }

  if (engine.currentSeat === player.seat) {
    score += engine.pendingRolls.length * 12;
    score += engine.results.reduce((sum, result) => sum + Math.max(0, result.finalSteps), 0) * 0.5;
  }
  return score;
}

function capturedEnemyPieceCount(before: GameEngineState, after: GameEngineState, actorUserId: string) {
  let count = 0;
  for (const beforePlayer of before.players) {
    if (beforePlayer.userId === actorUserId) continue;
    const afterPlayer = after.players.find((candidate) => candidate.userId === beforePlayer.userId);
    if (!afterPlayer) continue;
    for (const piece of beforePlayer.pieces) {
      const next = afterPlayer.pieces.find((candidate) => candidate.id === piece.id);
      if (piece.status === "ON_BOARD" && next?.status === "WAITING") count += 1;
    }
  }
  return count;
}

function outcomeScore(context: SimulationContext, before: GameEngineState, after: GameEngineState, userId: string) {
  const base = playerPositionScore(after, userId, actorOwned(context, userId), actorSetups(context, userId));
  return base + capturedEnemyPieceCount(before, after, userId) * 85;
}

function groupRepresentativesForBot(engine: GameEngineState, userId: string, owned: string[]) {
  const player = engine.players.find((candidate) => candidate.userId === userId);
  if (!player) return [];
  const seen = new Set<string>();
  const allowFinished = owned.includes("P02");
  return player.pieces.filter((piece) => {
    if (seen.has(piece.groupId)) return false;
    if (piece.status === "WORMHOLE" || piece.status === "MARGIN") return false;
    if (piece.status === "FINISHED" && !allowFinished) return false;
    seen.add(piece.groupId);
    return true;
  });
}

function moveArgsForTarget(groupId: string, result: RollToken, target: EngineMoveTarget, moonwalk: boolean): MoveArgs {
  const args: MoveArgs = { groupId, resultId: result.id };
  if (!moonwalk && result.face === "BACKDO") {
    if (target.node != null) args.backwardTarget = target.node;
    return args;
  }
  if (target.kind === "CHASE" && target.node != null) args.forwardTarget = target.node;
  else if (target.path) args.forwardPath = [...target.path];
  return args;
}

function bestMove(context: SimulationContext, engine: GameEngineState, userId: string) {
  const owned = actorOwned(context, userId);
  const setups = actorSetups(context, userId);
  const moveOwned = moveOwnedIdsForAthlete(owned);
  const candidates: Array<{ next: GameEngineState; score: number }> = [];
  const legalOptions = legalMoveOptionsWithAugments(
    engine,
    userId,
    owned,
    setups,
    context.ownedByUser,
    moveOwned,
  );

  for (const option of legalOptions) {
    try {
      const next = executeMoveAction(
        context,
        engine,
        userId,
        moveArgsForTarget(option.groupId, option.result, option.target, owned.includes("P02")),
      );
      candidates.push({
        next,
        score: outcomeScore(context, engine, next, userId) + context.rng.decision.next() * 0.001,
      });
    } catch {
      // The engine enumerates legal actions; execution failures are kept out of bot scoring.
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.next ?? null;
}

function maybeSaveTomorrow(context: SimulationContext, engine: GameEngineState, userId: string) {
  const owned = actorOwned(context, userId);
  if (!owned.includes("G13") || engine.stage !== "MOVING") return null;
  const runtime = engine.augmentRuntime?.[userId];
  if (runtime?.tomorrowStoredResult || runtime?.tomorrowSavedAtTurnNumber === engine.turnNumber) return null;
  const candidates = engine.results.filter((result) => !result.numericPool && !result.id.startsWith("tomorrow:"));
  if (candidates.length < 2) return null;

  const selected = [...candidates].sort((left, right) => left.finalSteps - right.finalSteps)[0];
  if (!selected) return null;
  const before = structuredClone(engine);
  const next = saveResultForTomorrow(engine, userId, selected.id, owned);
  return finalizeAction(before, next, userId, context, "save_result");
}

function maybeSplitNumberOne(context: SimulationContext, engine: GameEngineState, userId: string) {
  const owned = actorOwned(context, userId);
  if (!owned.includes("G09") || owned.includes("P05") || engine.stage !== "MOVING") return null;
  if (engine.results.some((result) => result.numericBatchId)) return null;
  if (groupRepresentativesForBot(engine, userId, owned).length < 2) return null;
  const result = [...engine.results]
    .filter((candidate) => candidate.face !== "BACKDO" && !candidate.numericAllocated && !candidate.numericPool && candidate.finalSteps >= 4)
    .sort((left, right) => right.finalSteps - left.finalSteps)[0];
  if (!result) return null;

  const firstSteps = Math.max(1, Math.floor(result.finalSteps / 2));
  const before = structuredClone(engine);
  const next = splitNumberResult(engine, userId, result.id, firstSteps, owned);
  return finalizeAction(before, next, userId, context, "split_number");
}

function maybeAllocateNumberPool(context: SimulationContext, engine: GameEngineState, userId: string) {
  const owned = actorOwned(context, userId);
  if (!owned.includes("P05") || engine.stage !== "MOVING") return null;
  const pool = engine.results.find((result) => result.numericPool);
  if (!pool) return null;
  const steps = Math.min(5, pool.finalSteps);
  const before = structuredClone(engine);
  const next = allocateNumberPool(engine, userId, steps, owned);
  return finalizeAction(before, next, userId, context, "allocate_number_pool");
}

function maybeUseGrandUnity(context: SimulationContext, engine: GameEngineState, userId: string) {
  const owned = actorOwned(context, userId);
  if (!owned.includes("P11") || owned.includes("G01") || engine.stage !== "AWAITING_ROLL") return null;
  if (engine.augmentRuntime?.[userId]?.grandUnityUsed) return null;
  const player = engine.players.find((candidate) => candidate.userId === userId);
  if (!player) return null;
  const groups = new Map<string, PieceState[]>();
  for (const piece of player.pieces) {
    if (piece.status !== "ON_BOARD" || piece.node == null) continue;
    const list = groups.get(piece.groupId) ?? [];
    list.push(piece);
    groups.set(piece.groupId, list);
  }
  if (groups.size < 3) return null;
  const anchor = [...groups.values()].sort((left, right) => {
    const leftProgress = Math.max(...left.map((piece) => piece.pathHistory.length));
    const rightProgress = Math.max(...right.map((piece) => piece.pathHistory.length));
    return rightProgress - leftProgress;
  })[0]?.[0];
  if (!anchor) return null;
  return executeGrandUnityAction(context, engine, userId, anchor.groupId);
}

function resolveRollChoice(context: SimulationContext, engine: GameEngineState, userId: string) {
  const owned = actorOwned(context, userId);
  const pending = engine.pendingRollChoice;
  if (!pending) throw new Error("ROLL_CHOICE without pending choice.");
  const before = structuredClone(engine);

  if (pending.kind === "DUAL") {
    const scoreFace = (face: (typeof pending.faces)[number]) => (
      baseStepsForFace(face) + (canGrantFaceExtraRoll(engine, userId, face, owned) ? 3 : 0)
    );
    const choiceIndex = scoreFace(pending.faces[1]) > scoreFace(pending.faces[0]) ? 1 : 0;
    const next = resolveDualRollChoice(engine, choiceIndex, nextTokenId(context, "dual"), owned, actorSetups(context, userId));
    return finalizeAction(before, next, userId, context, "choose_roll");
  }

  return executeDoRerollLifecycle({
    context,
    engine,
    userId,
    randomRoll: context.rng.roll.next,
    nextTokenId: (label) => nextTokenId(context, label),
  });
}

function executeRoll(context: SimulationContext, engine: GameEngineState, userId: string) {
  const owned = actorOwned(context, userId);
  const godHandFace = engine.pendingRolls[0] === "BASIC"
    && owned.includes("P19")
    && godHandChargeCount(engine, userId, owned) > 0
      ? "MO" as const
      : null;

  const result = executeRollLifecycle({
    context,
    engine,
    userId,
    randomRoll: context.rng.roll.next,
    randomEffect: context.rng.effect.next,
    nextTokenId: (label) => nextTokenId(context, label),
    godHandFace,
  });
  if (result.s16Checked) {
    context.s16BasicRollsByUser[userId] = (context.s16BasicRollsByUser[userId] ?? 0) + 1;
  }
  if (result.s16Occurred) {
    context.s16NakByUser[userId] = (context.s16NakByUser[userId] ?? 0) + 1;
  }
  return result.engine;
}

function resolveCaptureChoice(context: SimulationContext, engine: GameEngineState) {
  const pending = engine.pendingCaptureChoice;
  const decision = pending?.decisions[0];
  if (!pending || !decision) throw new Error("CAPTURE_CHOICE without decision.");
  const chooserUserId = decision.chooserUserId;
  const attackerUserId = pending.attackerUserId;
  let choice: { pieceId?: string | null; targetKey?: string | null } = {};

  if (decision.kind === "INSURANCE") {
    const setups = actorSetups(context, chooserUserId);
    const protectedIds = referencedSetupPieceIds(setups);
    choice = { pieceId: decision.pieceIds.find((id) => !protectedIds.has(id)) ?? decision.pieceIds[0] ?? null };
  } else {
    const target = [...decision.targets].sort((left, right) => right.pieceIds.length - left.pieceIds.length)[0];
    choice = { targetKey: target?.key ?? null };
  }

  const before = structuredClone(engine);
  const next = applyCaptureChoice(engine, chooserUserId, choice, context.ownedByUser);
  return finalizeAction(before, next, chooserUserId, context, "capture_choice", attackerUserId);
}

function resolveRelocationChoice(context: SimulationContext, engine: GameEngineState, userId: string) {
  const pending = engine.pendingRelocationChoice;
  const current = pending?.opportunities[0];
  if (!pending || !current) throw new Error("RELOCATION_CHOICE without opportunity.");
  const choices: Array<string | null> = [null, ...current.candidateGroupIds];
  let best: { next: GameEngineState; score: number } | null = null;
  for (const choice of choices) {
    try {
      const next = executeRelocationAction(context, engine, userId, choice);
      const score = outcomeScore(context, engine, next, userId) + (choice ? 2 : 0);
      if (!best || score > best.score) best = { next, score };
    } catch {
      // Ignore invalid candidate.
    }
  }
  if (!best) throw new Error("No valid relocation choice.");
  return best.next;
}

function resolveStackChoice(context: SimulationContext, engine: GameEngineState, userId: string) {
  const choices: Array<{ next: GameEngineState; score: number; actionKind: "stack" | "ally_capture" }> = [];
  for (const stack of [false, true] as const) {
    try {
      const next = executeStackAction(context, engine, userId, stack);
      choices.push({ next, score: outcomeScore(context, engine, next, userId) + (stack ? 1 : 0), actionKind: "stack" });
    } catch {
      // Ignore invalid candidate.
    }
  }

  if (actorOwned(context, userId).includes("P17")) {
    try {
      const before = structuredClone(engine);
      const captured = applyLoneWolfAllyCapture(engine, actorOwned(context, userId));
      const next = finalizeAction(before, captured, userId, context, "ally_capture");
      choices.push({ next, score: outcomeScore(context, engine, next, userId) + LONE_WOLF_EXTRA_ROLL_FUTURE_BONUS, actionKind: "ally_capture" });
    } catch {
      // No valid allied capture.
    }
  }

  choices.sort((left, right) => right.score - left.score);
  if (!choices[0]) throw new Error("No valid stack choice.");
  return choices[0];
}

function resolveSplitChoice(context: SimulationContext, engine: GameEngineState, userId: string) {
  const pending = engine.pendingSplitChoice;
  if (!pending) throw new Error("SPLIT_CHOICE without pending split.");
  const owned = actorOwned(context, userId);
  const before = structuredClone(engine);

  if (owned.includes("P04")) {
    const next = applySelfRelianceSplit(engine, userId, null, owned);
    return finalizeAction(before, next, userId, context, "split");
  }

  const partition = pending.pieceIds.map((pieceId) => [pieceId]);
  const next = applySelfRelianceSplit(engine, userId, partition, owned);
  return finalizeAction(before, next, userId, context, "split");
}

function stepGame(context: SimulationContext) {
  if (applyDueAugmentEvents(context)) return;
  if (context.engine.winnerUserId) return;
  const plagueBefore = context.engine;
  context.engine = activatePlagueTurnIfNeeded(context.engine);
  if (context.engine !== plagueBefore) {
    assertGameStateInvariants(context.engine, {
      ownedByUser: context.ownedByUser,
      setupsByUser: context.setupsByUser,
      label: `plague-turn@${context.actions}`,
    });
  }

  const automaticBefore = context.engine;
  const automaticEvent = resolveDueAutomaticAugmentEvent(
    automaticBefore,
    context.ownedByUser,
    () => context.rng.effect.next(),
  );
  if (automaticEvent.applied) {
    const actorUserId = automaticEvent.actorUserId ?? currentPlayer(automaticBefore).userId;
    const automaticNext = canonicalizeRawTransition(
      context,
      automaticBefore,
      automaticEvent.engine,
      actorUserId,
      "augment_event",
      { kind: "automatic_augment_event" },
    );
    commitTransition(context, automaticBefore, automaticNext, actorUserId, "augment_event");
    return;
  }

  const returnBefore = context.engine;
  const returnActor = currentPlayer(returnBefore);
  const returnAfter = resolveDueWormholeReturns(
    returnBefore,
    returnActor.userId,
    actorOwned(context, returnActor.userId),
    actorSetups(context, returnActor.userId),
    context.rng.effect.next,
  );
  if (returnAfter !== returnBefore) {
    applyRawTransitionWithoutTelemetry(
      context,
      returnBefore,
      returnAfter,
      returnActor.userId,
      "augment_event",
      `wormhole-return@${context.actions}`,
      { kind: "wormhole_return" },
    );
  } else {
    context.engine = returnAfter;
  }
  if (context.engine.winnerUserId) return;

  const freezeBefore = context.engine;
  const freezeActor = currentPlayer(freezeBefore);
  const freeze = resolveUniverseFreezeTurn(freezeBefore);
  if (freeze.applied) {
    applyRawTransitionWithoutTelemetry(
      context,
      freezeBefore,
      freeze.engine,
      freezeActor.userId,
      "augment_event",
      `universe-freeze@${context.actions}`,
      { kind: "universe_freeze" },
    );
    return;
  }

  const vacancyBefore = context.engine;
  const vacancyActor = currentPlayer(vacancyBefore);
  const vacancy = resolveVacancyTurn(
    vacancyBefore,
    actorOwned(context, vacancyActor.userId),
  );
  if (vacancy.applied) {
    applyRawTransitionWithoutTelemetry(
      context,
      vacancyBefore,
      vacancy.engine,
      vacancyActor.userId,
      "augment_event",
      `vacancy@${context.actions}`,
      { kind: "vacancy" },
    );
    return;
  }

  const actorBeforeInjection = currentPlayer(context.engine);
  if (context.engine.stage !== "CAPTURE_CHOICE") {
    context.engine = injectBombBonusRolls(context.engine, actorBeforeInjection.userId, actorOwned(context, actorBeforeInjection.userId));
    context.engine = injectTomorrowResult(context.engine, actorBeforeInjection.userId, actorOwned(context, actorBeforeInjection.userId));
  }

  const actor = currentPlayer(context.engine);
  const userId = actor.userId;

  if (context.engine.stage === "AWAITING_ROLL") {
    if (maybeUseGachaMachine(context)) return;
    if (maybeUseWormhole(context)) return;
    if (maybeUseMarginExit(context)) return;
    prepareBasicRollAugments(context.engine, userId, actorOwned(context, userId));
    const before = context.engine;
    const grandUnity = maybeUseGrandUnity(context, before, userId);
    const next = grandUnity ?? executeRoll(context, before, userId);
    commitTransition(context, before, next, userId, grandUnity ? "grand_unity" : "roll");
    return;
  }

  if (context.engine.stage === "ROLL_CHOICE") {
    const before = context.engine;
    const actionKind: SimulationActionKind = before.pendingRollChoice?.kind === "DO_REROLL" ? "reroll_do" : "choose_roll";
    const next = resolveRollChoice(context, before, userId);
    commitTransition(context, before, next, userId, actionKind);
    return;
  }

  if (context.engine.stage === "MOVING") {
    context.engine = normalizeNumberPool(context.engine, userId, actorOwned(context, userId));

    let before = context.engine;
    const marginReturn = maybeReturnMargin(context, before, userId);
    if (marginReturn) {
      commitTransition(context, before, marginReturn, userId, "margin_return");
      return;
    }

    before = context.engine;
    const saved = maybeSaveTomorrow(context, before, userId);
    if (saved) {
      commitTransition(context, before, saved, userId, "save_result");
      return;
    }

    before = context.engine;
    const split = maybeSplitNumberOne(context, before, userId);
    if (split) {
      commitTransition(context, before, split, userId, "split_number");
      return;
    }

    before = context.engine;
    const allocated = maybeAllocateNumberPool(context, before, userId);
    if (allocated) {
      commitTransition(context, before, allocated, userId, "allocate_number_pool");
      return;
    }

    before = context.engine;
    const next = bestMove(context, before, userId);
    if (!next) {
      const owned = actorOwned(context, userId);
      const discarded = discardMovementResultsWhenNoLegalMove(
        before,
        userId,
        owned,
        actorSetups(context, userId),
        context.ownedByUser,
        moveOwnedIdsForAthlete(owned),
      );
      if (discarded !== before) {
        const finalizedDiscard = canonicalizeRawTransition(
          context,
          before,
          discarded,
          userId,
          "move",
          { kind: "discard_no_legal_move" },
        );
        commitTransition(context, before, finalizedDiscard, userId, "move");
        return;
      }
      throw new Error(`Engine exposed legal moves that the simulator could not execute for ${userId} at turn ${context.engine.turnNumber}.`);
    }
    commitTransition(context, before, next, userId, "move");
    return;
  }

  if (context.engine.stage === "CAPTURE_CHOICE") {
    const before = context.engine;
    const next = resolveCaptureChoice(context, before);
    commitTransition(context, before, next, userId, "capture_choice");
    return;
  }

  if (context.engine.stage === "RELOCATION_CHOICE") {
    const before = context.engine;
    const next = resolveRelocationChoice(context, before, userId);
    commitTransition(context, before, next, userId, "relocate");
    return;
  }

  if (context.engine.stage === "STACK_CHOICE") {
    const before = context.engine;
    const resolved = resolveStackChoice(context, before, userId);
    commitTransition(context, before, resolved.next, userId, resolved.actionKind);
    return;
  }

  if (context.engine.stage === "SPLIT_CHOICE") {
    const before = context.engine;
    const next = resolveSplitChoice(context, before, userId);
    commitTransition(context, before, next, userId, "split");
    return;
  }

  if (context.engine.stage === "FINISHED") return;
  throw new Error(`Unsupported simulation stage: ${context.engine.stage}`);
}

export function simulateGame(options: SimulationOptions): SimulationGameResult {
  if (![2, 3, 4].includes(options.playerCount)) throw new Error("playerCount must be 2, 3, or 4.");
  const maxActions = options.maxActions ?? 20_000;
  const maxRounds = options.maxRounds;
  if (maxRounds != null && (!Number.isInteger(maxRounds) || maxRounds < 1)) {
    throw new Error("maxRounds must be a positive integer when provided.");
  }
  const engine = createInitialEngine(playerSeeds(options.playerCount));
  resizePieces(engine, options.ruleset.pieceCount);

  const context: SimulationContext = {
    engine,
    ownedByUser: Object.fromEntries(engine.players.map((player) => [player.userId, []])),
    setupsByUser: Object.fromEntries(engine.players.map((player) => [player.userId, {}])),
    acquisitions: [],
    specialOffersShown: [],
    appliedAugmentEvents: new Set<number>(),
    triggerCountsByUser: Object.fromEntries(engine.players.map((player) => [player.userId, {}])),
    g01TriggerBreakdownByUser: {},
    firstAugmentAppliedRound: null,
    firstAugmentLeaderCheckpoint: null,
    rng: createSimulationRandomStreams(options.seed, options.ruleset.rngNamespace ?? options.ruleset.id),
    seed: options.seed,
    ruleset: options.ruleset,
    forcedAugmentId: options.forcedAugmentId,
    forcedAcquisitionIndex: options.forcedAcquisitionIndex,
    tokenCounter: 0,
    actions: 0,
    s16BasicRollsByUser: Object.fromEntries(engine.players.map((player) => [player.userId, 0])),
    s16NakByUser: Object.fromEntries(engine.players.map((player) => [player.userId, 0])),
  };

  let error: string | undefined;
  let status: SimulationGameResult["status"] = "ACTION_LIMIT";

  while (
    !context.engine.winnerUserId
    && context.actions < maxActions
    && (maxRounds == null || context.engine.round <= maxRounds)
  ) {
    try {
      stepGame(context);
      context.actions += 1;
      if (
        !context.firstAugmentLeaderCheckpoint
        && context.firstAugmentAppliedRound != null
        && context.engine.round >= context.firstAugmentAppliedRound + 1
      ) {
        context.firstAugmentLeaderCheckpoint = buildFirstAugmentLeaderCheckpoint(context.engine, context.acquisitions);
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Unknown simulation failure.";
      status = "STALLED";
      break;
    }
  }

  if (context.engine.winnerUserId) status = "COMPLETED";
  else if (!error && maxRounds != null && context.engine.round > maxRounds) status = "DRAW";
  else if (!error && context.actions >= maxActions) status = "ACTION_LIMIT";

  const winner = context.engine.players.find((player) => player.userId === context.engine.winnerUserId) ?? null;
  return {
    seed: options.seed,
    rulesetId: options.ruleset.id,
    playerCount: options.playerCount,
    pieceCount: options.ruleset.pieceCount,
    botVersion: BALANCE_BOT_VERSION,
    status,
    winnerUserId: context.engine.winnerUserId,
    winnerSeat: winner?.seat ?? null,
    winnerCondition: context.engine.winnerCondition ?? null,
    round: context.engine.round,
    turnNumber: context.engine.turnNumber,
    actions: context.actions,
    augmentEventsReached: context.appliedAugmentEvents.size,
    acquisitions: context.acquisitions,
    specialOffersShown: context.specialOffersShown,
    triggerCountsByUser: context.triggerCountsByUser,
    g01TriggerBreakdownByUser: context.g01TriggerBreakdownByUser,
    firstAugmentLeaderCheckpoint: context.firstAugmentLeaderCheckpoint ?? undefined,
    s16Telemetry: {
      basicRollsByUser: structuredClone(context.s16BasicRollsByUser),
      nakByUser: structuredClone(context.s16NakByUser),
    },
    failureDiagnostics: status === "STALLED" ? {
      engine: structuredClone(context.engine),
      ownedByUser: structuredClone(context.ownedByUser),
      setupsByUser: structuredClone(context.setupsByUser),
    } : undefined,
    error,
  };
}
