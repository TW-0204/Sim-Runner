import type { PlayerAugmentSetups } from "@/lib/augments/effects";
import type { GameEngineState, GameWinCondition } from "@/lib/game/types";
import type { BalanceRuleset } from "./rulesets";
import type { SpecialOfferShown } from "./special-offers";
import type { TriggerCountsByUser } from "./triggers";
import type { FirstAugmentLeaderCheckpoint, G01TriggerBreakdownByUser } from "./telemetry";

export const BALANCE_BOT_VERSION = "balance-bot-v0.2.1";

export type AugmentAcquisition = {
  userId: string;
  seat: number;
  augmentId: string;
  acquisitionIndex: number;
  logicalPhase: 1 | 2 | 3;
  afterRound: number;
  tier: "silver" | "gold" | "prism";
};

export type SimulationStatus = "COMPLETED" | "DRAW" | "LONG_GAME" | "STALLED" | "ACTION_LIMIT";

export type SimulationFailureDiagnostics = {
  engine: GameEngineState;
  ownedByUser: Record<string, string[]>;
  setupsByUser: Record<string, PlayerAugmentSetups>;
};

export type PlayerPerformanceTelemetry = {
  rolls: number;
  moves: number;
  enemyPiecesCaptured: number;
  ownPiecesSentToWaiting: number;
  piecesFinished: number;
};

export type SimulationGameResult = {
  seed: string;
  rulesetId: BalanceRuleset["id"];
  playerCount: number;
  pieceCount: number;
  botVersion: string;
  status: SimulationStatus;
  winnerUserId: string | null;
  winnerSeat: number | null;
  winnerCondition: GameWinCondition | null;
  round: number;
  turnNumber: number;
  actions: number;
  augmentEventsReached: number;
  acquisitions: AugmentAcquisition[];
  specialOffersShown?: SpecialOfferShown[];
  triggerCountsByUser?: TriggerCountsByUser;
  g01TriggerBreakdownByUser?: G01TriggerBreakdownByUser;
  firstAugmentLeaderCheckpoint?: FirstAugmentLeaderCheckpoint;
  performanceByUser?: Record<string, PlayerPerformanceTelemetry>;
  s16Telemetry?: {
    basicRollsByUser: Record<string, number>;
    nakByUser: Record<string, number>;
  };
  failureDiagnostics?: SimulationFailureDiagnostics;
  error?: string;
};

export type AugmentWindowSummary = {
  acquisitionIndex: number;
  reachRate: number;
  averageRoundsRemaining: number | null;
  averageTurnsRemaining: number | null;
};

export type DurationBandSummary = {
  completedBy15Games: number;
  completed16To20Games: number;
  completed21To30Games: number;
  completedAfter30Games: number;
  roundLimitGames: number;
  over15Rate: number;
  over20Rate: number;
  over30Rate: number;
};

export type BatchSummary = {
  rulesetId: BalanceRuleset["id"];
  playerCount: number;
  games: number;
  completedGames: number;
  drawGames: number;
  longGameGames: number;
  stalledGames: number;
  actionLimitGames: number;
  durationBands: DurationBandSummary;
  averageRound: number | null;
  medianRound: number | null;
  p90Round: number | null;
  averageTurnNumber: number | null;
  augmentReachRateByIndex: number[];
  augmentWindowByIndex: AugmentWindowSummary[];
  seatWinRates: Record<number, number>;
  specialOfferGames: number;
  specialOfferRatePerGame: number;
  specialOffersShown: number;
  specialAcquisitions: number;
  specialAcquisitionRatePerGame: number;
  specialOfferBreakdown: Record<string, number>;
  specialAcquisitionBreakdown: Record<string, number>;
  g01TriggerBreakdown: {
    gamesOwned: number;
    gaeExtraRolls: number;
    yutMoSuppressions: number;
    netExtraRollDelta: number;
    averageNetExtraRollDeltaPerOwnedGame: number | null;
  };
  leaderCheckpointReachedGames: number;
  leaderCheckpointEligibleGames: number;
  leaderCheckpointSpecialGoalExcludedGames: number;
  leaderCheckpointUniqueLeaderGames: number;
  leaderCheckpointTiedLeaderGames: number;
  leaderAfterFirstAugmentWinRate: number | null;
  comebackWinRate: number | null;
  augmentWinStats: Record<string, {
    gamesOwned: number;
    wins: number;
    winRate: number;
    drawGamesOwned: number;
    drawRate: number;
    longGameGamesOwned: number;
    longGameRate: number;
    completedOver15GamesOwned: number;
    completedOver20GamesOwned: number;
    completedOver30GamesOwned: number;
    over15Rate: number;
    over20Rate: number;
    over30Rate: number;
    specialWins: number;
    specialWinShareOfWins: number | null;
    triggeredGames: number;
    triggerRate: number;
    totalTriggers: number;
    averageTriggersPerOwnedGame: number;
    averageTriggersPerTriggeredGame: number | null;
    averageTriggersInWins: number | null;
    averageRoundsRemaining: number | null;
    averageTurnsRemaining: number | null;
    averageGameRound: number | null;
    gameRoundDeltaFromBatch: number | null;
    firstAcquisitionGames: number;
    firstAcquisitionWins: number;
    firstAcquisitionWinRate: number | null;
    secondAcquisitionGames: number;
    secondAcquisitionWins: number;
    secondAcquisitionWinRate: number | null;
    thirdAcquisitionGames: number;
    thirdAcquisitionWins: number;
    thirdAcquisitionWinRate: number | null;
  }>;
};
