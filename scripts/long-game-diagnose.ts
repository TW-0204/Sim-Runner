import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AUGMENT_BY_ID } from "@/lib/augments/catalog";
import { getBalanceRuleset } from "@/lib/simulation/rulesets";
import { simulateGame } from "@/lib/simulation/game";
import type { SimulationGameResult } from "@/lib/simulation/types";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positiveInteger(name: string, value: string | undefined, fallback: number) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`--${name} must be a positive integer.`);
  return parsed;
}

const playerCount = positiveInteger("player-count", argument("player-count"), 2) as 2 | 3 | 4;
if (![2, 3, 4].includes(playerCount)) throw new Error("--player-count must be 2, 3, or 4.");
const games = positiveInteger("games", argument("games"), 6000);
const seedStart = Number(argument("seed-start") ?? "0");
if (!Number.isInteger(seedStart) || seedStart < 0) throw new Error("--seed-start must be non-negative.");
const batchId = argument("batch-id") ?? "1";
const roundCap = positiveInteger("round-cap", argument("round-cap"), 30);
const extendedRoundCap = positiveInteger("extended-round-cap", argument("extended-round-cap"), 100);
const outputDir = argument("output-dir") ?? "long-game-results";
const ruleset = getBalanceRuleset(argument("ruleset") ?? "two-aug-start-r4-special-slots-v2");

type Counter = {
  ownerInstances: number;
  over15OwnerInstances: number;
  over20OwnerInstances: number;
  roundCapOwnerInstances: number;
  gamesContaining: number;
  roundCapGamesContaining: number;
};

const counters: Record<string, Counter> = {};
const longCases: Array<{
  seed: string;
  round: number;
  turnNumber: number;
  actions: number;
  owners: Array<{ userId: string; augmentIds: string[] }>;
  extendedStatus: SimulationGameResult["status"];
  extendedRound: number;
  extendedTurnNumber: number;
  extendedActions: number;
  extendedWinnerSeat: number | null;
}> = [];

const statusCounts: Record<string, number> = {};
const extendedStatusCounts: Record<string, number> = {};
let over15Games = 0;
let over20Games = 0;
let roundCapGames = 0;
let completedGames = 0;

function counterFor(id: string) {
  counters[id] ??= {
    ownerInstances: 0,
    over15OwnerInstances: 0,
    over20OwnerInstances: 0,
    roundCapOwnerInstances: 0,
    gamesContaining: 0,
    roundCapGamesContaining: 0,
  };
  return counters[id];
}

function ownerAugments(result: SimulationGameResult) {
  const byOwner = new Map<string, Set<string>>();
  for (const acquisition of result.acquisitions) {
    const ids = byOwner.get(acquisition.userId) ?? new Set<string>();
    ids.add(acquisition.augmentId);
    byOwner.set(acquisition.userId, ids);
  }
  return byOwner;
}

const startedAt = Date.now();
console.error(`[long-game] ${playerCount}p batch ${batchId}: ${games} games, seeds ${seedStart}..${seedStart + games - 1}`);

for (let offset = 0; offset < games; offset += 1) {
  const seed = String(seedStart + offset);
  const result = simulateGame({ seed, ruleset, playerCount, maxActions: 20_000, maxRounds: roundCap });
  statusCounts[result.status] = (statusCounts[result.status] ?? 0) + 1;
  if (result.status === "COMPLETED") completedGames += 1;
  const over15 = result.status === "LONG_GAME" || result.round > 15;
  const over20 = result.status === "LONG_GAME" || result.round > 20;
  if (over15) over15Games += 1;
  if (over20) over20Games += 1;

  const byOwner = ownerAugments(result);
  const gameIds = new Set<string>();
  for (const ids of byOwner.values()) for (const id of ids) gameIds.add(id);
  for (const id of gameIds) counterFor(id).gamesContaining += 1;
  for (const ids of byOwner.values()) {
    for (const id of ids) {
      const counter = counterFor(id);
      counter.ownerInstances += 1;
      if (over15) counter.over15OwnerInstances += 1;
      if (over20) counter.over20OwnerInstances += 1;
    }
  }

  if (result.status !== "LONG_GAME") continue;
  roundCapGames += 1;
  for (const id of gameIds) counterFor(id).roundCapGamesContaining += 1;
  for (const ids of byOwner.values()) for (const id of ids) counterFor(id).roundCapOwnerInstances += 1;

  const extended = simulateGame({
    seed,
    ruleset,
    playerCount,
    maxActions: 100_000,
    maxRounds: extendedRoundCap,
  });
  extendedStatusCounts[extended.status] = (extendedStatusCounts[extended.status] ?? 0) + 1;
  longCases.push({
    seed,
    round: result.round,
    turnNumber: result.turnNumber,
    actions: result.actions,
    owners: [...byOwner.entries()].map(([userId, ids]) => ({ userId, augmentIds: [...ids].sort() })),
    extendedStatus: extended.status,
    extendedRound: extended.round,
    extendedTurnNumber: extended.turnNumber,
    extendedActions: extended.actions,
    extendedWinnerSeat: extended.winnerSeat,
  });
}

const augmentRows = Object.entries(counters).map(([augmentId, counter]) => ({
  augmentId,
  name: AUGMENT_BY_ID.get(augmentId)?.name ?? augmentId,
  ...counter,
  over15Rate: counter.ownerInstances ? counter.over15OwnerInstances / counter.ownerInstances : 0,
  over20Rate: counter.ownerInstances ? counter.over20OwnerInstances / counter.ownerInstances : 0,
  roundCapRate: counter.ownerInstances ? counter.roundCapOwnerInstances / counter.ownerInstances : 0,
  containingRoundCapRate: counter.gamesContaining ? counter.roundCapGamesContaining / counter.gamesContaining : 0,
})).sort((a, b) => b.roundCapRate - a.roundCapRate || b.over20Rate - a.over20Rate || b.ownerInstances - a.ownerInstances);

const payload = {
  metadata: {
    rulesetId: ruleset.id,
    playerCount,
    batchId,
    games,
    seedStart,
    seedEnd: seedStart + games - 1,
    roundCap,
    extendedRoundCap,
    elapsedSeconds: (Date.now() - startedAt) / 1000,
    generatedAt: new Date().toISOString(),
  },
  summary: {
    completedGames,
    over15Games,
    over20Games,
    roundCapGames,
    over15Rate: over15Games / games,
    over20Rate: over20Games / games,
    roundCapRate: roundCapGames / games,
    statusCounts,
    extendedStatusCounts,
  },
  augmentRows,
  longCases,
};

mkdirSync(outputDir, { recursive: true });
const baseName = `long-game-${playerCount}p-${batchId}-seed-${seedStart}`;
writeFileSync(join(outputDir, `${baseName}.json`), `${JSON.stringify(payload, null, 2)}\n`, "utf-8");

const pct = (value: number) => `${(value * 100).toFixed(2)}%`;
const markdown = [
  `# Long Game Diagnostic — ${playerCount}P / ${batchId}`,
  "",
  `- games: ${games.toLocaleString()}`,
  `- >15R: ${over15Games.toLocaleString()} (${pct(over15Games / games)})`,
  `- >20R: ${over20Games.toLocaleString()} (${pct(over20Games / games)})`,
  `- >${roundCap}R / LONG_GAME: ${roundCapGames.toLocaleString()} (${pct(roundCapGames / games)})`,
  `- extended outcomes (cap ${extendedRoundCap}R): ${JSON.stringify(extendedStatusCounts)}`,
  "",
  "## Highest round-cap association (min 20 owner instances in this batch)",
  "",
  "| Augment | Owners | >15R | >20R | Cap |",
  "|---|---:|---:|---:|---:|",
  ...augmentRows.filter((row) => row.ownerInstances >= 20).slice(0, 15).map((row) => `| ${row.augmentId} ${row.name} | ${row.ownerInstances} | ${pct(row.over15Rate)} | ${pct(row.over20Rate)} | ${pct(row.roundCapRate)} |`),
  "",
].join("\n");
writeFileSync(join(outputDir, `${baseName}.md`), `${markdown}\n`, "utf-8");
console.log(markdown);
