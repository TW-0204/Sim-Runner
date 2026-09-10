import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AUGMENTS } from "@/lib/augments/catalog";
import { classifyAugmentStat, type BalanceScanSeverity } from "@/lib/simulation/auto-scan";
import { getBalanceRuleset } from "@/lib/simulation/rulesets";
import type { BatchSummary } from "@/lib/simulation/types";

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

type BatchPayload = {
  metadata: {
    rulesetId: string;
    playerCount: 2 | 3 | 4;
    batchId: string;
    games: number;
    seedStart: number;
    seedEnd: number;
    generatedAt: string;
    elapsedSeconds: number;
  };
  summary: BatchSummary;
};

function collectJsonFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...collectJsonFiles(path));
    else if (name.endsWith(".json") && name.startsWith("batch-")) files.push(path);
  }
  return files;
}

function severityRank(value: BalanceScanSeverity) {
  if (value === "CRITICAL") return 0;
  if (value === "WATCH") return 1;
  if (value === "LOW_SAMPLE") return 2;
  if (value === "OK") return 3;
  return 4;
}

function pct(value: number | null, digits = 1) {
  return value == null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

const inputDir = argument("input-dir") ?? "independent-results";
const outputDir = argument("output-dir") ?? "independent-merged";
const minSamples = positiveInteger("min-samples", argument("min-samples"), 200);
const files = collectJsonFiles(inputDir);
if (!files.length) throw new Error(`No independent batch JSON files found under ${inputDir}.`);

const batches = files.map((file) => JSON.parse(readFileSync(file, "utf-8")) as BatchPayload);
const rulesetId = batches[0]?.metadata.rulesetId;
if (!rulesetId || batches.some((batch) => batch.metadata.rulesetId !== rulesetId)) {
  throw new Error("Independent batches contain mixed or missing ruleset IDs.");
}

for (const playerCount of [2, 3, 4] as const) {
  const count = batches.filter((batch) => batch.metadata.playerCount === playerCount).length;
  if (count !== 3) throw new Error(`Expected 3 independent ${playerCount}p batches, found ${count}.`);
}

const ruleset = getBalanceRuleset(rulesetId);
const excludedIds = new Set(Object.values(ruleset.excludedAugmentIdsByLogicalPhase ?? {}).flatMap((ids) => ids ?? []));
const totalGames = batches.reduce((sum, batch) => sum + batch.metadata.games, 0);
const totalIncomplete = batches.reduce((sum, batch) => sum + batch.summary.stalledGames + batch.summary.actionLimitGames, 0);

const rows = AUGMENTS.map((augment) => {
  const excluded = excludedIds.has(augment.id);
  const byPlayerCount = {} as Record<2 | 3 | 4, {
    gamesOwned: number;
    wins: number;
    pooledWinRate: number | null;
    batchWinRates: Array<number | null>;
    spreadPp: number | null;
    severity: BalanceScanSeverity;
    deltaPp: number | null;
  }>;

  const severities: BalanceScanSeverity[] = [];
  for (const playerCount of [2, 3, 4] as const) {
    const pcBatches = batches
      .filter((batch) => batch.metadata.playerCount === playerCount)
      .sort((a, b) => Number(a.metadata.batchId) - Number(b.metadata.batchId));
    const stats = pcBatches.map((batch) => batch.summary.augmentWinStats[augment.id]);
    const gamesOwned = stats.reduce((sum, stat) => sum + (stat?.gamesOwned ?? 0), 0);
    const wins = stats.reduce((sum, stat) => sum + (stat?.wins ?? 0), 0);
    const batchWinRates = stats.map((stat) => stat && stat.gamesOwned > 0 ? stat.wins / stat.gamesOwned : null);
    const presentRates = batchWinRates.filter((value): value is number => value != null);
    const spreadPp = presentRates.length >= 2 ? (Math.max(...presentRates) - Math.min(...presentRates)) * 100 : null;
    const classified = classifyAugmentStat({ playerCount, gamesOwned, wins, minSamples, excluded });
    severities.push(classified.severity);
    byPlayerCount[playerCount] = {
      gamesOwned,
      wins,
      pooledWinRate: classified.winRate,
      batchWinRates,
      spreadPp,
      severity: classified.severity,
      deltaPp: classified.deltaPp,
    };
  }

  const overallSeverity = [...severities].sort((a, b) => severityRank(a) - severityRank(b))[0] ?? "OK";
  const precisionRecommended = !excluded && (
    overallSeverity === "CRITICAL"
    || overallSeverity === "WATCH"
    || (Boolean(augment.special) && severities.some((severity) => severity === "LOW_SAMPLE"))
  );

  return {
    augmentId: augment.id,
    name: augment.name,
    tier: augment.tier,
    special: Boolean(augment.special),
    excluded,
    overallSeverity,
    precisionRecommended,
    byPlayerCount,
  };
}).sort((a, b) => {
  const severityDelta = severityRank(a.overallSeverity) - severityRank(b.overallSeverity);
  if (severityDelta !== 0) return severityDelta;
  return a.augmentId.localeCompare(b.augmentId);
});

function cellText(row: typeof rows[number], playerCount: 2 | 3 | 4) {
  const cell = row.byPlayerCount[playerCount];
  if (row.excluded) return "제외";
  const batchRates = cell.batchWinRates.map((rate) => pct(rate)).join(" / ");
  const delta = cell.deltaPp == null ? "—" : `${cell.deltaPp >= 0 ? "+" : ""}${cell.deltaPp.toFixed(1)}%p`;
  const spread = cell.spreadPp == null ? "—" : `${cell.spreadPp.toFixed(1)}pp`;
  return `${pct(cell.pooledWinRate)} (${delta}, n=${cell.gamesOwned})<br>${batchRates}<br>spread ${spread}`;
}

const markdown = [
  `# Independent 90K Balance Scout — ${rulesetId}`,
  "",
  `- 총 시뮬레이션: ${totalGames.toLocaleString()}판`,
  "- 구성: 2/3/4인 × 독립 10K 3배치 = 9개 job",
  `- 미완료 게임: ${totalIncomplete.toLocaleString()}판`,
  `- 최소 유효 보유 표본: ${minSamples.toLocaleString()}판`,
  "- 각 셀 첫 줄은 3배치 합산 승률, 둘째 줄은 독립 배치 3개의 승률, 셋째 줄은 배치 간 최대-최소 차이입니다.",
  "",
  "## Batch runtime / seed ranges",
  "",
  ...batches
    .sort((a, b) => a.metadata.playerCount - b.metadata.playerCount || Number(a.metadata.batchId) - Number(b.metadata.batchId))
    .map((batch) => `- ${batch.metadata.playerCount}P #${batch.metadata.batchId}: seeds ${batch.metadata.seedStart}–${batch.metadata.seedEnd}, ${batch.metadata.elapsedSeconds.toFixed(1)}s, completed ${batch.summary.completedGames}/${batch.metadata.games}`),
  "",
  "| 증강 | 등급 | 2인 | 3인 | 4인 | 판정 | 정밀검사 |",
  "|---|---|---|---|---|---|---|",
  ...rows.map((row) => `| ${row.augmentId} ${row.name} | ${row.tier} | ${cellText(row, 2)} | ${cellText(row, 3)} | ${cellText(row, 4)} | ${row.overallSeverity} | ${row.precisionRecommended ? "필요" : "—"} |`),
  "",
  "## 정밀검사 후보",
  "",
  rows.filter((row) => row.precisionRecommended).map((row) => `\`${row.augmentId}\``).join(", ") || "없음",
  "",
].join("\n");

const report = {
  rulesetId,
  generatedAt: new Date().toISOString(),
  totalGames,
  totalIncomplete,
  minSamples,
  batches: batches.map((batch) => batch.metadata),
  rows,
};

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, "independent-90k-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
writeFileSync(join(outputDir, "independent-90k-report.md"), `${markdown}\n`, "utf-8");
console.log(markdown);
