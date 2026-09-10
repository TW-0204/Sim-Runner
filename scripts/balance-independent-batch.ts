import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runSimulationBatch } from "@/lib/simulation/batch";
import { getBalanceRuleset } from "@/lib/simulation/rulesets";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function flag(name: string) {
  return process.argv.includes(`--${name}`);
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
const rulesetId = argument("ruleset") ?? "two-aug-start-r4-special-slots-v2";
const maxActions = positiveInteger("max-actions", argument("max-actions"), 20_000);
const outputDir = argument("output-dir") ?? "independent-results";
const failOnIncomplete = flag("fail-on-incomplete");
const ruleset = getBalanceRuleset(rulesetId);

const startedAt = Date.now();
console.error(`[independent] ${playerCount}p batch ${batchId}: ${games} games, seeds ${seedStart}..${seedStart + games - 1}`);

const result = runSimulationBatch({
  rulesetId: ruleset.id,
  playerCount,
  games,
  seedStart,
  maxActions,
});

const elapsedSeconds = (Date.now() - startedAt) / 1000;
const incompleteGames = result.summary.stalledGames + result.summary.actionLimitGames;
const payload = {
  metadata: {
    rulesetId: ruleset.id,
    playerCount,
    batchId,
    games,
    seedStart,
    seedEnd: seedStart + games - 1,
    generatedAt: new Date().toISOString(),
    elapsedSeconds,
  },
  summary: result.summary,
};

mkdirSync(outputDir, { recursive: true });
const baseName = `batch-${playerCount}p-${batchId}-seed-${seedStart}`;
const jsonPath = join(outputDir, `${baseName}.json`);
const mdPath = join(outputDir, `${baseName}.md`);
writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
writeFileSync(mdPath, [
  `# Independent Balance Batch — ${playerCount}P / ${batchId}`,
  "",
  `- ruleset: ${ruleset.id}`,
  `- games: ${games.toLocaleString()}`,
  `- seeds: ${seedStart}–${seedStart + games - 1}`,
  `- completed: ${result.summary.completedGames.toLocaleString()}/${games.toLocaleString()}`,
  `- stalled: ${result.summary.stalledGames}`,
  `- action limit: ${result.summary.actionLimitGames}`,
  `- elapsed: ${elapsedSeconds.toFixed(1)}s`,
  "",
].join("\n"), "utf-8");

console.error(`[independent] ${playerCount}p batch ${batchId} complete in ${elapsedSeconds.toFixed(1)}s`);
console.error(`[independent] ${result.summary.completedGames}/${games} completed, ${incompleteGames} incomplete`);
console.log(jsonPath);

if (failOnIncomplete && incompleteGames > 0) process.exitCode = 1;
