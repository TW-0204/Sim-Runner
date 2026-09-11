import { getBalanceRuleset, type BalanceRuleset } from "./rulesets";
import { simulateGame } from "./game";
import { summarizeBatch } from "./metrics";
import type { BatchSummary, SimulationGameResult } from "./types";

export type BatchOptions = {
  rulesetId: BalanceRuleset["id"];
  playerCount: 2 | 3 | 4;
  games: number;
  seedStart?: number;
  maxActions?: number;
  maxRounds?: number;
};

export type BatchResult = {
  summary: BatchSummary;
  games: SimulationGameResult[];
};

export function runSimulationBatch(options: BatchOptions): BatchResult {
  if (!Number.isInteger(options.games) || options.games < 1) {
    throw new Error("games must be a positive integer.");
  }
  const ruleset = getBalanceRuleset(options.rulesetId);
  const seedStart = options.seedStart ?? 0;
  const games: SimulationGameResult[] = [];

  for (let index = 0; index < options.games; index += 1) {
    games.push(simulateGame({
      seed: String(seedStart + index),
      ruleset,
      playerCount: options.playerCount,
      maxActions: options.maxActions,
      maxRounds: options.maxRounds,
    }));
  }

  return { summary: summarizeBatch(games), games };
}
