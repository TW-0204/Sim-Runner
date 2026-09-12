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
    else if (name.startsWith("long-game-") && name.endsWith(".json")) files.push(path);
  }
  return files;
}

type Payload = {
  metadata: { playerCount: 2 | 3 | 4; batchId: string; games: number; seedStart: number; seedEnd: number; roundCap: number; extendedRoundCap: number };
  summary: {
    completedGames: number;
    over15Games: number;
    over20Games: number;
    roundCapGames: number;
    statusCounts: Record<string, number>;
    extendedStatusCounts: Record<string, number>;
  };
  augmentRows: Array<{
    augmentId: string;
    ownerInstances: number;
    over15OwnerInstances: number;
    over20OwnerInstances: number;
    roundCapOwnerInstances: number;
    gamesContaining: number;
    roundCapGamesContaining: number;
  }>;
  longCases: Array<{
    seed: string;
    extendedStatus: string;
    extendedRound: number;
    owners: Array<{ userId: string; augmentIds: string[] }>;
  }>;
};

const inputDir = argument("input-dir") ?? "long-game-results";
const outputDir = argument("output-dir") ?? "long-game-merged";
const files = collectJsonFiles(inputDir);
if (!files.length) throw new Error(`No long-game JSON files under ${inputDir}.`);
const payloads = files.map((path) => JSON.parse(readFileSync(path, "utf-8")) as Payload);

const totals = {
  games: 0,
  completedGames: 0,
  over15Games: 0,
  over20Games: 0,
  roundCapGames: 0,
};
const byPlayer: Record<string, typeof totals> = {};
const extendedStatusCounts: Record<string, number> = {};
const augmentCounters: Record<string, {
  ownerInstances: number;
  over15OwnerInstances: number;
  over20OwnerInstances: number;
  roundCapOwnerInstances: number;
  gamesContaining: number;
  roundCapGamesContaining: number;
}> = {};
const longCases: Payload["longCases"] = [];

for (const payload of payloads) {
  const pc = String(payload.metadata.playerCount);
  byPlayer[pc] ??= { games: 0, completedGames: 0, over15Games: 0, over20Games: 0, roundCapGames: 0 };
  for (const target of [totals, byPlayer[pc]]) {
    target.games += payload.metadata.games;
    target.completedGames += payload.summary.completedGames;
    target.over15Games += payload.summary.over15Games;
    target.over20Games += payload.summary.over20Games;
    target.roundCapGames += payload.summary.roundCapGames;
  }
  for (const [status, count] of Object.entries(payload.summary.extendedStatusCounts)) {
    extendedStatusCounts[status] = (extendedStatusCounts[status] ?? 0) + count;
  }
  for (const row of payload.augmentRows) {
    augmentCounters[row.augmentId] ??= {
      ownerInstances: 0,
      over15OwnerInstances: 0,
      over20OwnerInstances: 0,
      roundCapOwnerInstances: 0,
      gamesContaining: 0,
      roundCapGamesContaining: 0,
    };
    const target = augmentCounters[row.augmentId];
    target.ownerInstances += row.ownerInstances;
    target.over15OwnerInstances += row.over15OwnerInstances;
    target.over20OwnerInstances += row.over20OwnerInstances;
    target.roundCapOwnerInstances += row.roundCapOwnerInstances;
    target.gamesContaining += row.gamesContaining;
    target.roundCapGamesContaining += row.roundCapGamesContaining;
  }
  longCases.push(...payload.longCases);
}

const augmentRows = Object.entries(augmentCounters).map(([augmentId, counter]) => ({
  augmentId,
  name: AUGMENT_BY_ID.get(augmentId)?.name ?? augmentId,
  ...counter,
  over15Rate: counter.ownerInstances ? counter.over15OwnerInstances / counter.ownerInstances : 0,
  over20Rate: counter.ownerInstances ? counter.over20OwnerInstances / counter.ownerInstances : 0,
  roundCapRate: counter.ownerInstances ? counter.roundCapOwnerInstances / counter.ownerInstances : 0,
  containingRoundCapRate: counter.gamesContaining ? counter.roundCapGamesContaining / counter.gamesContaining : 0,
})).sort((a, b) => b.roundCapRate - a.roundCapRate || b.over20Rate - a.over20Rate || b.ownerInstances - a.ownerInstances);

const extendedRounds = longCases.filter((item) => item.extendedStatus === "COMPLETED").map((item) => item.extendedRound).sort((a, b) => a - b);
const averageExtendedRound = extendedRounds.length ? extendedRounds.reduce((a, b) => a + b, 0) / extendedRounds.length : null;
const percentile = (p: number) => extendedRounds.length ? extendedRounds[Math.min(extendedRounds.length - 1, Math.ceil(extendedRounds.length * p) - 1)] : null;
const pct = (n: number, d: number) => d ? `${(n / d * 100).toFixed(2)}%` : "—";

const markdown = [
  "# Long Game 90K Audit",
  "",
  `- total: ${totals.games.toLocaleString()}`,
  `- >15R: ${totals.over15Games.toLocaleString()} (${pct(totals.over15Games, totals.games)})`,
  `- >20R: ${totals.over20Games.toLocaleString()} (${pct(totals.over20Games, totals.games)})`,
  `- 30R cap: ${totals.roundCapGames.toLocaleString()} (${pct(totals.roundCapGames, totals.games)})`,
  `- cap cases rerun outcome: ${JSON.stringify(extendedStatusCounts)}`,
  `- eventual completion round avg/p50/p90: ${averageExtendedRound?.toFixed(2) ?? "—"} / ${percentile(0.5) ?? "—"} / ${percentile(0.9) ?? "—"}`,
  "",
  "## By player count",
  "",
  "| Players | Games | >15R | >20R | 30R cap |",
  "|---:|---:|---:|---:|---:|",
  ...[2, 3, 4].map((pc) => {
    const row = byPlayer[String(pc)] ?? { games: 0, over15Games: 0, over20Games: 0, roundCapGames: 0 };
    return `| ${pc} | ${row.games} | ${pct(row.over15Games, row.games)} | ${pct(row.over20Games, row.games)} | ${pct(row.roundCapGames, row.games)} |`;
  }),
  "",
  "## Augments most associated with 30R cap",
  "",
  "| Augment | Owner samples | >15R | >20R | 30R cap |",
  "|---|---:|---:|---:|---:|",
  ...augmentRows.filter((row) => row.ownerInstances >= 200).slice(0, 20).map((row) => `| ${row.augmentId} ${row.name} | ${row.ownerInstances} | ${(row.over15Rate * 100).toFixed(2)}% | ${(row.over20Rate * 100).toFixed(2)}% | ${(row.roundCapRate * 100).toFixed(2)}% |`),
  "",
].join("\n");

const report = {
  generatedAt: new Date().toISOString(),
  totals,
  byPlayer,
  extendedStatusCounts,
  averageExtendedRound,
  p50ExtendedRound: percentile(0.5),
  p90ExtendedRound: percentile(0.9),
  augmentRows,
  longCases,
};

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, "long-game-90k.json"), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
writeFileSync(join(outputDir, "long-game-90k.md"), `${markdown}\n`, "utf-8");
console.log(markdown);
