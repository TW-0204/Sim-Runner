import { AUGMENTS, AUGMENT_BY_ID, type AugmentTier } from "@/lib/augments/catalog";
import {
  adjustedResultForGroup,
  applyBetrayalTransfer,
  armA04OnAcquisition,
  canGrantFaceExtraRoll,
  queueA04BonusForNextBasic,
  isGroupUsableWithAugments,
  replacesNormalWinCondition,
  type PlayerAugmentSetups,
} from "@/lib/augments/effects";
import { buildPhaseOffers, canOffer, chancePerDrawForMaxGameExposure, pickTierSequence, SPECIAL_AUGMENT_IDS } from "@/lib/augments/server";
import { applyLoneWolfAllyCapture } from "@/lib/game/ally-capture";
import {
  markAthleteDisqualified,
  markAthleteMovement,
  maybeGrantAthleteExtraRoll,
  moveOwnedIdsForAthlete,
  prepareAthleteCoexistence,
} from "@/lib/game/athlete";
import { applyCaptureChoice, maybePauseCaptureChoices } from "@/lib/game/capture-choice";
import {
  applyBombExplosion,
  applyGachaMachine,
  applyGrandUnity,
  applyGreatUpheaval,
  applyGravityExplosion,
  applyMarginExit,
  applyMarginReturn,
  applyMoonwalkAcquisitionScatter,
  applyMove,
  applyWormholeTurn,
  applyTurtleAndHarePlacement,
  armGachaMachineOnAcquisition,
  armWormholeOnAcquisition,
  applyRelocationChoice,
  applyStackChoice,
  createInitialEngine,
  currentPlayer,
  expireWormholeForCurrentRound,
  legalMoveTargetsWithAugments,
  gachaMachineIsReady,
  isForcedRelocationImmune,
  resolveDueWormholeReturns,
  wormholeIsOpen,
} from "@/lib/game/engine";
import {
  allocateNumberPool,
  markNumberSplitSibling,
  normalizeNumberPool,
  splitNumberResult,
} from "@/lib/game/number-cells";
import { applyPassiveSpecialWinner } from "@/lib/game/passive-win";
import { baseStepsForFace, castYut } from "@/lib/game/roll";
import {
  applyGodHandRoll,
  beginRollFlow,
  godHandChargeCount,
  keepDoResult,
  rerollDoResult,
  resolveDualRollChoice,
} from "@/lib/game/roll-flow";
import { applySelfRelianceSplit, maybePauseSelfRelianceAfterMovement } from "@/lib/game/self-reliance";
import { injectTomorrowResult, saveResultForTomorrow } from "@/lib/game/tomorrow";
import type { EngineMoveTarget } from "@/lib/game/engine";
import { discardUnusableResults } from "@/lib/game/engine";
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
};

type MoveArgs = Parameters<typeof applyMove>[1];

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
  tokenCounter: number;
  actions: number;
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

function withSeededMathRandom<T>(random: () => number, callback: () => T): T {
  const original = Math.random;
  Math.random = random;
  try {
    return callback();
  } finally {
    Math.random = original;
  }
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

function setupPieceId(player: GameEngineState["players"][number], augmentId?: string) {
  const candidates = augmentId === "P14"
    ? player.pieces.filter((piece) => piece.betrayalOriginalOwnerUserId == null)
    : player.pieces;
  return rankedSetupPiece(candidates)?.id;
}

function playerHasWaitingPiece(context: SimulationContext, userId: string) {
  return Boolean(context.engine.players.find((player) => player.userId === userId)?.pieces.some((piece) => piece.status === "WAITING"));
}

function repairTransferredSetup(context: SimulationContext, sourceUserId: string, transferredPieceId: string) {
  const setups = context.setupsByUser[sourceUserId];
  if (!setups) return;
  const source = context.engine.players.find((player) => player.userId === sourceUserId);
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

function maybeDeclareBetrayalSourceWinner(context: SimulationContext, userId: string) {
  const ownedIds = context.ownedByUser[userId] ?? [];
  if (ownedIds.includes("P02") || replacesNormalWinCondition(ownedIds)) return;
  const player = context.engine.players.find((candidate) => candidate.userId === userId);
  if (!player || !player.pieces.every((piece) => piece.status === "FINISHED")) return;

  context.engine.winnerUserId = userId;
  context.engine.winnerCondition = "NORMAL";
  context.engine.stage = "FINISHED";
  context.engine.pendingRolls = [];
  context.engine.results = [];
  context.engine.pendingRollChoice = null;
  context.engine.pendingSplitChoice = null;
  context.engine.pendingCaptureChoice = null;
  context.engine.pendingRelocationChoice = null;
  context.engine.pendingStackChoice = null;
  context.engine.lastAction = `${player.displayName}: 배반 후 남은 현재 말이 모두 완주되어 승리!`;
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
  const beforeActor = currentPlayer(before).userId;
  const afterActor = currentPlayer(after).userId;
  if (beforeActor !== afterActor) {
    const runtime = after.augmentRuntime?.[beforeActor];
    if (runtime?.plagueTurnActive) {
      runtime.plaguePieceIds = {};
      runtime.plagueTurnActive = false;
    }
  }
  context.engine = applyPassiveSpecialWinner(after, context.ownedByUser);
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
      const selectedId = context.rng.augment.pick(currentlyEligible.length > 0 ? currentlyEligible : visible);

      const acquiredId = selectedId === "A05" || selectedId === "A06"
        ? immediateReplacementId(context, offer.userId, event.logicalPhase, eventIndex, selectedId)
        : selectedId;

      context.ownedByUser[offer.userId] = upgradeOwnedList(context.ownedByUser[offer.userId] ?? [], acquiredId);
      if (acquiredId === "P02") context.engine = applyMoonwalkAcquisitionScatter(context.engine, offer.userId, context.rng.effect.next);
      context.engine.augmentRuntime ??= {};
      context.engine.augmentRuntime[offer.userId] ??= {};
      const ideaRuntime = context.engine.augmentRuntime[offer.userId];
      if (a04UpgradePendingByUser[offer.userId]) delete ideaRuntime.a04UpgradeNextAugment;
      if (acquiredId === "A04") armA04OnAcquisition(context.engine, offer.userId);
      if (acquiredId === "A12") ideaRuntime.walkingTrailSegment = context.rng.effect.int(4);
      if (acquiredId === "A01") {
        ideaRuntime.gravityExplosionRound = context.engine.round;
        ideaRuntime.gravityExplosionResolved = false;
      }
      if (acquiredId === "A02") armGachaMachineOnAcquisition(context.engine, offer.userId);
      if (acquiredId === "A08") {
        const beforeUpheaval = context.engine;
        const afterUpheaval = applyGreatUpheaval(
          beforeUpheaval,
          offer.userId,
          context.ownedByUser,
          context.setupsByUser,
          context.rng.effect.next,
        );
        commitTransition(context, beforeUpheaval, afterUpheaval, offer.userId, "augment_event");
      }
      if (acquiredId === "A13") armWormholeOnAcquisition(context.engine, offer.userId);
      if (acquiredId === "A15") {
        const owner = context.engine.players.find((candidate) => candidate.userId === offer.userId);
        const waiting = owner?.pieces.filter((piece) => piece.status === "WAITING") ?? [];
        if (waiting.length) {
          const target = waiting[context.rng.effect.int(waiting.length)] ?? waiting[0];
          context.engine = applyTurtleAndHarePlacement(context.engine, offer.userId, target.id);
        }
      }
      if (acquiredId === "A10") {
        const betrayal = applyBetrayalTransfer(context.engine, offer.userId, context.rng.effect.next);
        context.engine = betrayal.engine;
        repairTransferredSetup(context, offer.userId, betrayal.transferredPieceId);
        maybeDeclareBetrayalSourceWinner(context, offer.userId);
      }
      if (acquiredId === "G16" || acquiredId === "P14") {
        const pieceId = setupPieceId(player, acquiredId);
        if (pieceId) {
          context.setupsByUser[offer.userId] ??= {};
          context.setupsByUser[offer.userId][acquiredId] = { pieceId };
        }
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
    }

    if (eventIndex === 0 && context.firstAugmentAppliedRound == null) {
      context.firstAugmentAppliedRound = context.engine.round;
    }
    context.appliedAugmentEvents.add(eventIndex);
    const passiveBefore = structuredClone(context.engine);
    const passiveAfter = applyPassiveSpecialWinner(context.engine, context.ownedByUser);
    commitTransition(context, passiveBefore, passiveAfter, currentPlayer(passiveBefore).userId, "augment_event");
    changed = true;
  });

  return changed;
}

function advanceTurnForVacancy(engine: GameEngineState) {
  const seats = engine.players.map((player) => player.seat).sort((a, b) => a - b);
  const index = seats.indexOf(engine.currentSeat);
  const nextIndex = (index + 1) % seats.length;
  if (nextIndex === 0) engine.round += 1;
  engine.turnNumber += 1;
  engine.currentSeat = seats[nextIndex];
  engine.stage = "AWAITING_ROLL";
  engine.pendingRolls = ["BASIC"];
  engine.results = [];
  engine.pendingRollChoice = null;
  engine.pendingSplitChoice = null;
  engine.pendingCaptureChoice = null;
  engine.pendingRelocationChoice = null;
  engine.pendingStackChoice = null;
}

function maybeApplyUniverseFreeze(context: SimulationContext) {
  const engine = context.engine;
  if (engine.stage !== "AWAITING_ROLL" || engine.pendingRolls[0] !== "BASIC") return false;
  const player = currentPlayer(engine);
  const remaining = engine.augmentRuntime?.[player.userId]?.universeFreezeTurnsRemaining ?? 0;
  if (remaining <= 0) return false;
  const next = structuredClone(engine);
  next.augmentRuntime ??= {};
  next.augmentRuntime[player.userId] ??= {};
  next.augmentRuntime[player.userId].universeFreezeTurnsRemaining = remaining - 1;
  advanceTurnForVacancy(next);
  next.lastAction = `${player.displayName}: 우주의 중심 · 이동 정지`;
  context.engine = next;
  return true;
}

function maybeApplyVacancySkip(context: SimulationContext) {
  const engine = context.engine;
  if (engine.stage !== "AWAITING_ROLL" || engine.pendingRolls[0] !== "BASIC") return false;
  const player = currentPlayer(engine);
  const owned = context.ownedByUser[player.userId] ?? [];
  if (!owned.includes("S13")) return false;

  const next = structuredClone(engine);
  next.augmentRuntime ??= {};
  next.augmentRuntime[player.userId] ??= {};
  const runtime = next.augmentRuntime[player.userId];
  if (!runtime.vacancyInitialized) {
    runtime.vacancyInitialized = true;
    runtime.vacancySkipsRemaining = 2;
  }
  const remaining = runtime.vacancySkipsRemaining ?? 0;
  if (remaining <= 0) {
    if (runtime.vacancyReturnBonusPending && !runtime.vacancyReturnBonusGranted) {
      runtime.vacancyReturnBonusPending = false;
      runtime.vacancyReturnBonusGranted = true;
      next.pendingRolls.push("AUGMENT");
      next.lastAction = `${player.displayName}: 자리비움 복귀 · 추가 던지기 1회`;
      context.engine = next;
      return true;
    }
    return false;
  }

  runtime.vacancySkipsRemaining = remaining - 1;
  const remainingAfter = runtime.vacancySkipsRemaining;
  if (remainingAfter <= 0) runtime.vacancyReturnBonusPending = true;
  const afterExpiry = expireWormholeForCurrentRound(next, player.userId, owned);
  advanceTurnForVacancy(afterExpiry);
  const following = currentPlayer(afterExpiry);
  afterExpiry.lastAction = remainingAfter > 0
    ? `${player.displayName}: 자리비움 · 턴 스킵 (${remainingAfter}회 남음) · ${following.displayName}의 턴`
    : `${player.displayName}: 자리비움 종료 · 다음 자기 턴 추가 던지기 1회 · 이후 전진 이동 +1 · ${following.displayName}의 턴`;
  context.engine = afterExpiry;
  return true;
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
  commitTransition(context, before, result.engine, actor.userId, "augment_event");
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
  const next = applyWormholeTurn(engine, actor.userId, selected[0], owned);
  commitTransition(context, before, next, actor.userId, "wormhole");
  return true;
}

function actorOwned(context: SimulationContext, userId: string) {
  return context.ownedByUser[userId] ?? [];
}

function actorSetups(context: SimulationContext, userId: string) {
  return context.setupsByUser[userId] ?? {};
}

function finalizeAction(
  before: GameEngineState,
  after: GameEngineState,
  actorUserId: string,
  context: SimulationContext,
  actionKind: string,
  postActionUserId = actorUserId,
) {
  let next = after;
  if (next.stage !== "CAPTURE_CHOICE" && actionKind !== "capture_choice") {
    next = maybeGrantAthleteExtraRoll(before, next, actorUserId, actorOwned(context, actorUserId));
  }
  if (next.stage !== "CAPTURE_CHOICE") {
    next = normalizeNumberPool(next, postActionUserId, actorOwned(context, postActionUserId));
  }
  return next;
}

function executeMoveAction(context: SimulationContext, engineInput: GameEngineState, userId: string, args: MoveArgs) {
  const turnSnapshot = structuredClone(engineInput);
  const engine = structuredClone(engineInput);
  const owned = actorOwned(context, userId);
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
  return finalizeAction(turnSnapshot, next, userId, context, "move");
}

function executeStackAction(context: SimulationContext, engineInput: GameEngineState, userId: string, stack: boolean) {
  const before = structuredClone(engineInput);
  const engine = structuredClone(engineInput);
  const owned = actorOwned(context, userId);
  if (stack) markAthleteDisqualified(engine, userId, owned);
  const next = applyStackChoice(engine, stack, owned);
  return finalizeAction(before, next, userId, context, "stack");
}

function executeRelocationAction(context: SimulationContext, engineInput: GameEngineState, userId: string, groupId: string | null) {
  const before = structuredClone(engineInput);
  const engine = structuredClone(engineInput);
  const owned = actorOwned(context, userId);
  if (groupId) markAthleteDisqualified(engine, userId, owned);
  const next = applyRelocationChoice(engine, groupId, owned);
  return finalizeAction(before, next, userId, context, "relocate");
}

function executeGrandUnityAction(context: SimulationContext, engineInput: GameEngineState, userId: string, anchorGroupId: string) {
  const before = structuredClone(engineInput);
  const engine = structuredClone(engineInput);
  const owned = actorOwned(context, userId);
  markAthleteDisqualified(engine, userId, owned);
  const next = applyGrandUnity(engine, anchorGroupId, owned);
  return finalizeAction(before, next, userId, context, "grand_unity");
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

function adjustedResultForTargeting(
  engine: GameEngineState,
  userId: string,
  piece: PieceState,
  result: RollToken,
  owned: string[],
  setups: PlayerAugmentSetups,
) {
  if (!owned.includes("P02") || result.face === "BACKDO" || piece.status !== "FINISHED") {
    return adjustedResultForGroup(engine, userId, piece.groupId, result, owned, setups);
  }

  const player = engine.players.find((candidate) => candidate.userId === userId);
  const group = player?.pieces.filter((candidate) => candidate.groupId === piece.groupId) ?? [];
  let bonus = 0;
  if (owned.includes("P15") && group.length >= 2) bonus += group.length - 1;
  else if (owned.includes("G08") && group.length >= 2) bonus += 1;
  const acePieceId = setups.G16?.pieceId;
  if (owned.includes("G16") && acePieceId && group.some((candidate) => candidate.id === acePieceId)) bonus += 1;
  if (owned.includes("P10")) bonus += 2;
  return {
    ...result,
    finalSteps: result.finalSteps + bonus,
    forbidShortcuts: owned.includes("P10") || result.forbidShortcuts,
  };
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
  const groups = groupRepresentativesForBot(engine, userId, owned);
  const candidates: Array<{ next: GameEngineState; score: number }> = [];

  for (const result of engine.results) {
    if (result.numericPool) continue;
    for (const piece of groups) {
      if (!isGroupUsableWithAugments(engine, userId, piece.groupId, owned, setups)) continue;
      if (result.forbiddenPieceIds?.some((pieceId) => {
        const player = engine.players.find((candidate) => candidate.userId === userId);
        return player?.pieces.some((candidate) => candidate.groupId === piece.groupId && candidate.id === pieceId && candidate.status !== "FINISHED");
      })) continue;

      const effective = adjustedResultForTargeting(engine, userId, piece, result, moveOwned, setups);
      const targets = legalMoveTargetsWithAugments(engine, userId, piece, effective, moveOwned, context.ownedByUser);
      for (const target of targets) {
        try {
          const next = executeMoveAction(context, engine, userId, moveArgsForTarget(piece.groupId, result, target, owned.includes("P02")));
          candidates.push({
            next,
            score: outcomeScore(context, engine, next, userId) + context.rng.decision.next() * 0.001,
          });
        } catch {
          // Candidate enumeration is intentionally defensive; illegal combinations are ignored.
        }
      }
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

  const rerolledFace = castYut(context.rng.roll.next);
  const next = rerollDoResult(engine, rerolledFace, nextTokenId(context, "do-reroll"), owned, actorSetups(context, userId));
  return finalizeAction(before, next, userId, context, "reroll_do");
}

function executeRoll(context: SimulationContext, engine: GameEngineState, userId: string) {
  const owned = actorOwned(context, userId);
  const before = structuredClone(engine);

  const nakActive = Object.values(context.ownedByUser).some((ids) => ids.includes("S16"));
  if (engine.pendingRolls[0] === "BASIC" && nakActive && context.rng.effect.next() < 0.05) {
    const next = structuredClone(engine);
    next.pendingRolls.shift();
    const actorName = currentPlayer(next).displayName;
    if (!owned.includes("S16") && next.pendingRolls.length === 0) {
      discardUnusableResults(next, owned, actorSetups(context, userId));
    }
    if (owned.includes("S16")) {
      next.results.push({
        id: nextTokenId(context, "nak-compensation"),
        face: "MOVE1",
        baseSteps: 1,
        finalSteps: 1,
        source: "AUGMENT",
        suppressMovementBonuses: true,
      });
      next.stage = "MOVING";
      next.lastAction = `${actorName}: 낙! · 1칸 이동권`;
    } else if (next.pendingRolls.length > 0) {
      next.stage = "AWAITING_ROLL";
      next.lastAction = `${actorName}: 낙!`;
    } else if (next.results.length > 0) {
      next.stage = "MOVING";
      next.lastAction = `${actorName}: 낙!`;
    } else {
      advanceTurnForVacancy(next);
      next.lastAction = `${actorName}: 낙! · ${currentPlayer(next).displayName}의 턴`;
    }
    return finalizeAction(before, next, userId, context, "roll");
  }
  if (engine.pendingRolls[0] === "BASIC" && owned.includes("P19") && godHandChargeCount(engine, userId, owned) > 0) {
    const next = applyGodHandRoll(engine, "MO", nextTokenId(context, "god-hand"), owned, actorSetups(context, userId));
    return finalizeAction(before, next, userId, context, "god_hand");
  }

  const faces: [ReturnType<typeof castYut>, ReturnType<typeof castYut>] = [
    castYut(context.rng.roll.next),
    castYut(context.rng.roll.next),
  ];
  const next = withSeededMathRandom(context.rng.effect.next, () => (
    beginRollFlow(engine, faces, nextTokenId(context, "roll"), owned, actorSetups(context, userId))
  ));
  return finalizeAction(before, next, userId, context, "roll");
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
    const protectedIds = new Set([setups.G16?.pieceId, setups.P14?.pieceId].filter((id): id is string => Boolean(id)));
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

function maybeApplyBombExplosion(context: SimulationContext) {
  if (context.engine.round < 6) return false;
  const owners = context.engine.players
    .filter((player) => (context.ownedByUser[player.userId] ?? []).includes("A07"))
    .filter((player) => !context.engine.augmentRuntime?.[player.userId]?.bombResolved)
    .map((player) => player.userId);
  if (!owners.length) return false;
  const before = context.engine;
  const result = applyBombExplosion(before, owners, context.ownedByUser);
  context.engine = applyPassiveSpecialWinner(result.engine, context.ownedByUser);
  commitTransition(context, before, context.engine, owners[0], "augment_event");
  return true;
}

function injectBombBonusRolls(engineInput: GameEngineState, userId: string, ownedIds: string[]) {
  if (!ownedIds.includes("A07") || engineInput.stage !== "AWAITING_ROLL") return engineInput;
  const pending = engineInput.augmentRuntime?.[userId]?.bombBonusRollsPending ?? 0;
  if (pending <= 0) return engineInput;
  const engine = structuredClone(engineInput);
  engine.augmentRuntime ??= {};
  engine.augmentRuntime[userId] ??= {};
  engine.augmentRuntime[userId].bombBonusRollsPending = 0;
  for (let index = 0; index < pending; index += 1) engine.pendingRolls.push("AUGMENT");
  return engine;
}

function maybeApplyGravityExplosion(context: SimulationContext) {
  for (const player of context.engine.players) {
    if (!(context.ownedByUser[player.userId] ?? []).includes("A01")) continue;
    const runtime = context.engine.augmentRuntime?.[player.userId];
    if (runtime?.gravityExplosionRound == null) continue;
    if (context.engine.round < runtime.gravityExplosionRound) continue;
    const before = context.engine;
    const next = applyGravityExplosion(before, player.userId, context.ownedByUser, context.rng.effect.next);
    commitTransition(context, before, next, player.userId, "augment_event");
    return true;
  }
  return false;
}

function stepGame(context: SimulationContext) {
  if (applyDueAugmentEvents(context)) return;
  if (context.engine.winnerUserId) return;
  const turnOwner = currentPlayer(context.engine);
  const turnRuntime = context.engine.augmentRuntime?.[turnOwner.userId];
  if (turnRuntime && Object.keys(turnRuntime.plaguePieceIds ?? {}).length > 0 && turnRuntime.plagueTurnActive !== true) {
    turnRuntime.plagueTurnActive = true;
  }
  if (maybeApplyBombExplosion(context)) return;
  if (context.engine.winnerUserId) return;
  if (maybeApplyGravityExplosion(context)) return;

  const returnActor = currentPlayer(context.engine);
  context.engine = resolveDueWormholeReturns(
    context.engine,
    returnActor.userId,
    actorOwned(context, returnActor.userId),
    actorSetups(context, returnActor.userId),
    context.rng.effect.next,
  );
  if (context.engine.winnerUserId) return;
  if (maybeApplyUniverseFreeze(context)) return;
  if (maybeApplyVacancySkip(context)) return;

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
    queueA04BonusForNextBasic(context.engine, userId, actorOwned(context, userId));
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
      const plaguePieceIds = context.engine.augmentRuntime?.[userId]?.plaguePieceIds ?? {};
      const hasBlockedInfectedWaitingPiece = actor.pieces.some((piece) => (
        piece.status === "WAITING" && Boolean(plaguePieceIds[piece.id])
      ));
      if (hasBlockedInfectedWaitingPiece) {
        const skipped = structuredClone(before);
        skipped.results = [];
        if (skipped.pendingRolls.length > 0) {
          skipped.stage = "AWAITING_ROLL";
        } else {
          advanceTurnForVacancy(skipped);
        }
        skipped.lastAction = `${actor.displayName}: 역병으로 출발할 수 없어 이동 결과 소멸`;
        commitTransition(context, before, skipped, userId, "move");
        return;
      }
      const turtleLocks = context.engine.augmentRuntime?.[userId]?.turtleLockedUntilRoundByPiece ?? {};
      const boardGroupIds = [...new Set(actor.pieces
        .filter((piece) => piece.status === "ON_BOARD")
        .map((piece) => piece.groupId))];
      const hasWaitingPiece = actor.pieces.some((piece) => piece.status === "WAITING");
      const allBoardGroupsTurtleLocked = boardGroupIds.length > 0 && boardGroupIds.every((groupId) => (
        actor.pieces.some((piece) => (
          piece.groupId === groupId
          && piece.status === "ON_BOARD"
          && (turtleLocks[piece.id] ?? 0) > context.engine.round
        ))
      ));
      if (!hasWaitingPiece && allBoardGroupsTurtleLocked) {
        const skipped = structuredClone(before);
        skipped.results = [];
        if (skipped.pendingRolls.length > 0) {
          skipped.stage = "AWAITING_ROLL";
        } else {
          advanceTurnForVacancy(skipped);
        }
        skipped.lastAction = `${actor.displayName}: 토끼와 거북이 이동 제한으로 이동 결과 소멸`;
        commitTransition(context, before, skipped, userId, "move");
        return;
      }
      throw new Error(`No legal move candidate for ${userId} at turn ${context.engine.turnNumber}.`);
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
    tokenCounter: 0,
    actions: 0,
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
    failureDiagnostics: status === "STALLED" ? {
      engine: structuredClone(context.engine),
      ownedByUser: structuredClone(context.ownedByUser),
      setupsByUser: structuredClone(context.setupsByUser),
    } : undefined,
    error,
  };
}
