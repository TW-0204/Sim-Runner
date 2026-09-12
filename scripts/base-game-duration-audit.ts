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
const seedStart = positiveInteger("seed-start", argument("seed-start"), 1_700_000);
const outputDir = argument("output-dir") ?? "base-game-results";
const base = getBalanceRuleset("two-aug-start-r4-special-slots-v2");
const ruleset = { ...base, augmentEvents: [] };

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
let totalPlayerGames = 0;

for (let index = 0; index < games; index += 1) {
  const result = simulateGame({
    seed: String(seedStart + index),
    ruleset,
    playerCount,
    maxActions: 50_000,
    maxRounds: 100,
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
  }
}

const sorted = [...rounds].sort((a, b) => a - b);
const q = (fraction: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] : null;
const averageRound = rounds.length ? rounds.reduce((sum, value) => sum + value, 0) / rounds.length : null;
const report = {
  playerCount,
  games,
  completed,
  longGames,
  engineIncomplete,
  averageRound,
  p50Round: q(0.5),
  p90Round: q(0.9),
  over15Rate: over15 / Math.max(1, completed),
  over20Rate: over20 / Math.max(1, completed),
  over30Rate: over30 / Math.max(1, completed),
  averageCapturesPerPlayerGame: totalCaptures / Math.max(1, totalPlayerGames),
  averageMovesPerPlayerGame: totalMoves / Math.max(1, totalPlayerGames),
  averageFinishedPerPlayerGame: totalFinished / Math.max(1, totalPlayerGames),
};

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, `no-augment-${playerCount}p.json`), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
console.log(`# No-Augment Base Game — ${playerCount}P\n\n${JSON.stringify(report, null, 2)}`);
if (engineIncomplete > 0) process.exitCode = 1;
