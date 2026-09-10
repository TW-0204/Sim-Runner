import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AUGMENT_BY_ID } from "@/lib/augments/catalog";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function collectJsonFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...collectJsonFiles(path));
    else if (name.endsWith(".json") && name.startsWith("incomplete-")) files.push(path);
  }
  return files;
}

function pct(value: number, digits = 3) {
  return `${(value * 100).toFixed(digits)}%`;
}

function ratio(value: number) {
  return Number.isFinite(value) ? `${value.toFixed(2)}×` : "—";
}

type Counter = {
  gamesContaining: number;
  incompleteGamesContaining: number;
  ownerInstances: number;
  incompleteOwnerInstances: number;
};

type Payload = {
  metadata: {
    rulesetId: string;
    playerCount: 2 | 3 | 4;
    batchId: string;
    games: number;
    seedStart: number;
    seedEnd: number;
    elapsedSeconds: number;
  };
  summary: {
    incompleteGames: number;
    incompleteRate: number;
    statusCounts: Record<string, number>;
    errorCounts: Record<string, number>;
    roundCounts: Record<string, number>;
    augmentCounters: Record<string, Counter>;
  };
  incompleteCases: Array<{
    seed: string;
    status: "STALLED" | "ACTION_LIMIT";
    round: number;
    turnNumber: number;
    actions: number;
    error?: string;
    augmentIds: string[];
    owners: Array<{ userId: string; augmentIds: string[] }>;
  }>;
};

const inputDir = argument("input-dir") ?? "incomplete-diagnose-results";
const outputDir = argument("output-dir") ?? "incomplete-diagnose-merged";
const files = collectJsonFiles(inputDir);
if (!files.length) throw new Error(`No incomplete diagnostic JSON files under ${inputDir}.`);
const batches = files.map((file) => JSON.parse(readFileSync(file, "utf-8")) as Payload);
const rulesetId = batches[0]?.metadata.rulesetId;
if (!rulesetId || batches.some((batch) => batch.metadata.rulesetId !== rulesetId)) throw new Error("Mixed ruleset IDs.");
for (const playerCount of [2, 3, 4] as const) {
  const count = batches.filter((batch) => batch.metadata.playerCount === playerCount).length;
  if (count !== 3) throw new Error(`Expected 3 batches for ${playerCount}p, found ${count}.`);
}

const totalGames = batches.reduce((sum, batch) => sum + batch.metadata.games, 0);
const totalIncomplete = batches.reduce((sum, batch) => sum + batch.summary.incompleteGames, 0);
const baselineByPlayerCount = Object.fromEntries(([2, 3, 4] as const).map((playerCount) => {
  const pc = batches.filter((batch) => batch.metadata.playerCount === playerCount);
  const games = pc.reduce((sum, batch) => sum + batch.metadata.games, 0);
  const incomplete = pc.reduce((sum, batch) => sum + batch.summary.incompleteGames, 0);
  return [playerCount, { games, incomplete, rate: incomplete / games }];
})) as Record<2 | 3 | 4, { games: number; incomplete: number; rate: number }>;

const ids = new Set<string>();
for (const batch of batches) for (const id of Object.keys(batch.summary.augmentCounters)) ids.add(id);

const augmentRows = [...ids].map((id) => {
  const byPlayerCount = {} as Record<2 | 3 | 4, {
    gamesContaining: number;
    incompleteGamesContaining: number;
    incompleteRate: number;
    baselineRate: number;
    enrichment: number;
    ownerInstances: number;
    incompleteOwnerInstances: number;
  }>;
  let totalContaining = 0;
  let totalIncompleteContaining = 0;
  for (const playerCount of [2, 3, 4] as const) {
    const pc = batches.filter((batch) => batch.metadata.playerCount === playerCount);
    const counter = pc.reduce<Counter>((sum, batch) => {
      const value = batch.summary.augmentCounters[id];
      if (!value) return sum;
      sum.gamesContaining += value.gamesContaining;
      sum.incompleteGamesContaining += value.incompleteGamesContaining;
      sum.ownerInstances += value.ownerInstances;
      sum.incompleteOwnerInstances += value.incompleteOwnerInstances;
      return sum;
    }, { gamesContaining: 0, incompleteGamesContaining: 0, ownerInstances: 0, incompleteOwnerInstances: 0 });
    const incompleteRate = counter.gamesContaining ? counter.incompleteGamesContaining / counter.gamesContaining : 0;
    const baselineRate = baselineByPlayerCount[playerCount].rate;
    byPlayerCount[playerCount] = {
      ...counter,
      incompleteRate,
      baselineRate,
      enrichment: baselineRate > 0 ? incompleteRate / baselineRate : 0,
    };
    totalContaining += counter.gamesContaining;
    totalIncompleteContaining += counter.incompleteGamesContaining;
  }
  const weightedExpected = ([2, 3, 4] as const).reduce((sum, pc) => {
    const cell = byPlayerCount[pc];
    return sum + cell.gamesContaining * cell.baselineRate;
  }, 0);
  const overallEnrichment = weightedExpected > 0 ? totalIncompleteContaining / weightedExpected : 0;
  const augment = AUGMENT_BY_ID.get(id);
  return {
    id,
    name: augment?.name ?? id,
    tier: augment?.tier ?? "unknown",
    special: Boolean(augment?.special),
    totalContaining,
    totalIncompleteContaining,
    overallEnrichment,
    byPlayerCount,
  };
}).sort((a, b) => b.overallEnrichment - a.overallEnrichment || b.totalIncompleteContaining - a.totalIncompleteContaining);

const pairCounts = new Map<string, number>();
const errorCounts = new Map<string, number>();
const roundCounts = new Map<number, number>();
const statusCounts = { STALLED: 0, ACTION_LIMIT: 0 };
for (const batch of batches) {
  for (const item of batch.incompleteCases) {
    statusCounts[item.status] += 1;
    roundCounts.set(item.round, (roundCounts.get(item.round) ?? 0) + 1);
    if (item.error) errorCounts.set(item.error, (errorCounts.get(item.error) ?? 0) + 1);
    const ids = [...new Set(item.augmentIds)].sort();
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const key = `${ids[i]} + ${ids[j]}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }
}

const topPairs = [...pairCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
const topErrors = [...errorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
const topRounds = [...roundCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);

function cell(row: typeof augmentRows[number], pc: 2 | 3 | 4) {
  const value = row.byPlayerCount[pc];
  if (!value.gamesContaining) return "—";
  return `${value.incompleteGamesContaining}/${value.gamesContaining} ${pct(value.incompleteRate)} (${ratio(value.enrichment)})`;
}

const markdown = [
  `# 90K Incomplete Diagnostics — ${rulesetId}`,
  "",
  `- 총 게임: ${totalGames.toLocaleString()}판`,
  `- 미완료: ${totalIncomplete.toLocaleString()}판 (${pct(totalIncomplete / totalGames)})`,
  `- STALLED: ${statusCounts.STALLED.toLocaleString()}판`,
  `- ACTION_LIMIT: ${statusCounts.ACTION_LIMIT.toLocaleString()}판`,
  `- 2인 baseline: ${baselineByPlayerCount[2].incomplete}/${baselineByPlayerCount[2].games} (${pct(baselineByPlayerCount[2].rate)})`,
  `- 3인 baseline: ${baselineByPlayerCount[3].incomplete}/${baselineByPlayerCount[3].games} (${pct(baselineByPlayerCount[3].rate)})`,
  `- 4인 baseline: ${baselineByPlayerCount[4].incomplete}/${baselineByPlayerCount[4].games} (${pct(baselineByPlayerCount[4].rate)})`,
  "",
  "> 증강별 수치는 그 증강이 한 명 이상 등장한 게임 중 미완료 비율입니다. 괄호의 ×는 같은 인원수 전체 baseline 대비 배율이며 인과관계를 뜻하지 않습니다.",
  "",
  "| 증강 | 2인 | 3인 | 4인 | 가중 enrichment | 미완료 동반 |",
  "|---|---|---|---|---:|---:|",
  ...augmentRows.map((row) => `| ${row.id} ${row.name} | ${cell(row, 2)} | ${cell(row, 3)} | ${cell(row, 4)} | ${ratio(row.overallEnrichment)} | ${row.totalIncompleteContaining} |`),
  "",
  "## 미완료에서 자주 함께 나온 증강 조합",
  "",
  ...topPairs.map(([pair, count]) => `- ${pair}: ${count}`),
  "",
  "## 에러 분포",
  "",
  ...(topErrors.length ? topErrors.map(([error, count]) => `- ${count}: ${error}`) : ["- 명시적 error 없음"]),
  "",
  "## 미완료 라운드 상위",
  "",
  ...topRounds.map(([round, count]) => `- Round ${round}: ${count}`),
  "",
].join("\n");

const report = {
  rulesetId,
  generatedAt: new Date().toISOString(),
  totalGames,
  totalIncomplete,
  statusCounts,
  baselineByPlayerCount,
  augmentRows,
  topPairs: topPairs.map(([pair, count]) => ({ pair, count })),
  topErrors: topErrors.map(([error, count]) => ({ error, count })),
  topRounds: topRounds.map(([round, count]) => ({ round, count })),
  incompleteCases: batches.flatMap((batch) => batch.incompleteCases.map((item) => ({ playerCount: batch.metadata.playerCount, ...item }))),
};

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, "incomplete-diagnostics.json"), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
writeFileSync(join(outputDir, "incomplete-diagnostics.md"), `${markdown}\n`, "utf-8");
console.log(markdown);
