import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getBalanceRuleset } from "@/lib/simulation/rulesets";
import { simulateGame } from "@/lib/simulation/game";

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

const playerCount = positiveInteger("player-count", argument("player-count"), 2);
if (![2, 3, 4].includes(playerCount)) throw new Error("--player-count must be 2, 3, or 4.");
const games = positiveInteger("games", argument("games"), 10_000);
const seedStart = Number(argument("seed-start") ?? "0");
if (!Number.isInteger(seedStart) || seedStart < 0) throw new Error("--seed-start must be a non-negative integer.");
const batchId = argument("batch-id") ?? "1";
const maxActions = positiveInteger("max-actions", argument("max-actions"), 20_000);
const outputDir = argument("output-dir") ?? "incomplete-diagnose-results";
const rulesetId = argument("ruleset") ?? "two-aug-start-r4-special-slots-v2";
const ruleset = getBalanceRuleset(rulesetId);

type AugmentCounter = {
  gamesContaining: number;
  incompleteGamesContaining: number;
  ownerInstances: number;
  incompleteOwnerInstances: number;
};

type IncompleteCase = {
  seed: string;
  status: "STALLED" | "ACTION_LIMIT";
  round: number;
  turnNumber: number;
  actions: number;
  error?: string;
  augmentIds: string[];
  owners: Array<{ userId: string; augmentIds: string[] }>;
};

const augmentCounters: Record<string, AugmentCounter> = {};
const incompleteCases: IncompleteCase[] = [];
const statusCounts = { STALLED: 0, ACTION_LIMIT: 0 };
const errorCounts: Record<string, number> = {};
const roundCounts: Record<string, number> = {};

function counterFor(id: string) {
  augmentCounters[id] ??= {
    gamesContaining: 0,
    incompleteGamesContaining: 0,
    ownerInstances: 0,
    incompleteOwnerInstances: 0,
  };
  return augmentCounters[id];
}

const startedAt = Date.now();
console.error(`[incomplete-diagnose] ${playerCount}p batch ${batchId}: ${games} games, seeds ${seedStart}..${seedStart + games - 1}`);

for (let offset = 0; offset < games; offset += 1) {
  const seed = String(seedStart + offset);
  const result = simulateGame({ seed, ruleset, playerCount, maxActions });
  const byOwner = new Map<string, Set<string>>();
  for (const acquisition of result.acquisitions) {
    const ids = byOwner.get(acquisition.userId) ?? new Set<string>();
    ids.add(acquisition.augmentId);
    byOwner.set(acquisition.userId, ids);
  }
  const gameIds = new Set<string>();
  for (const ids of byOwner.values()) for (const id of ids) gameIds.add(id);

  for (const id of gameIds) counterFor(id).gamesContaining += 1;
  for (const ids of byOwner.values()) {
    for (const id of ids) counterFor(id).ownerInstances += 1;
  }

  if (result.status === "COMPLETED") continue;
  if (result.status !== "STALLED" && result.status !== "ACTION_LIMIT") continue;

  statusCounts[result.status] += 1;
  roundCounts[String(result.round)] = (roundCounts[String(result.round)] ?? 0) + 1;
  if (result.error) errorCounts[result.error] = (errorCounts[result.error] ?? 0) + 1;
  for (const id of gameIds) counterFor(id).incompleteGamesContaining += 1;
  for (const ids of byOwner.values()) {
    for (const id of ids) counterFor(id).incompleteOwnerInstances += 1;
  }

  incompleteCases.push({
    seed,
    status: result.status,
    round: result.round,
    turnNumber: result.turnNumber,
    actions: result.actions,
    error: result.error,
    augmentIds: [...gameIds].sort(),
    owners: [...byOwner.entries()].map(([userId, ids]) => ({ userId, augmentIds: [...ids].sort() })),
  });
}

const elapsedSeconds = (Date.now() - startedAt) / 1000;
const payload = {
  metadata: {
    rulesetId: ruleset.id,
    playerCount,
    batchId,
    games,
    seedStart,
    seedEnd: seedStart + games - 1,
    maxActions,
    generatedAt: new Date().toISOString(),
    elapsedSeconds,
  },
  summary: {
    incompleteGames: incompleteCases.length,
    incompleteRate: incompleteCases.length / games,
    statusCounts,
    errorCounts,
    roundCounts,
    augmentCounters,
  },
  incompleteCases,
};

mkdirSync(outputDir, { recursive: true });
const baseName = `incomplete-${playerCount}p-${batchId}-seed-${seedStart}`;
const path = join(outputDir, `${baseName}.json`);
writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
console.error(`[incomplete-diagnose] ${playerCount}p batch ${batchId} complete in ${elapsedSeconds.toFixed(1)}s: ${incompleteCases.length}/${games} incomplete`);
console.log(path);
