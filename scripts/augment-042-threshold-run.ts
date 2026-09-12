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

function parseTargets(raw: string | undefined): [number, number, number] {
  if (!raw) throw new Error("--targets is required, e.g. 7,11,14");
  const values = raw.split(",").map((value) => Number(value.trim()));
  if (values.length !== 3 || values.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new Error("--targets must contain three positive integers for 2p,3p,4p.");
  }
  return [values[0]!, values[1]!, values[2]!];
}

const games = positiveInteger("games", argument("games"), 1_000);
const targets = parseTargets(argument("targets"));
const outputDir = argument("output-dir") ?? "p16-threshold-results";
const rulesetId = "two-aug-start-r4-special-slots-v2";

const gamePath = join(process.cwd(), "src/lib/simulation/game.ts");
const effectsPath = join(process.cwd(), "src/lib/augments/effects.ts");
const originalGameSource = readFileSync(gamePath, "utf-8");
const originalEffectsSource = readFileSync(effectsPath, "utf-8");

const selectionBlock = `      const visible = offer.offerIds.slice(0, 3);\n      const selectedId = context.rng.augment.pick(visible);\n      const player = context.engine.players.find((candidate) => candidate.userId === offer.userId);\n      if (!player) throw new Error(\`Missing simulation player \${offer.userId}.\`);`;
const forcedSelectionBlock = `      const visible = offer.offerIds.slice(0, 3);\n      const player = context.engine.players.find((candidate) => candidate.userId === offer.userId);\n      if (!player) throw new Error(\`Missing simulation player \${offer.userId}.\`);\n      const numericSeed = Number(context.seed);\n      const forcedSeat = (Number.isFinite(numericSeed) ? numericSeed : 0) % context.engine.players.length + 1;\n      const shouldForceP16 = eventIndex === 0 && player.seat === forcedSeat;\n      const selectedId = shouldForceP16 ? \"AUG-042\" : context.rng.augment.pick(visible);`;

const targetBlock = `export function huntCaptureTarget(playerCount: number) {\n  return 4 + playerCount;\n}`;
const replacementTargetBlock = `export function huntCaptureTarget(playerCount: number) {\n  if (playerCount === 2) return ${targets[0]};\n  if (playerCount === 3) return ${targets[1]};\n  if (playerCount === 4) return ${targets[2]};\n  return ${targets[2]};\n}`;

if (!originalGameSource.includes(selectionBlock)) {
  throw new Error("Could not locate augment-selection block. AUG-042 threshold experiment aborted.");
}
if (!originalEffectsSource.includes(targetBlock)) {
  throw new Error("Could not locate huntCaptureTarget block. AUG-042 threshold experiment aborted.");
}

writeFileSync(gamePath, originalGameSource.replace(selectionBlock, forcedSelectionBlock), "utf-8");
writeFileSync(effectsPath, originalEffectsSource.replace(targetBlock, replacementTargetBlock), "utf-8");

type PlayerCount = 2 | 3 | 4;
type PlayerReport = {
  playerCount: PlayerCount;
  targetCaptures: number;
  requestedGames: number;
  attempts: number;
  discardedContexts: number;
  completedGames: number;
  incompleteGames: number;
  ownerWins: number;
  ownerWinRate: number;
  huntWins: number;
  huntWinRate: number;
  baselineWinRate: number;
  deltaPp: number;
  averageRound: number | null;
};

const reports: PlayerReport[] = [];
const startedAt = Date.now();

try {
  const [{ getBalanceRuleset }, { simulateGame }] = await Promise.all([
    import("@/lib/simulation/rulesets"),
    import("@/lib/simulation/game"),
  ]);
  const ruleset = getBalanceRuleset(rulesetId);

  for (const playerCount of [2, 3, 4] as const) {
    const targetCaptures = targets[playerCount - 2];
    let validGames = 0;
    let attempts = 0;
    let completedGames = 0;
    let incompleteGames = 0;
    let ownerWins = 0;
    let huntWins = 0;
    let roundSum = 0;
    const maxAttempts = games * 20;

    console.error(`[p16-grid] ${playerCount}p target=${targetCaptures}, need ${games} valid games`);
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
      const p16Acquisitions = result.acquisitions.filter((item) => item.augmentId === "AUG-042");
      const forcedAcquisition = p16Acquisitions.some((item) => item.userId === forcedUserId && item.acquisitionIndex === 1);
      const duplicateP16Owner = p16Acquisitions.some((item) => item.userId !== forcedUserId);
      if (!forcedAcquisition || duplicateP16Owner) continue;

      validGames += 1;
      if (result.status !== "COMPLETED") {
        incompleteGames += 1;
        continue;
      }
      completedGames += 1;
      roundSum += result.round;
      if (result.winnerSeat === forcedSeat) ownerWins += 1;
      if (result.winnerSeat === forcedSeat && result.winnerCondition === "HUNT") huntWins += 1;
    }

    if (validGames < games) {
      throw new Error(`${playerCount}p only produced ${validGames}/${games} valid contexts after ${attempts} attempts.`);
    }

    const ownerWinRate = completedGames > 0 ? ownerWins / completedGames : 0;
    const baselineWinRate = 1 / playerCount;
    reports.push({
      playerCount,
      targetCaptures,
      requestedGames: games,
      attempts,
      discardedContexts: attempts - validGames,
      completedGames,
      incompleteGames,
      ownerWins,
      ownerWinRate,
      huntWins,
      huntWinRate: completedGames > 0 ? huntWins / completedGames : 0,
      baselineWinRate,
      deltaPp: (ownerWinRate - baselineWinRate) * 100,
      averageRound: completedGames > 0 ? roundSum / completedGames : null,
    });
    console.error(`[p16-grid] ${playerCount}p target=${targetCaptures}: owner ${(ownerWinRate * 100).toFixed(2)}%, incomplete ${incompleteGames}`);
  }
} finally {
  writeFileSync(gamePath, originalGameSource, "utf-8");
  writeFileSync(effectsPath, originalEffectsSource, "utf-8");
}

const report = {
  augmentId: "AUG-042",
  targets: { 2: targets[0], 3: targets[1], 4: targets[2] },
  rulesetId,
  gamesPerPlayerCount: games,
  totalValidGames: games * 3,
  generatedAt: new Date().toISOString(),
  elapsedSeconds: (Date.now() - startedAt) / 1000,
  reports,
};

const pct = (value: number) => `${(value * 100).toFixed(2)}%`;
const pp = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%p`;
const markdown = [
  `# AUG-042 Threshold Precision — ${targets.join("/")}`,
  "",
  `- ruleset: ${rulesetId}`,
  `- capture targets: 2p=${targets[0]}, 3p=${targets[1]}, 4p=${targets[2]}`,
  `- valid games: ${games.toLocaleString()} per player count, ${(games * 3).toLocaleString()} total`,
  "- AUG-042 owner seat rotates every seed",
  "- contexts with another AUG-042 owner are discarded",
  "- source files are patched only inside the runner checkout and restored before exit",
  "",
  "| Players | Target | Owner win | Baseline | Delta | HUNT wins | Avg round | Incomplete | Discarded |",
  "|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...reports.map((item) => `| ${item.playerCount} | ${item.targetCaptures} | ${pct(item.ownerWinRate)} | ${pct(item.baselineWinRate)} | ${pp(item.deltaPp)} | ${item.huntWins}/${item.completedGames} (${pct(item.huntWinRate)}) | ${item.averageRound?.toFixed(2) ?? "—"} | ${item.incompleteGames} | ${item.discardedContexts} |`),
  "",
].join("\n");

mkdirSync(outputDir, { recursive: true });
const baseName = `p16-${targets.join("-")}-${games}`;
writeFileSync(join(outputDir, `${baseName}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
writeFileSync(join(outputDir, `${baseName}.md`), `${markdown}\n`, "utf-8");
console.log(markdown);
console.error(`[p16-grid] elapsed ${report.elapsedSeconds.toFixed(1)}s`);

if (reports.some((item) => item.incompleteGames > 0)) process.exitCode = 1;
