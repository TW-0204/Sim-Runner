import { getBalanceRuleset } from "@/lib/simulation/rulesets";
import { simulateGame } from "@/lib/simulation/game";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function integerArg(name: string, fallback: number) {
  const value = Number(argument(name) ?? fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer`);
  return value;
}

const playerCount = integerArg("player-count", 2);
const games = integerArg("games", 3000);
const seedStart = integerArg("seed-start", 1_300_000);
if (![2, 3, 4].includes(playerCount)) throw new Error("--player-count must be 2, 3, or 4");

const ruleset = getBalanceRuleset("two-aug-start-r4-special-slots-v2");
let completed = 0;
let stalled = 0;
let actionLimit = 0;
const errors = new Map<string, number>();

for (let offset = 0; offset < games; offset += 1) {
  const seed = String(seedStart + offset);
  const result = simulateGame({ seed, ruleset, playerCount, maxActions: 20_000 });
  if (result.status === "COMPLETED") {
    completed += 1;
    continue;
  }
  if (result.status === "STALLED") stalled += 1;
  if (result.status === "ACTION_LIMIT") actionLimit += 1;
  const key = result.error ?? result.status;
  errors.set(key, (errors.get(key) ?? 0) + 1);
  console.log(JSON.stringify({
    kind: "NON_COMPLETED",
    playerCount,
    seed,
    status: result.status,
    error: result.error,
    round: result.round,
    turnNumber: result.turnNumber,
    acquisitions: result.acquisitions,
  }));
}

const summary = {
  playerCount,
  games,
  seedStart,
  completed,
  stalled,
  actionLimit,
  topErrors: [...errors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
};
console.log(JSON.stringify(summary, null, 2));
if (stalled > 0 || actionLimit > 0) {
  throw new Error(`${playerCount}p range still has ${stalled} STALLED and ${actionLimit} ACTION_LIMIT games`);
}
