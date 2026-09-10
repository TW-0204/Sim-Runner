import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

const threshold = positiveInteger("threshold", argument("threshold"), 4);
const games = positiveInteger("games", argument("games"), 1_000);
const outputDir = argument("output-dir") ?? "s04-threshold-results";
const rulesetId = "two-aug-start-r4-special-slots-v2";

const gamePath = join(process.cwd(), "src/lib/simulation/game.ts");
const effectsPath = join(process.cwd(), "src/lib/augments/effects.ts");
const originalGameSource = readFileSync(gamePath, "utf-8");
const originalEffectsSource = readFileSync(effectsPath, "utf-8");

const selectionBlock = `      const visible = offer.offerIds.slice(0, 3);\n      const selectedId = context.rng.augment.pick(visible);\n      const player = context.engine.players.find((candidate) => candidate.userId === offer.userId);\n      if (!player) throw new Error(\`Missing simulation player \${offer.userId}.\`);`;
const forcedSelectionBlock = `      const visible = offer.offerIds.slice(0, 3);\n      const player = context.engine.players.find((candidate) => candidate.userId === offer.userId);\n      if (!player) throw new Error(\`Missing simulation player \${offer.userId}.\`);\n      const numericSeed = Number(context.seed);\n      const forcedSeat = (Number.isFinite(numericSeed) ? numericSeed : 0) % context.engine.players.length + 1;\n      const shouldForceS04 = eventIndex === 0 && player.seat === forcedSeat;\n      const selectedId = shouldForceS04 ? \"S04\" : context.rng.augment.pick(visible);`;

const immunityLine = `  return (engine.augmentRuntime?.[userId]?.timesCaptured ?? 0) >= 4;`;
const replacementLine = `  return (engine.augmentRuntime?.[userId]?.timesCaptured ?? 0) >= ${threshold};`;
if (!originalGameSource.includes(selectionBlock)) throw new Error("augment-selection block not found");
if (!originalEffectsSource.includes(immunityLine)) throw new Error("S04 immunity threshold line not found");

writeFileSync(gamePath, originalGameSource.replace(selectionBlock, forcedSelectionBlock), "utf-8");
writeFileSync(effectsPath, originalEffectsSource.replace(immunityLine, replacementLine), "utf-8");

type Report = {
  playerCount: 2 | 3 | 4;
  threshold: number;
  validGames: number;
  attempts: number;
  incomplete: number;
  wins: number;
  winRate: number;
  baseline: number;
  deltaPp: number;
  blockedCaptureGames: number;
  blockedCaptureGameRate: number;
  blockedCaptureEvents: number;
  avgBlockedEventsPerGame: number;
  avgRound: number | null;
};
const reports: Report[] = [];

try {
  const [{ getBalanceRuleset }, { simulateGame }] = await Promise.all([
    import("@/lib/simulation/rulesets"),
    import("@/lib/simulation/game"),
  ]);
  const ruleset = getBalanceRuleset(rulesetId);
  for (const playerCount of [2, 3, 4] as const) {
    let validGames = 0;
    let attempts = 0;
    let incomplete = 0;
    let wins = 0;
    let blockedCaptureGames = 0;
    let blockedCaptureEvents = 0;
    let roundSum = 0;
    const maxAttempts = games * 20;
    console.error(`[s04] threshold=${threshold} ${playerCount}p starting`);
    while (validGames < games && attempts < maxAttempts) {
      const seed = attempts;
      const result = simulateGame({ seed: String(seed), ruleset, playerCount, maxActions: 20_000 });
      attempts += 1;
      const forcedSeat = seed % playerCount + 1;
      const forcedUserId = `sim-p${forcedSeat}`;
      const acquisitions = result.acquisitions.filter((item) => item.augmentId === "S04");
      const forced = acquisitions.some((item) => item.userId === forcedUserId && item.acquisitionIndex === 1);
      const duplicateOwner = acquisitions.some((item) => item.userId !== forcedUserId);
      if (!forced || duplicateOwner) continue;
      validGames += 1;
      if (result.status !== "COMPLETED") {
        incomplete += 1;
        continue;
      }
      roundSum += result.round;
      if (result.winnerSeat === forcedSeat) wins += 1;
      const blocks = result.triggerCountsByUser?.[forcedUserId]?.S04 ?? 0;
      if (blocks > 0) blockedCaptureGames += 1;
      blockedCaptureEvents += blocks;
    }
    if (validGames < games) throw new Error(`${playerCount}p only ${validGames}/${games} valid games`);
    const completed = validGames - incomplete;
    const winRate = completed > 0 ? wins / completed : 0;
    const baseline = 1 / playerCount;
    reports.push({
      playerCount,
      threshold,
      validGames,
      attempts,
      incomplete,
      wins,
      winRate,
      baseline,
      deltaPp: (winRate - baseline) * 100,
      blockedCaptureGames,
      blockedCaptureGameRate: completed > 0 ? blockedCaptureGames / completed : 0,
      blockedCaptureEvents,
      avgBlockedEventsPerGame: completed > 0 ? blockedCaptureEvents / completed : 0,
      avgRound: completed > 0 ? roundSum / completed : null,
    });
  }
} finally {
  writeFileSync(gamePath, originalGameSource, "utf-8");
  writeFileSync(effectsPath, originalEffectsSource, "utf-8");
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const md = [
  `# S04 Threshold Precision — ${threshold} captures`,
  "",
  "| Players | Owner win | Baseline | Delta | Games blocking capture | Block events/game | Avg round |",
  "|---:|---:|---:|---:|---:|---:|---:|",
  ...reports.map((r) => `| ${r.playerCount} | ${pct(r.winRate)} | ${pct(r.baseline)} | ${r.deltaPp >= 0 ? "+" : ""}${r.deltaPp.toFixed(2)}%p | ${r.blockedCaptureGames}/${r.validGames} (${pct(r.blockedCaptureGameRate)}) | ${r.avgBlockedEventsPerGame.toFixed(2)} | ${r.avgRound?.toFixed(2) ?? "—"} |`),
  "",
].join("\n");
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, `s04-threshold-${threshold}.json`), `${JSON.stringify({ threshold, reports }, null, 2)}\n`);
writeFileSync(join(outputDir, `s04-threshold-${threshold}.md`), `${md}\n`);
console.log(md);
if (reports.some((r) => r.incomplete > 0)) process.exitCode = 1;
