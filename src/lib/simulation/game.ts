import { AUGMENT_BY_ID } from "@/lib/augments/catalog";
import {
  adjustedResultForGroup,
  grantsFaceExtraRoll,
  isGroupUsableWithAugments,
  type PlayerAugmentSetups,
} from "@/lib/augments/effects";
import { buildPhaseOffers, chancePerDrawForMaxGameExposure, pickTierSequence, SPECIAL_AUGMENT_IDS } from "@/lib/augments/server";
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
  applyGrandUnity,
  applyMove,
  applyRelocationChoice,
  applyStackChoice,
  createInitialEngine,
  currentPlayer,
  legalMoveTargetsWithAugments,
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

function setupPieceId(player: GameEngineState["players"][number]) {
  const ranked = [...player.pieces].sort((left, right) => {
    const statusScore = (piece: PieceState) => piece.status === "FINISHED" ? 3 : piece.status === "ON_BOARD" ? 2 : piece.hasEntered ? 1 : 0;
    const statusDelta = statusScore(right) - statusScore(left);
    if (statusDelta !== 0) return statusDelta;
    const historyDelta = right.pathHistory.length - left.pathHistory.length;
    if (historyDelta !== 0) return historyDelta;
    return left.id.localeCompare(right.id);
  });
  return ranked[0]?.id ?? player.pieces[0]?.id;
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
  context.engine = after;
}

function applyDueAugmentEvents(context: SimulationContext) {
  let changed = false;
  const sequence = pickTierSequence(context.seed);

  context.ruleset.augmentEvents.forEach((event, eventIndex) => {
    if (context.appliedAugmentEvents.has(eventIndex)) return;
    if (event.afterRound >= context.engine.round) return;
    if (context.engine.winnerUserId) return;

    const tier = sequence[event.logicalPhase - 1];
    const excludedIds = context.ruleset.excludedAugmentIdsByLogicalPhase?.[event.logicalPhase];
    const rareSpecialChance = context.ruleset.rareSpecialOfferChancePerEvent;
    const slotSpecialMaxGameExposure = context.ruleset.specialMaxGameExposureByLogicalPhase?.[event.logicalPhase];
    const specialChancePerDraw = slotSpecialMaxGameExposure != null
      ? chancePerDrawForMaxGameExposure(slotSpecialMaxGameExposure, context.engine.players.length)
      : undefined;
    let offers = buildPhaseOffers({
      seed: context.seed,
      phase: event.logicalPhase,
      tier,
      players: context.engine.players.map((player) => ({ userId: player.userId, seat: player.seat })),
      ownedByUser: context.ownedByUser,
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
      const selectedId = context.rng.augment.pick(visible);
      const player = context.engine.players.find((candidate) => candidate.userId === offer.userId);
      if (!player) throw new Error(`Missing simulation player ${offer.userId}.`);

      context.ownedByUser[offer.userId] = upgradeOwnedList(context.ownedByUser[offer.userId] ?? [], selectedId);
      if (selectedId === "G16" || selectedId === "P14") {
        const pieceId = setupPieceId(player);
        if (pieceId) {
          context.setupsByUser[offer.userId] ??= {};
          context.setupsByUser[offer.userId][selectedId] = { pieceId };
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
  if (remaining <= 0) return false;

  runtime.vacancySkipsRemaining = remaining - 1;
  const remainingAfter = runtime.vacancySkipsRemaining;
  advanceTurnForVacancy(next);
  const following = currentPlayer(next);
  next.lastAction = remainingAfter > 0
    ? `${player.displayName}: 자리비움 · 턴 스킵 (${remainingAfter}회 남음) · ${following.displayName}의 턴`
    : `${player.displayName}: 자리비움 종료 · Round 9까지 기본 양수 이동 +1 · ${following.displayName}의 턴`;
  context.engine = next;
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
  if (!owned.includes("P11") || engine.stage !== "AWAITING_ROLL") return null;
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
      baseStepsForFace(face) + (grantsFaceExtraRoll(face, owned) ? 3 : 0)
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

function stepGame(context: SimulationContext) {
  if (applyDueAugmentEvents(context)) return;
  if (context.engine.winnerUserId) return;
  if (maybeApplyVacancySkip(context)) return;

  const actorBeforeInjection = currentPlayer(context.engine);
  if (context.engine.stage !== "CAPTURE_CHOICE") {
    context.engine = injectTomorrowResult(context.engine, actorBeforeInjection.userId, actorOwned(context, actorBeforeInjection.userId));
  }

  const actor = currentPlayer(context.engine);
  const userId = actor.userId;

  if (context.engine.stage === "AWAITING_ROLL") {
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
    if (!next) throw new Error(`No legal move candidate for ${userId} at turn ${context.engine.turnNumber}.`);
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

  while (!context.engine.winnerUserId && context.actions < maxActions) {
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
