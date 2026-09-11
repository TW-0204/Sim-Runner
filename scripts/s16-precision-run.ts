import { mkdirSync, writeFileSync } from "node:fs";
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

const games = positiveInteger("games", argument("games"), 1_000);
const outputDir = argument("output-dir") ?? "precision-results/s16";
const augmentId = "AUG-016";
const acquisitionIndex = 1;
const rulesetId = "two-aug-start-r4-special-slots-v2";

type PlayerCount = 2 | 3 | 4;
type IncompleteDetail = {
  seed: string;
  forcedSeat: number;
  forcedUserId: string;
  status: string;
  error: string | null;
  round: number;
  turnNumber: number;
  actions: number;
  acquisitions: unknown;
  failureDiagnostics: unknown;
};
type PlayerReport = {
  playerCount: PlayerCount;
  requestedGames: number;
  attempts: number;
  discardedContexts: number;
  completedGames: number;
  incompleteGames: number;
  incompleteDetails: IncompleteDetail[];
  wins: number;
  ownerWinRate: number;
  baselineWinRate: number;
  deltaPp: number;
  totalBasicRolls: number;
  totalNak: number;
  actualNakRate: number;
  averageNakPerGame: number;
  ownerBasicRolls: number;
  ownerNak: number;
  ownerNakRate: number;
  averageOwnerNakPerGame: number;
  nonOwnerBasicRolls: number;
  nonOwnerNak: number;
  nonOwnerNakRate: number;
  averageNakPerNonOwnerPlayerGame: number;
  gamesWithNoNak: number;
  gamesWithThreeOrMoreNak: number;
};

const reports: PlayerReport[] = [];
const startedAt = Date.now();

{
  const [{ getBalanceRuleset }, { simulateGame }] = await Promise.all([
    import("@/lib/simulation/rulesets"),
    import("@/lib/simulation/game"),
  ]);
  const ruleset = getBalanceRuleset(rulesetId);

  for (const playerCount of [2, 3, 4] as const) {
    let validGames = 0;
    let attempts = 0;
    let completedGames = 0;
    let incompleteGames = 0;
    const incompleteDetails: IncompleteDetail[] = [];
    let wins = 0;
    let totalBasicRolls = 0;
    let totalNak = 0;
    let ownerBasicRolls = 0;
    let ownerNak = 0;
    let nonOwnerBasicRolls = 0;
    let nonOwnerNak = 0;
    let gamesWithNoNak = 0;
    let gamesWithThreeOrMoreNak = 0;
    const maxAttempts = games * 20;

    console.error(`[s16-precision] ${playerCount}p starting: ${games} valid forced-owner games`);
    while (validGames < games && attempts < maxAttempts) {
      const seed = attempts;
      const result = simulateGame({
        seed: String(seed),
        ruleset,
        playerCount,
        maxActions: 20_000,
        forcedAugmentId: augmentId,
        forcedAcquisitionIndex: acquisitionIndex,
      });
      attempts += 1;

      const forcedSeat = seed % playerCount + 1;
      const forcedUserId = `sim-p${forcedSeat}`;
      const targetAcquisitions = result.acquisitions.filter((item) => item.augmentId === augmentId);
      const forcedAcquisition = targetAcquisitions.some((item) => (
        item.userId === forcedUserId && item.acquisitionIndex === acquisitionIndex
      ));
      const duplicateTargetOwner = targetAcquisitions.some((item) => item.userId !== forcedUserId);
      if (!forcedAcquisition || duplicateTargetOwner) continue;

      validGames += 1;
      if (result.status !== "COMPLETED") {
        incompleteGames += 1;
        const detail: IncompleteDetail = {
          seed: result.seed,
          forcedSeat,
          forcedUserId,
          status: result.status,
          error: result.error ?? null,
          round: result.round,
          turnNumber: result.turnNumber,
          actions: result.actions,
          acquisitions: result.acquisitions,
          failureDiagnostics: result.failureDiagnostics ?? null,
        };
        incompleteDetails.push(detail);
        console.error(`[s16-precision] incomplete ${playerCount}p seed ${detail.seed}: ${detail.status} · round ${detail.round} · turn ${detail.turnNumber} · actions ${detail.actions}${detail.error ? ` · ${detail.error}` : ""}`);
        continue;
      }

      completedGames += 1;
      if (result.winnerSeat === forcedSeat) wins += 1;

      const telemetry = result.s16Telemetry;
      if (!telemetry) throw new Error("AUG-016 telemetry missing from simulation result.");
      let gameNak = 0;
      for (let seat = 1; seat <= playerCount; seat += 1) {
        const userId = `sim-p${seat}`;
        const basic = telemetry.basicRollsByUser[userId] ?? 0;
        const nak = telemetry.nakByUser[userId] ?? 0;
        totalBasicRolls += basic;
        totalNak += nak;
        gameNak += nak;
        if (seat === forcedSeat) {
          ownerBasicRolls += basic;
          ownerNak += nak;
        } else {
          nonOwnerBasicRolls += basic;
          nonOwnerNak += nak;
        }
      }
      if (gameNak === 0) gamesWithNoNak += 1;
      if (gameNak >= 3) gamesWithThreeOrMoreNak += 1;
    }

    if (validGames < games) {
      throw new Error(`AUG-016 ${playerCount}p only produced ${validGames}/${games} valid contexts after ${attempts} attempts.`);
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
      incompleteDetails,
      wins,
      ownerWinRate,
      baselineWinRate,
      deltaPp: (ownerWinRate - baselineWinRate) * 100,
      totalBasicRolls,
      totalNak,
      actualNakRate: totalBasicRolls > 0 ? totalNak / totalBasicRolls : 0,
      averageNakPerGame: completedGames > 0 ? totalNak / completedGames : 0,
      ownerBasicRolls,
      ownerNak,
      ownerNakRate: ownerBasicRolls > 0 ? ownerNak / ownerBasicRolls : 0,
      averageOwnerNakPerGame: completedGames > 0 ? ownerNak / completedGames : 0,
      nonOwnerBasicRolls,
      nonOwnerNak,
      nonOwnerNakRate: nonOwnerBasicRolls > 0 ? nonOwnerNak / nonOwnerBasicRolls : 0,
      averageNakPerNonOwnerPlayerGame: completedGames > 0 ? nonOwnerNak / (completedGames * (playerCount - 1)) : 0,
      gamesWithNoNak,
      gamesWithThreeOrMoreNak,
    });
    console.error(`[s16-precision] ${playerCount}p complete: owner ${(ownerWinRate * 100).toFixed(2)}%, nak ${totalNak}/${totalBasicRolls}`);
  }
}

const allIncompleteDetails = reports.flatMap((item) => (
  item.incompleteDetails.map((detail) => ({ playerCount: item.playerCount, ...detail }))
));
const report = {
  augmentId,
  acquisitionIndex,
  rulesetId,
  gamesPerPlayerCount: games,
  totalValidGames: games * 3,
  generatedAt: new Date().toISOString(),
  elapsedSeconds: (Date.now() - startedAt) / 1000,
  incompleteDetails: allIncompleteDetails,
  reports,
};

const pct = (value: number) => `${(value * 100).toFixed(2)}%`;
const pp = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%p`;
const incompleteMarkdown = allIncompleteDetails.length > 0
  ? allIncompleteDetails.map((item) => (
      `- ${item.playerCount}P seed ${item.seed}: ${item.status} · round ${item.round} · turn ${item.turnNumber} · actions ${item.actions}${item.error ? ` · ${item.error}` : ""}`
    ))
  : ["- none"];
const markdown = [
  "# AUG-016 Nak Precision",
  "",
  `- ruleset: ${rulesetId}`,
  `- AUG-016 forced at acquisition index ${acquisitionIndex}`,
  `- valid games: ${games.toLocaleString()} per player count, ${(games * 3).toLocaleString()} total`,
  "- forced owner seat rotates every seed to reduce seat bias",
  "- games with another AUG-016 owner are discarded",
  "- Nak denominator counts BASIC rolls only while AUG-016 is active",
  "",
  "| Players | Owner win | Baseline | Delta | Actual Nak rate | Nak / game | Owner Nak / game | Non-owner Nak / player-game | No-Nak games | 3+ Nak games | Incomplete | Discarded |",
  "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...reports.map((item) => `| ${item.playerCount} | ${pct(item.ownerWinRate)} | ${pct(item.baselineWinRate)} | ${pp(item.deltaPp)} | ${item.totalNak}/${item.totalBasicRolls} (${pct(item.actualNakRate)}) | ${item.averageNakPerGame.toFixed(3)} | ${item.averageOwnerNakPerGame.toFixed(3)} | ${item.averageNakPerNonOwnerPlayerGame.toFixed(3)} | ${item.gamesWithNoNak}/${item.completedGames} (${pct(item.completedGames > 0 ? item.gamesWithNoNak / item.completedGames : 0)}) | ${item.gamesWithThreeOrMoreNak}/${item.completedGames} (${pct(item.completedGames > 0 ? item.gamesWithThreeOrMoreNak / item.completedGames : 0)}) | ${item.incompleteGames} | ${item.discardedContexts} |`),
  "",
  "## Owner vs non-owner Nak rate",
  "",
  "| Players | Owner | Non-owner |",
  "|---:|---:|---:|",
  ...reports.map((item) => `| ${item.playerCount} | ${item.ownerNak}/${item.ownerBasicRolls} (${pct(item.ownerNakRate)}) | ${item.nonOwnerNak}/${item.nonOwnerBasicRolls} (${pct(item.nonOwnerNakRate)}) |`),
  "",
  "## Incomplete seeds",
  "",
  ...incompleteMarkdown,
  "",
].join("\n");

mkdirSync(outputDir, { recursive: true });
const baseName = `s16-precision-${games}`;
writeFileSync(join(outputDir, `${baseName}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
writeFileSync(join(outputDir, `${baseName}.md`), `${markdown}\n`, "utf-8");
console.log(markdown);
console.error(`[s16-precision] total elapsed ${report.elapsedSeconds.toFixed(1)}s`);
if (allIncompleteDetails.length > 0) {
  console.error(`[s16-precision] incomplete seeds: ${allIncompleteDetails.map((item) => `${item.playerCount}p:${item.seed}`).join(", ")}`);
}

if (reports.some((item) => item.incompleteGames > 0)) process.exitCode = 1;
