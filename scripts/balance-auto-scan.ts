import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildBalanceScanReport, renderBalanceScanMarkdown } from "@/lib/simulation/auto-scan";
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

function elapsedSeconds(startedAt: number) {
  return ((Date.now() - startedAt) / 1000).toFixed(1);
}

const rulesetId = argument("ruleset") ?? "two-aug-start-r4-special-slots-v2";
const games = positiveInteger("games", argument("games"), 10_000);
const minSamples = positiveInteger("min-samples", argument("min-samples"), 200);
const seedStart = Number(argument("seed-start") ?? "0");
const maxActions = positiveInteger("max-actions", argument("max-actions"), 20_000);
const outputDir = argument("output-dir") ?? "balance-results";
const failOnIncomplete = flag("fail-on-incomplete");

if (!Number.isInteger(seedStart) || seedStart < 0) throw new Error("--seed-start must be a non-negative integer.");

const ruleset = getBalanceRuleset(rulesetId);
const playerCounts = [2, 3, 4] as const;
const summaries = [];
let incompleteGames = 0;
const scanStartedAt = Date.now();

console.error(`[balance-scan] ${ruleset.id}: ${games} games × 2p/3p/4p = ${games * 3} total games`);
for (const playerCount of playerCounts) {
  const batchStartedAt = Date.now();
  console.error(`[balance-scan] ${playerCount}p starting...`);
  const result = runSimulationBatch({
    rulesetId: ruleset.id,
    playerCount,
    games,
    seedStart,
    maxActions,
  });
  const batchIncomplete = result.games.filter((game) => game.status !== "COMPLETED").length;
  incompleteGames += batchIncomplete;
  summaries.push(result.summary);
  console.error(
    `[balance-scan] ${playerCount}p complete in ${elapsedSeconds(batchStartedAt)}s`
    + ` (${result.summary.completedGames}/${games} completed, ${batchIncomplete} incomplete)`,
  );
}

const excludedAugmentIds = [...new Set(
  Object.values(ruleset.excludedAugmentIdsByLogicalPhase ?? {}).flatMap((ids) => ids ?? []),
)];

const report = buildBalanceScanReport({
  rulesetId: ruleset.id,
  summaries,
  gamesPerPlayerCount: games,
  minSamples,
  incompleteGames,
  excludedAugmentIds,
});
const markdown = renderBalanceScanMarkdown(report);

mkdirSync(outputDir, { recursive: true });
const baseName = `auto-scan-${ruleset.id}-${games}`;
const jsonPath = join(outputDir, `${baseName}.json`);
const markdownPath = join(outputDir, `${baseName}.md`);
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
writeFileSync(markdownPath, `${markdown}\n`, "utf-8");

console.log(markdown);
console.error(`[balance-scan] total elapsed: ${elapsedSeconds(scanStartedAt)}s`);
console.error(`Balance Auto Scan JSON: ${jsonPath}`);
console.error(`Balance Auto Scan Markdown: ${markdownPath}`);

if (failOnIncomplete && incompleteGames > 0) {
  console.error(`Balance Auto Scan found ${incompleteGames} incomplete game(s).`);
  process.exitCode = 1;
}
