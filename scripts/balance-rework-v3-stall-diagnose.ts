import { getBalanceRuleset } from "@/lib/simulation/rulesets";
import { simulateGame } from "@/lib/simulation/game";

const ruleset = getBalanceRuleset("two-aug-start-r4-special-slots-v2");
const cases = [
  { playerCount: 2, seedStart: 700000 },
  { playerCount: 3, seedStart: 710000 },
  { playerCount: 4, seedStart: 720000 },
] as const;

for (const { playerCount, seedStart } of cases) {
  let stalled = 0;
  for (let offset = 0; offset < 100; offset += 1) {
    const seed = String(seedStart + offset);
    const result = simulateGame({ seed, ruleset, playerCount, maxActions: 20_000 });
    if (result.status !== "STALLED") continue;
    stalled += 1;
    const engine = result.failureDiagnostics?.engine;
    console.log(JSON.stringify({
      playerCount,
      seed,
      error: result.error,
      round: result.round,
      turnNumber: result.turnNumber,
      stage: engine?.stage,
      currentSeat: engine?.currentSeat,
      pendingRolls: engine?.pendingRolls,
      results: engine?.results?.map((token) => ({ face: token.face, finalSteps: token.finalSteps, source: token.source })),
      acquisitions: result.acquisitions.map((entry) => `${entry.userId}:${entry.augmentId}`),
      ownedByUser: result.failureDiagnostics?.ownedByUser,
    }));
  }
  console.log(`[diagnose] ${playerCount}p stalled ${stalled}/100`);
}
