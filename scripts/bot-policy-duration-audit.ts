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
const games = positiveInteger("games", argument("games"), 2_000);
const seedStart = positiveInteger("seed-start", argument("seed-start"), 1_200_000);
const maxRounds = positiveInteger("max-rounds", argument("max-rounds"), 100);
const label = argument("label") ?? "baseline";
const captureReward = Number(argument("capture-reward") ?? "85");
const onBoardBase = Number(argument("onboard-base") ?? "45");
const outputDir = argument("output-dir") ?? "bot-policy-results";
const ruleset = getBalanceRuleset("two-aug-start-r4-special-slots-v2");

const rounds: number[] = [];
let completed = 0;
let longGames = 0;
let engineIncomplete = 0;
let over15 = 0;
let over20 = 0;
let over30 = 0;
let totalCaptures = 0;
let totalMoves = 0;
let totalFinished = 0;
let totalSentToWaiting = 0;
let totalPlayerGames = 0;

for (let index = 0; index < games; index += 1) {
  const seed = seedStart + index;
  const result = simulateGame({
    seed: String(seed),
    ruleset,
    playerCount,
    maxActions: 50_000,
    maxRounds,
  });

  if (result.status === "COMPLETED") {
    completed += 1;
    rounds.push(result.round);
    if (result.round > 15) over15 += 1;
    if (result.round > 20) over20 += 1;
    if (result.round > 30) over30 += 1;
  } else if (result.status === "LONG_GAME") {
    longGames += 1;
  } else if (result.status !== "DRAW") {
    engineIncomplete += 1;
  }

  for (const telemetry of Object.values(result.performanceByUser ?? {})) {
    totalPlayerGames += 1;
    totalCaptures += telemetry.enemyPiecesCaptured;
    totalMoves += telemetry.moves;
    totalFinished += telemetry.piecesFinished;
    totalSentToWaiting += telemetry.ownPiecesSentToWaiting;
  }
}

const sorted = [...rounds].sort((a, b) => a - b);
const quantile = (q: number) => {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
  return sorted[index];
};
const average = rounds.length > 0 ? rounds.reduce((sum, value) => sum + value, 0) / rounds.length : null;
const denominator = completed || 1;
const playerDenominator = totalPlayerGames || 1;

const report = {
  label,
  playerCount,
  games,
  seedStart,
  seedEnd: seedStart + games - 1,
  maxRounds,
  weights: { captureReward, onBoardBase },
  completed,
  longGames,
  engineIncomplete,
  averageRound: average,
  p50Round: quantile(0.5),
  p90Round: quantile(0.9),
  over15Games: over15,
  over20Games: over20,
  over30Games: over30,
  over15Rate: over15 / denominator,
  over20Rate: over20 / denominator,
  over30Rate: over30 / denominator,
  averageCapturesPerPlayerGame: totalCaptures / playerDenominator,
  averageMovesPerPlayerGame: totalMoves / playerDenominator,
  averageFinishedPerPlayerGame: totalFinished / playerDenominator,
  averageSentToWaitingPerPlayerGame: totalSentToWaiting / playerDenominator,
};

mkdirSync(outputDir, { recursive: true });
const file = join(outputDir, `${label}-${playerCount}p.json`);
writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

const pct = (value: number) => `${(value * 100).toFixed(2)}%`;
console.log([
  `# Bot Policy Duration Audit — ${label} / ${playerCount}P`,
  "",
  `- games: ${games.toLocaleString()}`,
  `- weights: capture ${captureReward}, on-board ${onBoardBase}`,
  `- completed: ${completed}, long >${maxRounds}R: ${longGames}, engine incomplete: ${engineIncomplete}`,
  `- avg/p50/p90 round: ${average?.toFixed(2) ?? "—"} / ${quantile(0.5) ?? "—"} / ${quantile(0.9) ?? "—"}`,
  `- >15R: ${pct(report.over15Rate)}, >20R: ${pct(report.over20Rate)}, >30R: ${pct(report.over30Rate)}`,
  `- captures/player-game: ${report.averageCapturesPerPlayerGame.toFixed(2)}`,
  `- moves/player-game: ${report.averageMovesPerPlayerGame.toFixed(2)}`,
  `- finishes/player-game: ${report.averageFinishedPerPlayerGame.toFixed(2)}`,
  `- sent-to-waiting/player-game: ${report.averageSentToWaitingPerPlayerGame.toFixed(2)}`,
  "",
].join("\n"));

if (engineIncomplete > 0) process.exitCode = 1;
