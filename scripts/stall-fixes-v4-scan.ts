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
let actionLimit = 0;
let a16Games = 0;
let a16Stalls = 0;
let g01P11OwnerGames = 0;
let stackCapErrors = 0;
const errors = new Map<string, number>();

for (let offset = 0; offset < games; offset += 1) {
  const seed = String(seedStart + offset);
  const result = simulateGame({ seed, ruleset, playerCount, maxActions: 20_000 });
  const byOwner = new Map<string, Set<string>>();
  for (const acquisition of result.acquisitions) {
    const owned = byOwner.get(acquisition.userId) ?? new Set<string>();
    owned.add(acquisition.augmentId);
    byOwner.set(acquisition.userId, owned);
  }
  const hasA16 = [...byOwner.values()].some((owned) => owned.has("AUG-059"));
  const hasG01P11Owner = [...byOwner.values()].some((owned) => owned.has("AUG-017") && owned.has("AUG-038"));
  if (hasA16) a16Games += 1;
  if (hasG01P11Owner) g01P11OwnerGames += 1;

  if (result.status === "ACTION_LIMIT") actionLimit += 1;
  if (result.status !== "STALLED") continue;
  stalled += 1;
  if (hasA16) a16Stalls += 1;
  const error = result.error ?? "unknown";
  errors.set(error, (errors.get(error) ?? 0) + 1);
  if (error.includes("개판은 한 묶음에 최대 2개의 말만 업을 수 있습니다")) stackCapErrors += 1;
}

console.log(JSON.stringify({
  playerCount,
  games,
  seedStart,
  stalled,
  actionLimit,
  a16Games,
  a16Stalls,
  g01P11OwnerGames,
  stackCapErrors,
  topErrors: [...errors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
}, null, 2));

if (a16Stalls > 0) throw new Error(`AUG-059 still stalled in ${a16Stalls}/${a16Games} exposed games`);
if (stackCapErrors > 0) throw new Error(`AUG-017 stack-cap crash still occurred ${stackCapErrors} times`);
