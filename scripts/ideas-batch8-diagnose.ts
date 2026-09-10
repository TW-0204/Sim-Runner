import { runSimulationBatch } from "../src/lib/simulation/batch";
import { simulateGame } from "../src/lib/simulation/game";
import { getBalanceRuleset } from "../src/lib/simulation/rulesets";

const RULESET = "two-aug-start-r4-special-slots-v2";
const batch = runSimulationBatch({
  rulesetId: RULESET,
  playerCount: 4,
  games: 150,
  seedStart: 0,
  maxActions: 20_000,
});

const incomplete = batch.games.filter((game) => game.status !== "COMPLETED");
console.log(`[batch8-diagnose] incomplete=${incomplete.length}`);

for (const game of incomplete) {
  const compact = {
    seed: game.seed,
    status: game.status,
    error: game.error ?? null,
    round: game.round,
    turnNumber: game.turnNumber,
    actions: game.actions,
    winnerUserId: game.winnerUserId,
    acquisitions: game.acquisitions,
    failureDiagnostics: game.failureDiagnostics ?? null,
  };
  console.log(`[batch8-diagnose] 20k ${JSON.stringify(compact)}`);

  if (game.status === "ACTION_LIMIT") {
    const retry = simulateGame({
      seed: game.seed,
      ruleset: getBalanceRuleset(RULESET),
      playerCount: 4,
      maxActions: 100_000,
    });
    console.log(`[batch8-diagnose] 100k ${JSON.stringify({
      seed: retry.seed,
      status: retry.status,
      error: retry.error ?? null,
      round: retry.round,
      turnNumber: retry.turnNumber,
      actions: retry.actions,
      winnerUserId: retry.winnerUserId,
      winnerCondition: retry.winnerCondition ?? null,
      acquisitions: retry.acquisitions,
      failureDiagnostics: retry.failureDiagnostics ?? null,
    })}`);
  }
}

if (!incomplete.length) console.log("[batch8-diagnose] PASS: no incomplete 4p games reproduced.");
