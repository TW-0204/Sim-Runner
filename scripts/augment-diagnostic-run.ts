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

function hashId(value: string) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

const augmentId = argument("augment");
if (!augmentId) throw new Error("--augment is required.");
const games = positiveInteger("games", argument("games"), 500);
const maxRounds = positiveInteger("max-rounds", argument("max-rounds"), 60);
const outputDir = argument("output-dir") ?? "augment-diagnostic-results";

const [{ AUGMENTS, AUGMENT_BY_ID }, { getBalanceRuleset }, { simulateGame }] = await Promise.all([
  import("@/lib/augments/catalog"),
  import("@/lib/simulation/rulesets"),
  import("@/lib/simulation/game"),
]);

const target = AUGMENT_BY_ID.get(augmentId);
if (!target) throw new Error(`Unknown active augment: ${augmentId}`);
const specialIds = new Set(AUGMENTS.filter((item) => item.special).map((item) => item.id));
const acquisitionIndexes = target.timing === "last" ? [2]
  : target.timing === "first" || target.timing === "not-last" ? [1]
  : [1, 2];
const ruleset = getBalanceRuleset("two-aug-start-r4-special-slots-v2");

type Perf = { rolls: number; moves: number; enemyPiecesCaptured: number; ownPiecesSentToWaiting: number; piecesFinished: number };
const zeroPerf = (): Perf => ({ rolls: 0, moves: 0, enemyPiecesCaptured: 0, ownPiecesSentToWaiting: 0, piecesFinished: 0 });
const addPerf = (targetPerf: Perf, source: Perf | undefined) => {
  if (!source) return;
  targetPerf.rolls += source.rolls;
  targetPerf.moves += source.moves;
  targetPerf.enemyPiecesCaptured += source.enemyPiecesCaptured;
  targetPerf.ownPiecesSentToWaiting += source.ownPiecesSentToWaiting;
  targetPerf.piecesFinished += source.piecesFinished;
};
const dividePerf = (perf: Perf, denominator: number): Perf => denominator ? ({
  rolls: perf.rolls / denominator,
  moves: perf.moves / denominator,
  enemyPiecesCaptured: perf.enemyPiecesCaptured / denominator,
  ownPiecesSentToWaiting: perf.ownPiecesSentToWaiting / denominator,
  piecesFinished: perf.piecesFinished / denominator,
}) : zeroPerf();

const reports = [] as Array<Record<string, unknown>>;
const startedAt = Date.now();

for (const acquisitionIndex of acquisitionIndexes) {
  for (const playerCount of [2, 3, 4] as const) {
    let validPairs = 0;
    let attempts = 0;
    let treatmentWins = 0;
    let controlWins = 0;
    let treatmentCompleted = 0;
    let controlCompleted = 0;
    let treatmentOver15 = 0;
    let controlOver15 = 0;
    let treatmentOver20 = 0;
    let controlOver20 = 0;
    let treatmentLong = 0;
    let controlLong = 0;
    let winGainPairs = 0;
    let winLossPairs = 0;
    let treatmentRoundSum = 0;
    let controlRoundSum = 0;
    let triggerSum = 0;
    const treatmentPerf = zeroPerf();
    const controlPerf = zeroPerf();
    const triggerBuckets: Record<string, { games: number; wins: number }> = {
      "0": { games: 0, wins: 0 },
      "1": { games: 0, wins: 0 },
      "2-3": { games: 0, wins: 0 },
      "4+": { games: 0, wins: 0 },
    };
    const maxAttempts = games * 100;
    const seedBase = 8_000_000 + (hashId(augmentId) % 500_000) + acquisitionIndex * 1_000_000 + playerCount * 100_000;

    while (validPairs < games && attempts < maxAttempts) {
      const seedNumber = seedBase + attempts;
      const seed = String(seedNumber);
      attempts += 1;
      const treatment = simulateGame({
        seed,
        ruleset,
        playerCount,
        maxActions: 100_000,
        maxRounds,
        forcedAugmentId: augmentId,
        forcedAcquisitionIndex: acquisitionIndex,
        preserveSelectionRng: true,
      });
      const forcedSeat = seedNumber % playerCount + 1;
      const forcedUserId = `sim-p${forcedSeat}`;
      const targetAcquisitions = treatment.acquisitions.filter((item) => item.augmentId === augmentId);
      const forcedAcquisition = targetAcquisitions.some((item) => item.userId === forcedUserId && item.acquisitionIndex === acquisitionIndex);
      const duplicateTarget = targetAcquisitions.some((item) => item.userId !== forcedUserId || item.acquisitionIndex !== acquisitionIndex);
      const earlier = treatment.acquisitions.filter((item) => item.userId === forcedUserId && item.acquisitionIndex < acquisitionIndex);
      const earlierSpecial = earlier.some((item) => specialIds.has(item.augmentId));
      const earlierConflict = earlier.some((item) => {
        const previous = AUGMENT_BY_ID.get(item.augmentId);
        return (target.conflicts ?? []).includes(item.augmentId) || (previous?.conflicts ?? []).includes(augmentId);
      });
      if (!forcedAcquisition || duplicateTarget || earlierSpecial || earlierConflict) continue;

      const control = simulateGame({
        seed,
        ruleset,
        playerCount,
        maxActions: 100_000,
        maxRounds,
      });
      validPairs += 1;

      const treatmentWon = treatment.status === "COMPLETED" && treatment.winnerSeat === forcedSeat;
      const controlWon = control.status === "COMPLETED" && control.winnerSeat === forcedSeat;
      if (treatmentWon) treatmentWins += 1;
      if (controlWon) controlWins += 1;
      if (treatmentWon && !controlWon) winGainPairs += 1;
      if (!treatmentWon && controlWon) winLossPairs += 1;

      if (treatment.status === "COMPLETED") {
        treatmentCompleted += 1;
        treatmentRoundSum += treatment.round;
      }
      if (control.status === "COMPLETED") {
        controlCompleted += 1;
        controlRoundSum += control.round;
      }
      if (treatment.status === "LONG_GAME") treatmentLong += 1;
      if (control.status === "LONG_GAME") controlLong += 1;
      if (treatment.status === "LONG_GAME" || treatment.round > 15) treatmentOver15 += 1;
      if (control.status === "LONG_GAME" || control.round > 15) controlOver15 += 1;
      if (treatment.status === "LONG_GAME" || treatment.round > 20) treatmentOver20 += 1;
      if (control.status === "LONG_GAME" || control.round > 20) controlOver20 += 1;

      const triggers = treatment.triggerCountsByUser?.[forcedUserId]?.[augmentId] ?? 0;
      triggerSum += triggers;
      const bucket = triggers === 0 ? "0" : triggers === 1 ? "1" : triggers <= 3 ? "2-3" : "4+";
      triggerBuckets[bucket].games += 1;
      if (treatmentWon) triggerBuckets[bucket].wins += 1;

      addPerf(treatmentPerf, treatment.performanceByUser?.[forcedUserId]);
      addPerf(controlPerf, control.performanceByUser?.[forcedUserId]);
    }

    if (validPairs < games) throw new Error(`${augmentId} slot${acquisitionIndex} ${playerCount}p only produced ${validPairs}/${games} valid pairs.`);
    const treatmentWinRate = treatmentWins / validPairs;
    const controlWinRate = controlWins / validPairs;
    const treatmentPerfAvg = dividePerf(treatmentPerf, validPairs);
    const controlPerfAvg = dividePerf(controlPerf, validPairs);
    const perfDelta = Object.fromEntries(Object.keys(treatmentPerfAvg).map((key) => [key, treatmentPerfAvg[key as keyof Perf] - controlPerfAvg[key as keyof Perf]]));

    reports.push({
      acquisitionIndex,
      playerCount,
      validPairs,
      attempts,
      treatmentWinRate,
      controlWinRate,
      pairedWinDeltaPp: (treatmentWinRate - controlWinRate) * 100,
      winGainPairs,
      winLossPairs,
      treatmentCompleted,
      controlCompleted,
      treatmentAverageRound: treatmentCompleted ? treatmentRoundSum / treatmentCompleted : null,
      controlAverageRound: controlCompleted ? controlRoundSum / controlCompleted : null,
      averageRoundDelta: treatmentCompleted && controlCompleted ? treatmentRoundSum / treatmentCompleted - controlRoundSum / controlCompleted : null,
      treatmentOver15Rate: treatmentOver15 / validPairs,
      controlOver15Rate: controlOver15 / validPairs,
      treatmentOver20Rate: treatmentOver20 / validPairs,
      controlOver20Rate: controlOver20 / validPairs,
      treatmentLongRate: treatmentLong / validPairs,
      controlLongRate: controlLong / validPairs,
      averageTriggers: triggerSum / validPairs,
      triggerBuckets: Object.fromEntries(Object.entries(triggerBuckets).map(([bucket, row]) => [bucket, {
        ...row,
        winRate: row.games ? row.wins / row.games : null,
      }])),
      treatmentPerformance: treatmentPerfAvg,
      controlPerformance: controlPerfAvg,
      performanceDelta: perfDelta,
    });
  }
}

const report = {
  augmentId,
  name: target.name,
  tier: target.tier,
  timing: target.timing ?? "any",
  gamesPerContext: games,
  maxRounds,
  control: "same-seed natural selection; treatment consumes the same selection RNG draw before forcing the target augment",
  generatedAt: new Date().toISOString(),
  elapsedSeconds: (Date.now() - startedAt) / 1000,
  reports,
};

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, `diagnostic-${augmentId}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
const pct = (value: unknown) => typeof value === "number" ? `${(value * 100).toFixed(2)}%` : "—";
const markdown = [
  `# Augment Cause Diagnostic — ${augmentId} ${target.name}`,
  "",
  `- paired control: same seed + natural card selection`,
  `- treatment RNG: natural selection draw is still consumed before forcing ${augmentId}`,
  `- contexts: ${games} valid pairs per slot/player count`,
  "",
  "| Slot | Players | Treatment win | Control same-seat win | Paired delta | >15R T/C | >20R T/C | Avg triggers | Capture Δ | Lost-piece Δ | Finish Δ |",
  "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...reports.map((row) => {
    const r = row as any;
    return `| ${r.acquisitionIndex} | ${r.playerCount} | ${pct(r.treatmentWinRate)} | ${pct(r.controlWinRate)} | ${r.pairedWinDeltaPp >= 0 ? "+" : ""}${r.pairedWinDeltaPp.toFixed(2)}%p | ${pct(r.treatmentOver15Rate)} / ${pct(r.controlOver15Rate)} | ${pct(r.treatmentOver20Rate)} / ${pct(r.controlOver20Rate)} | ${r.averageTriggers.toFixed(2)} | ${r.performanceDelta.enemyPiecesCaptured.toFixed(2)} | ${r.performanceDelta.ownPiecesSentToWaiting.toFixed(2)} | ${r.performanceDelta.piecesFinished.toFixed(2)} |`;
  }),
  "",
].join("\n");
writeFileSync(join(outputDir, `diagnostic-${augmentId}.md`), `${markdown}\n`, "utf-8");
console.log(markdown);
