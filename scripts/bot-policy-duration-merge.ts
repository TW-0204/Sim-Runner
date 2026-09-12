import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const inputDir = argument("input-dir") ?? "bot-policy-results";
const outputDir = argument("output-dir") ?? "bot-policy-merged";

type Report = {
  label: string;
  playerCount: number;
  games: number;
  weights: { captureReward: number; onBoardBase: number };
  completed: number;
  longGames: number;
  engineIncomplete: number;
  averageRound: number | null;
  p50Round: number | null;
  p90Round: number | null;
  over15Rate: number;
  over20Rate: number;
  over30Rate: number;
  averageCapturesPerPlayerGame: number;
  averageMovesPerPlayerGame: number;
  averageFinishedPerPlayerGame: number;
  averageSentToWaitingPerPlayerGame: number;
};

const files = readdirSync(inputDir).filter((name) => name.endsWith(".json"));
const reports = files.map((name) => JSON.parse(readFileSync(join(inputDir, name), "utf-8")) as Report)
  .sort((a, b) => a.label.localeCompare(b.label) || a.playerCount - b.playerCount);

if (!reports.length) throw new Error(`No JSON reports found in ${inputDir}.`);

const baselineByPlayers = new Map(
  reports.filter((item) => item.label === "baseline").map((item) => [item.playerCount, item]),
);
const pct = (value: number) => `${(value * 100).toFixed(2)}%`;
const pp = (value: number) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%p`;

const rows = reports.map((item) => {
  const baseline = baselineByPlayers.get(item.playerCount);
  return {
    ...item,
    over15DeltaVsBaseline: baseline ? item.over15Rate - baseline.over15Rate : 0,
    averageRoundDeltaVsBaseline: baseline && item.averageRound != null && baseline.averageRound != null
      ? item.averageRound - baseline.averageRound
      : null,
    captureDeltaVsBaseline: baseline
      ? item.averageCapturesPerPlayerGame - baseline.averageCapturesPerPlayerGame
      : 0,
  };
});

const labels = [...new Set(reports.map((item) => item.label))];
const aggregate = labels.map((label) => {
  const group = reports.filter((item) => item.label === label);
  const games = group.reduce((sum, item) => sum + item.games, 0);
  const completed = group.reduce((sum, item) => sum + item.completed, 0);
  const weighted = (pick: (item: Report) => number) => (
    group.reduce((sum, item) => sum + pick(item) * item.completed, 0) / Math.max(1, completed)
  );
  const baselineGroup = reports.filter((item) => item.label === "baseline");
  const baselineCompleted = baselineGroup.reduce((sum, item) => sum + item.completed, 0);
  const baselineOver15 = baselineGroup.reduce((sum, item) => sum + item.over15Rate * item.completed, 0) / Math.max(1, baselineCompleted);
  const baselineAvgRound = baselineGroup.reduce((sum, item) => sum + (item.averageRound ?? 0) * item.completed, 0) / Math.max(1, baselineCompleted);
  return {
    label,
    games,
    completed,
    weights: group[0]?.weights,
    over15Rate: weighted((item) => item.over15Rate),
    over20Rate: weighted((item) => item.over20Rate),
    over30Rate: weighted((item) => item.over30Rate),
    averageRound: weighted((item) => item.averageRound ?? 0),
    averageCapturesPerPlayerGame: group.reduce((sum, item) => sum + item.averageCapturesPerPlayerGame * item.playerCount * item.games, 0)
      / Math.max(1, group.reduce((sum, item) => sum + item.playerCount * item.games, 0)),
    over15DeltaVsBaseline: weighted((item) => item.over15Rate) - baselineOver15,
    averageRoundDeltaVsBaseline: weighted((item) => item.averageRound ?? 0) - baselineAvgRound,
    longGames: group.reduce((sum, item) => sum + item.longGames, 0),
    engineIncomplete: group.reduce((sum, item) => sum + item.engineIncomplete, 0),
  };
});

const markdown = [
  "# Bot Policy Duration Comparison",
  "",
  "## Aggregate across 2P / 3P / 4P",
  "",
  "| Policy | Capture weight | On-board base | Avg round | >15R | Δ >15R | >20R | >30R | Captures/player-game | Long >100R | Engine incomplete |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...aggregate.map((item) => `| ${item.label} | ${item.weights?.captureReward ?? "—"} | ${item.weights?.onBoardBase ?? "—"} | ${item.averageRound.toFixed(2)} (${item.averageRoundDeltaVsBaseline >= 0 ? "+" : ""}${item.averageRoundDeltaVsBaseline.toFixed(2)}) | ${pct(item.over15Rate)} | ${pp(item.over15DeltaVsBaseline)} | ${pct(item.over20Rate)} | ${pct(item.over30Rate)} | ${item.averageCapturesPerPlayerGame.toFixed(2)} | ${item.longGames} | ${item.engineIncomplete} |`),
  "",
  "## By player count",
  "",
  "| Policy | Players | Avg round | Δ round | >15R | Δ >15R | >20R | >30R | Captures/player-game | Finishes/player-game | Sent to waiting/player-game |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...rows.map((item) => `| ${item.label} | ${item.playerCount} | ${item.averageRound?.toFixed(2) ?? "—"} | ${item.averageRoundDeltaVsBaseline == null ? "—" : `${item.averageRoundDeltaVsBaseline >= 0 ? "+" : ""}${item.averageRoundDeltaVsBaseline.toFixed(2)}`} | ${pct(item.over15Rate)} | ${pp(item.over15DeltaVsBaseline)} | ${pct(item.over20Rate)} | ${pct(item.over30Rate)} | ${item.averageCapturesPerPlayerGame.toFixed(2)} | ${item.averageFinishedPerPlayerGame.toFixed(2)} | ${item.averageSentToWaitingPerPlayerGame.toFixed(2)} |`),
  "",
].join("\n");

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, "bot-policy-duration-comparison.json"), `${JSON.stringify({ reports, aggregate }, null, 2)}\n`, "utf-8");
writeFileSync(join(outputDir, "bot-policy-duration-comparison.md"), `${markdown}\n`, "utf-8");
console.log(markdown);

if (reports.some((item) => item.engineIncomplete > 0)) process.exitCode = 1;
