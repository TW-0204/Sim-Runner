import { getBalanceRuleset } from "@/lib/simulation/rulesets";
import { simulateGame } from "@/lib/simulation/game";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function integerArg(name: string, fallback: number) {
  const parsed = Number(argument(name) ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`--${name} must be a positive integer`);
  return parsed;
}

const playerCount = integerArg("player-count", 2);
const games = integerArg("games", 3000);
const seedStart = integerArg("seed-start", 1_300_000);
if (![2, 3, 4].includes(playerCount)) throw new Error("--player-count must be 2, 3, or 4");

const ruleset = getBalanceRuleset("two-aug-start-r4-special-slots-v2");
let stalled = 0;

for (let offset = 0; offset < games; offset += 1) {
  const seed = String(seedStart + offset);
  const result = simulateGame({ seed, ruleset, playerCount, maxActions: 20_000 });
  if (result.status !== "STALLED") continue;
  stalled += 1;
  const engine = result.failureDiagnostics?.engine;
  console.log(JSON.stringify({
    kind: "STALL_DETAIL",
    playerCount,
    seed,
    error: result.error,
    round: result.round,
    turnNumber: result.turnNumber,
    acquisitions: result.acquisitions,
    ownedByUser: result.failureDiagnostics?.ownedByUser,
    stage: engine?.stage,
    currentSeat: engine?.currentSeat,
    pendingRolls: engine?.pendingRolls,
    results: engine?.results,
    augmentRuntime: engine?.augmentRuntime,
    pendingMove: engine?.pendingMove,
    pendingStackChoice: engine?.pendingStackChoice,
    players: engine?.players.map((player) => ({
      userId: player.userId,
      pieces: player.pieces,
    })),
  }));
}

console.log(JSON.stringify({ kind: "STALL_SUMMARY", playerCount, games, seedStart, stalled }));
