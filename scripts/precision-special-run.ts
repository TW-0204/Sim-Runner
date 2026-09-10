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

const augmentId = argument("augment") ?? "P04";
const games = positiveInteger("games", argument("games"), 1_000);
const outputDir = argument("output-dir") ?? "precision-results";
const acquisitionIndex = augmentId === "P02" ? 2 : 1;
const expectedCondition: Record<string, string> = {
  P02: "MOONWALK",
  P04: "CENTER_STACK",
  P14: "SOLO_RUN",
  P16: "HUNT",
};

if (!expectedCondition[augmentId]) {
  throw new Error(`Unsupported Special augment: ${augmentId}. Use P02, P04, P14, or P16.`);
}

const gamePath = join(process.cwd(), "src/lib/simulation/game.ts");
const originalGameSource = readFileSync(gamePath, "utf-8");
const selectionBlock = `      const visible = offer.offerIds.slice(0, 3);\n      const selectedId = context.rng.augment.pick(visible);\n      const player = context.engine.players.find((candidate) => candidate.userId === offer.userId);\n      if (!player) throw new Error(\`Missing simulation player \${offer.userId}.\`);`;
const forcedSelectionBlock = `      const visible = offer.offerIds.slice(0, 3);\n      const player = context.engine.players.find((candidate) => candidate.userId === offer.userId);\n      if (!player) throw new Error(\`Missing simulation player \${offer.userId}.\`);\n      const forcedAugmentId = process.env.SIM_FORCED_AUGMENT_ID;\n      const forcedAcquisitionIndex = Number(process.env.SIM_FORCED_ACQUISITION_INDEX ?? \"1\");\n      const numericSeed = Number(context.seed);\n      const forcedSeat = (Number.isFinite(numericSeed) ? numericSeed : 0) % context.engine.players.length + 1;\n      const shouldForce = Boolean(forcedAugmentId) && eventIndex + 1 === forcedAcquisitionIndex && player.seat === forcedSeat;\n      const selectedId = shouldForce ? forcedAugmentId! : context.rng.augment.pick(visible);`;

if (!originalGameSource.includes(selectionBlock)) {
  throw new Error("Could not locate the simulation augment-selection block. Precision injection aborted.");
}

process.env.SIM_FORCED_AUGMENT_ID = augmentId;
process.env.SIM_FORCED_ACQUISITION_INDEX = String(acquisitionIndex);
writeFileSync(gamePath, originalGameSource.replace(selectionBlock, forcedSelectionBlock), "utf-8");

type PlayerCount = 2 | 3 | 4;
type PlayerReport = {
  playerCount: PlayerCount;
  requestedGames: number;
  attempts: number;
  discardedContexts: number;
  completedGames: number;
  incompleteGames: number;
  wins: number;
  ownerWinRate: number;
  expectedSpecialWins: number;
  expectedSpecialWinRate: number;
  averageRound: number | null;
  baselineWinRate: number;
  deltaPp: number;
};

const specialIds = new Set(["P02", "P03", "P04", "P14", "P16"]);
const reports: PlayerReport[] = [];
const startedAt = Date.now();

try {
  const [{ getBalanceRuleset }, { simulateGame }] = await Promise.all([
    import("@/lib/simulation/rulesets"),
    import("@/lib/simulation/game"),
  ]);
  const ruleset = getBalanceRuleset("two-aug-start-r4-special-slots-v2");

  for (const playerCount of [2, 3, 4] as const) {
    let validGames = 0;
    let attempts = 0;
    let completedGames = 0;
    let incompleteGames = 0;
    let wins = 0;
    let expectedSpecialWins = 0;
    let roundSum = 0;
    const maxAttempts = games * 20;

    console.error(`[precision] ${augmentId} ${playerCount}p starting: ${games} valid forced-owner games`);
    while (validGames < games && attempts < maxAttempts) {
      const seed = attempts;
      const result = simulateGame({
        seed: String(seed),
        ruleset,
        playerCount,
        maxActions: 20_000,
      });
      attempts += 1;

      const forcedSeat = seed % playerCount + 1;
      const forcedUserId = `sim-p${forcedSeat}`;
      const targetAcquisitions = result.acquisitions.filter((item) => item.augmentId === augmentId);
      const forcedAcquisition = targetAcquisitions.some((item) => (
        item.userId === forcedUserId && item.acquisitionIndex === acquisitionIndex
      ));
      const duplicateTargetOwner = targetAcquisitions.some((item) => item.userId !== forcedUserId);
      const earlierSpecialForForcedOwner = result.acquisitions.some((item) => (
        item.userId === forcedUserId
        && item.acquisitionIndex < acquisitionIndex
        && specialIds.has(item.augmentId)
      ));

      if (!forcedAcquisition || duplicateTargetOwner || earlierSpecialForForcedOwner) continue;

      validGames += 1;
      if (result.status !== "COMPLETED") {
        incompleteGames += 1;
        continue;
      }
      completedGames += 1;
      roundSum += result.round;
      if (result.winnerSeat === forcedSeat) wins += 1;
      if (result.winnerSeat === forcedSeat && result.winnerCondition === expectedCondition[augmentId]) {
        expectedSpecialWins += 1;
      }
    }

    if (validGames < games) {
      throw new Error(`${augmentId} ${playerCount}p only produced ${validGames}/${games} valid contexts after ${attempts} attempts.`);
    }

    const ownerWinRate = completedGames > 0 ? wins / completedGames : 0;
    const baselineWinRate = 1 / playerCount;
    reports.push({
      playerCount,
      requestedGames: games,
      attempts,
      discardedContexts: attempts - validGames,
      completedGames,
      incompleteGames,
      wins,
      ownerWinRate,
      expectedSpecialWins,
      expectedSpecialWinRate: completedGames > 0 ? expectedSpecialWins / completedGames : 0,
      averageRound: completedGames > 0 ? roundSum / completedGames : null,
      baselineWinRate,
      deltaPp: (ownerWinRate - baselineWinRate) * 100,
    });
    console.error(`[precision] ${augmentId} ${playerCount}p complete: owner ${(ownerWinRate * 100).toFixed(2)}%, incomplete ${incompleteGames}`);
  }
} finally {
  writeFileSync(gamePath, originalGameSource, "utf-8");
  delete process.env.SIM_FORCED_AUGMENT_ID;
  delete process.env.SIM_FORCED_ACQUISITION_INDEX;
}

const report = {
  augmentId,
  acquisitionIndex,
  expectedCondition: expectedCondition[augmentId],
  rulesetId: "two-aug-start-r4-special-slots-v2",
  gamesPerPlayerCount: games,
  totalValidGames: games * 3,
  generatedAt: new Date().toISOString(),
  elapsedSeconds: (Date.now() - startedAt) / 1000,
  reports,
};

const pct = (value: number) => `${(value * 100).toFixed(2)}%`;
const pp = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%p`;
const markdown = [
  `# Special Precision — ${augmentId}`,
  "",
  `- ruleset: ${report.rulesetId}`,
  `- forced acquisition index: ${acquisitionIndex}`,
  `- expected special win condition: ${report.expectedCondition}`,
  `- valid games: ${games.toLocaleString()} per player count, ${(games * 3).toLocaleString()} total`,
  "- forced owner seat rotates every seed to reduce seat bias",
  "- games with another owner of the same target Special or an earlier Special on the forced P02 owner are discarded",
  "",
  "| Players | Owner win | Baseline | Delta | Special-condition wins | Avg round | Incomplete | Discarded contexts |",
  "|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...reports.map((item) => `| ${item.playerCount} | ${pct(item.ownerWinRate)} | ${pct(item.baselineWinRate)} | ${pp(item.deltaPp)} | ${item.expectedSpecialWins}/${item.completedGames} (${pct(item.expectedSpecialWinRate)}) | ${item.averageRound?.toFixed(2) ?? "—"} | ${item.incompleteGames} | ${item.discardedContexts} |`),
  "",
].join("\n");

mkdirSync(outputDir, { recursive: true });
const baseName = `precision-${augmentId}-${games}`;
writeFileSync(join(outputDir, `${baseName}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
writeFileSync(join(outputDir, `${baseName}.md`), `${markdown}\n`, "utf-8");
console.log(markdown);
console.error(`[precision] ${augmentId} total elapsed ${(report.elapsedSeconds).toFixed(1)}s`);

if (reports.some((item) => item.incompleteGames > 0)) process.exitCode = 1;
