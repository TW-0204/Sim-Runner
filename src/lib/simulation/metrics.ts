import { AUGMENT_BY_ID } from "@/lib/augments/catalog";
import type { GameWinCondition } from "@/lib/game/types";
import type { BatchSummary, SimulationGameResult } from "./types";

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index] ?? null;
}

function rate(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function specialAugmentForWin(condition: GameWinCondition | null) {
  if (condition === "SOLO_RUN") return "AUG-041";
  if (condition === "FOUR_GUARDIANS") return "AUG-032";
  if (condition === "CENTER_STACK") return "AUG-033";
  if (condition === "HUNT") return "AUG-042";
  if (condition === "MOONWALK") return "AUG-031";
  return null;
}

function turnsRemainingAfterRound(result: SimulationGameResult, afterRound: number) {
  return Math.max(0, result.turnNumber - afterRound * result.playerCount);
}

export function summarizeBatch(results: SimulationGameResult[]): BatchSummary {
  if (!results.length) throw new Error("Cannot summarize an empty simulation batch.");

  const first = results[0];
  const completed = results.filter((result) => result.status === "COMPLETED");
  const draws = results.filter((result) => result.status === "DRAW");
  const rounds = completed.map((result) => result.round).sort((a, b) => a - b);
  const turns = completed.map((result) => result.turnNumber);
  const averageRound = average(rounds);
  const maxAugmentEvents = Math.max(0, ...results.map((result) => result.acquisitions.reduce((max, item) => Math.max(max, item.acquisitionIndex), 0)));

  const seatWinRates: Record<number, number> = {};
  for (let seat = 1; seat <= first.playerCount; seat += 1) {
    seatWinRates[seat] = rate(completed.filter((result) => result.winnerSeat === seat).length, completed.length);
  }

  const specialOfferBreakdown: Record<string, number> = {};
  const specialAcquisitionBreakdown: Record<string, number> = {};
  let specialOfferGames = 0;
  let specialOffersShown = 0;
  let specialAcquisitions = 0;
  for (const result of completed) {
    const shown = result.specialOffersShown ?? [];
    if (shown.length > 0) specialOfferGames += 1;
    specialOffersShown += shown.length;
    for (const offer of shown) {
      specialOfferBreakdown[offer.augmentId] = (specialOfferBreakdown[offer.augmentId] ?? 0) + 1;
    }
    for (const acquisition of result.acquisitions) {
      if (!AUGMENT_BY_ID.get(acquisition.augmentId)?.special) continue;
      specialAcquisitions += 1;
      specialAcquisitionBreakdown[acquisition.augmentId] = (specialAcquisitionBreakdown[acquisition.augmentId] ?? 0) + 1;
    }
  }

  let g01GamesOwned = 0;
  let g01GaeExtraRolls = 0;
  let g01YutMoSuppressions = 0;
  for (const result of completed) {
    const g01Owners = new Set(
      result.acquisitions.filter((item) => item.augmentId === "AUG-017").map((item) => item.userId),
    );
    for (const userId of g01Owners) {
      g01GamesOwned += 1;
      const breakdown = result.g01TriggerBreakdownByUser?.[userId];
      g01GaeExtraRolls += breakdown?.gaeExtraRolls ?? 0;
      g01YutMoSuppressions += breakdown?.yutMoSuppressions ?? 0;
    }
  }
  const g01NetExtraRollDelta = g01GaeExtraRolls - g01YutMoSuppressions;

  const leaderCheckpoints = completed.filter((result) => Boolean(result.firstAugmentLeaderCheckpoint));
  const eligibleLeaderCheckpoints = leaderCheckpoints.filter((result) => result.firstAugmentLeaderCheckpoint?.eligible);
  const specialGoalExcludedLeaderCheckpoints = leaderCheckpoints.filter((result) => !result.firstAugmentLeaderCheckpoint?.eligible);
  const uniqueLeaderCheckpoints = eligibleLeaderCheckpoints.filter((result) => result.firstAugmentLeaderCheckpoint?.leaderUserIds.length === 1);
  const tiedLeaderCheckpoints = eligibleLeaderCheckpoints.filter((result) => (result.firstAugmentLeaderCheckpoint?.leaderUserIds.length ?? 0) !== 1);
  const leaderWins = uniqueLeaderCheckpoints.filter((result) => result.firstAugmentLeaderCheckpoint?.leaderUserIds[0] === result.winnerUserId).length;

  const drawGamesOwnedByAugment = new Map<string, number>();
  for (const result of draws) {
    const seen = new Set<string>();
    for (const acquisition of result.acquisitions) {
      const key = `${acquisition.userId}\u0000${acquisition.augmentId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      drawGamesOwnedByAugment.set(
        acquisition.augmentId,
        (drawGamesOwnedByAugment.get(acquisition.augmentId) ?? 0) + 1,
      );
    }
  }

  const byAugment = new Map<string, {
    gamesOwned: number;
    wins: number;
    specialWins: number;
    triggeredGames: number;
    totalTriggers: number;
    winningTriggers: number;
    totalRoundsRemaining: number;
    totalTurnsRemaining: number;
    totalGameRounds: number;
    byIndex: Map<number, { games: number; wins: number }>;
  }>();

  for (const result of completed) {
    const specialWinnerAugment = specialAugmentForWin(result.winnerCondition);
    const acquisitionsByPlayer = new Map<string, typeof result.acquisitions>();
    for (const acquisition of result.acquisitions) {
      const list = acquisitionsByPlayer.get(acquisition.userId) ?? [];
      list.push(acquisition);
      acquisitionsByPlayer.set(acquisition.userId, list);
    }

    for (const [userId, acquisitions] of acquisitionsByPlayer) {
      const winner = result.winnerUserId === userId;
      for (const acquisition of acquisitions) {
        const stats = byAugment.get(acquisition.augmentId) ?? {
          gamesOwned: 0,
          wins: 0,
          specialWins: 0,
          triggeredGames: 0,
          totalTriggers: 0,
          winningTriggers: 0,
          totalRoundsRemaining: 0,
          totalTurnsRemaining: 0,
          totalGameRounds: 0,
          byIndex: new Map<number, { games: number; wins: number }>(),
        };
        const triggerCount = result.triggerCountsByUser?.[userId]?.[acquisition.augmentId] ?? 0;
        stats.gamesOwned += 1;
        stats.totalTriggers += triggerCount;
        if (triggerCount > 0) stats.triggeredGames += 1;
        stats.totalRoundsRemaining += Math.max(0, result.round - acquisition.afterRound);
        stats.totalTurnsRemaining += turnsRemainingAfterRound(result, acquisition.afterRound);
        stats.totalGameRounds += result.round;
        if (winner) {
          stats.wins += 1;
          stats.winningTriggers += triggerCount;
          if (specialWinnerAugment === acquisition.augmentId) stats.specialWins += 1;
        }
        const indexStats = stats.byIndex.get(acquisition.acquisitionIndex) ?? { games: 0, wins: 0 };
        indexStats.games += 1;
        if (winner) indexStats.wins += 1;
        stats.byIndex.set(acquisition.acquisitionIndex, indexStats);
        byAugment.set(acquisition.augmentId, stats);
      }
    }
  }

  for (const augmentId of drawGamesOwnedByAugment.keys()) {
    if (byAugment.has(augmentId)) continue;
    byAugment.set(augmentId, {
      gamesOwned: 0,
      wins: 0,
      specialWins: 0,
      triggeredGames: 0,
      totalTriggers: 0,
      winningTriggers: 0,
      totalRoundsRemaining: 0,
      totalTurnsRemaining: 0,
      totalGameRounds: 0,
      byIndex: new Map<number, { games: number; wins: number }>(),
    });
  }

  const augmentWinStats: BatchSummary["augmentWinStats"] = {};
  for (const [augmentId, stats] of byAugment) {
    const firstIndex = stats.byIndex.get(1) ?? { games: 0, wins: 0 };
    const secondIndex = stats.byIndex.get(2) ?? { games: 0, wins: 0 };
    const thirdIndex = stats.byIndex.get(3) ?? { games: 0, wins: 0 };
    const averageGameRound = stats.gamesOwned ? stats.totalGameRounds / stats.gamesOwned : null;
    const drawGamesOwned = drawGamesOwnedByAugment.get(augmentId) ?? 0;
    const terminalGamesOwned = stats.gamesOwned + drawGamesOwned;
    augmentWinStats[augmentId] = {
      gamesOwned: stats.gamesOwned,
      wins: stats.wins,
      winRate: rate(stats.wins, stats.gamesOwned),
      drawGamesOwned,
      drawRate: rate(drawGamesOwned, terminalGamesOwned),
      specialWins: stats.specialWins,
      specialWinShareOfWins: stats.wins ? stats.specialWins / stats.wins : null,
      triggeredGames: stats.triggeredGames,
      triggerRate: rate(stats.triggeredGames, stats.gamesOwned),
      totalTriggers: stats.totalTriggers,
      averageTriggersPerOwnedGame: stats.gamesOwned ? stats.totalTriggers / stats.gamesOwned : 0,
      averageTriggersPerTriggeredGame: stats.triggeredGames ? stats.totalTriggers / stats.triggeredGames : null,
      averageTriggersInWins: stats.wins ? stats.winningTriggers / stats.wins : null,
      averageRoundsRemaining: stats.gamesOwned ? stats.totalRoundsRemaining / stats.gamesOwned : null,
      averageTurnsRemaining: stats.gamesOwned ? stats.totalTurnsRemaining / stats.gamesOwned : null,
      averageGameRound,
      gameRoundDeltaFromBatch: averageGameRound != null && averageRound != null ? averageGameRound - averageRound : null,
      firstAcquisitionGames: firstIndex.games,
      firstAcquisitionWins: firstIndex.wins,
      firstAcquisitionWinRate: firstIndex.games ? firstIndex.wins / firstIndex.games : null,
      secondAcquisitionGames: secondIndex.games,
      secondAcquisitionWins: secondIndex.wins,
      secondAcquisitionWinRate: secondIndex.games ? secondIndex.wins / secondIndex.games : null,
      thirdAcquisitionGames: thirdIndex.games,
      thirdAcquisitionWins: thirdIndex.wins,
      thirdAcquisitionWinRate: thirdIndex.games ? thirdIndex.wins / thirdIndex.games : null,
    };
  }

  const augmentWindowByIndex = Array.from({ length: maxAugmentEvents }, (_, offset) => {
    const acquisitionIndex = offset + 1;
    const reachedGames = completed.flatMap((result) => {
      const acquisition = result.acquisitions.find((item) => item.acquisitionIndex === acquisitionIndex);
      return acquisition ? [{ result, acquisition }] : [];
    });
    return {
      acquisitionIndex,
      reachRate: rate(results.filter((result) => result.augmentEventsReached >= acquisitionIndex).length, results.length),
      averageRoundsRemaining: average(reachedGames.map(({ result, acquisition }) => Math.max(0, result.round - acquisition.afterRound))),
      averageTurnsRemaining: average(reachedGames.map(({ result, acquisition }) => turnsRemainingAfterRound(result, acquisition.afterRound))),
    };
  });

  return {
    rulesetId: first.rulesetId,
    playerCount: first.playerCount,
    games: results.length,
    completedGames: completed.length,
    drawGames: draws.length,
    stalledGames: results.filter((result) => result.status === "STALLED").length,
    actionLimitGames: results.filter((result) => result.status === "ACTION_LIMIT").length,
    averageRound,
    medianRound: percentile(rounds, 0.5),
    p90Round: percentile(rounds, 0.9),
    averageTurnNumber: average(turns),
    augmentReachRateByIndex: augmentWindowByIndex.map((window) => window.reachRate),
    augmentWindowByIndex,
    seatWinRates,
    specialOfferGames,
    specialOfferRatePerGame: rate(specialOfferGames, completed.length),
    specialOffersShown,
    specialAcquisitions,
    specialAcquisitionRatePerGame: rate(specialAcquisitions, completed.length),
    specialOfferBreakdown,
    specialAcquisitionBreakdown,
    g01TriggerBreakdown: {
      gamesOwned: g01GamesOwned,
      gaeExtraRolls: g01GaeExtraRolls,
      yutMoSuppressions: g01YutMoSuppressions,
      netExtraRollDelta: g01NetExtraRollDelta,
      averageNetExtraRollDeltaPerOwnedGame: g01GamesOwned ? g01NetExtraRollDelta / g01GamesOwned : null,
    },
    leaderCheckpointReachedGames: leaderCheckpoints.length,
    leaderCheckpointEligibleGames: eligibleLeaderCheckpoints.length,
    leaderCheckpointSpecialGoalExcludedGames: specialGoalExcludedLeaderCheckpoints.length,
    leaderCheckpointUniqueLeaderGames: uniqueLeaderCheckpoints.length,
    leaderCheckpointTiedLeaderGames: tiedLeaderCheckpoints.length,
    leaderAfterFirstAugmentWinRate: uniqueLeaderCheckpoints.length ? leaderWins / uniqueLeaderCheckpoints.length : null,
    comebackWinRate: uniqueLeaderCheckpoints.length ? (uniqueLeaderCheckpoints.length - leaderWins) / uniqueLeaderCheckpoints.length : null,
    augmentWinStats,
  };
}
