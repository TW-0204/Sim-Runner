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

const duration = positiveInteger("duration", argument("duration"), 2);
const games = positiveInteger("games", argument("games"), 1_000);
const outputDir = argument("output-dir") ?? "s04-duration-results";
const rulesetId = "two-aug-start-r4-special-slots-v2";

const gamePath = join(process.cwd(), "src/lib/simulation/game.ts");
const effectsPath = join(process.cwd(), "src/lib/augments/effects.ts");
const originalGameSource = readFileSync(gamePath, "utf-8");
const originalEffectsSource = readFileSync(effectsPath, "utf-8");

const selectionBlock = `      const visible = offer.offerIds.slice(0, 3);\n      const selectedId = context.rng.augment.pick(visible);\n      const player = context.engine.players.find((candidate) => candidate.userId === offer.userId);\n      if (!player) throw new Error(\`Missing simulation player \${offer.userId}.\`);`;
const forcedSelectionBlock = `      const visible = offer.offerIds.slice(0, 3);\n      const player = context.engine.players.find((candidate) => candidate.userId === offer.userId);\n      if (!player) throw new Error(\`Missing simulation player \${offer.userId}.\`);\n      const numericSeed = Number(context.seed);\n      const forcedSeat = (Number.isFinite(numericSeed) ? numericSeed : 0) % context.engine.players.length + 1;\n      const shouldForceS04 = eventIndex === 0 && player.seat === forcedSeat;\n      const selectedId = shouldForceS04 ? \"AUG-004\" : context.rng.augment.pick(visible);`;

const immunityBlock = `export function isCaptureImmune(engine: GameEngineState, userId: string, ownedIds: string[]) {\n  if (!has(ownedIds, \"AUG-004\")) return false;\n  return (engine.augmentRuntime?.[userId]?.timesCaptured ?? 0) >= 4;\n}`;
const temporaryImmunityBlock = `export function isCaptureImmune(engine: GameEngineState, userId: string, ownedIds: string[]) {\n  if (!has(ownedIds, \"AUG-004\")) return false;\n  const untilRound = (engine.augmentRuntime?.[userId] as any)?.s04ImmuneUntilRound ?? -1;\n  return engine.round <= untilRound;\n}`;

const captureLine = `  if (has(ownedIds, \"AUG-004\")) runtime.timesCaptured = (runtime.timesCaptured ?? 0) + 1;`;
const temporaryCaptureBlock = `  if (has(ownedIds, \"AUG-004\")) {\n    runtime.timesCaptured = (runtime.timesCaptured ?? 0) + 1;\n    if (runtime.timesCaptured === 4) {\n      (runtime as any).s04ImmuneUntilRound = engine.round + ${duration} - 1;\n    }\n  }`;

if (!originalGameSource.includes(selectionBlock)) throw new Error("augment-selection block not found");
if (!originalEffectsSource.includes(immunityBlock)) throw new Error("AUG-004 immunity block not found");
if (!originalEffectsSource.includes(captureLine)) throw new Error("AUG-004 capture counter line not found");

writeFileSync(gamePath, originalGameSource.replace(selectionBlock, forcedSelectionBlock), "utf-8");
writeFileSync(
  effectsPath,
  originalEffectsSource.replace(immunityBlock, temporaryImmunityBlock).replace(captureLine, temporaryCaptureBlock),
  "utf-8",
);

type Report = {
  playerCount: 2 | 3 | 4;
  durationRounds: number;
  validGames: number;
  attempts: number;
  incomplete: number;
  wins: number;
  winRate: number;
  baseline: number;
  deltaPp: number;
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
    let roundSum = 0;
    const maxAttempts = games * 20;
    console.error(`[s04-duration] ${duration}r ${playerCount}p starting`);
    while (validGames < games && attempts < maxAttempts) {
      const seed = attempts;
      const result = simulateGame({ seed: String(seed), ruleset, playerCount, maxActions: 20_000 });
      attempts += 1;
      const forcedSeat = seed % playerCount + 1;
      const forcedUserId = `sim-p${forcedSeat}`;
      const acquisitions = result.acquisitions.filter((item) => item.augmentId === "AUG-004");
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
    }
    if (validGames < games) throw new Error(`${playerCount}p only ${validGames}/${games} valid games`);
    const completed = validGames - incomplete;
    const winRate = completed > 0 ? wins / completed : 0;
    const baseline = 1 / playerCount;
    reports.push({
      playerCount,
      durationRounds: duration,
      validGames,
      attempts,
      incomplete,
      wins,
      winRate,
      baseline,
      deltaPp: (winRate - baseline) * 100,
      avgRound: completed > 0 ? roundSum / completed : null,
    });
  }
} finally {
  writeFileSync(gamePath, originalGameSource, "utf-8");
  writeFileSync(effectsPath, originalEffectsSource, "utf-8");
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const md = [
  `# AUG-004 Temporary Immunity — ${duration} round(s)`,
  "",
  "Rule: after the 4th capture against the owner, AUG-004 grants global capture immunity for a limited number of rounds instead of permanently.",
  "",
  "| Players | Owner win | Baseline | Delta | Avg round |",
  "|---:|---:|---:|---:|---:|",
  ...reports.map((r) => `| ${r.playerCount} | ${pct(r.winRate)} | ${pct(r.baseline)} | ${r.deltaPp >= 0 ? "+" : ""}${r.deltaPp.toFixed(2)}%p | ${r.avgRound?.toFixed(2) ?? "—"} |`),
  "",
].join("\n");
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, `s04-duration-${duration}.json`), `${JSON.stringify({ duration, reports }, null, 2)}\n`);
writeFileSync(join(outputDir, `s04-duration-${duration}.md`), `${md}\n`);
console.log(md);
if (reports.some((r) => r.incomplete > 0)) process.exitCode = 1;
