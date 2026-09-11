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
const maxRounds = positiveInteger("max-rounds", argument("max-rounds"), 30);
const outputDir = argument("output-dir") ?? "precision-all-results";

const specialConditions: Record<string, string> = {
  "AUG-031": "MOONWALK",
  "AUG-032": "FOUR_GUARDIANS",
  "AUG-033": "CENTER_STACK",
  "AUG-041": "SOLO_RUN",
  "AUG-042": "HUNT",
};

type Report = {
  acquisitionIndex: number;
  playerCount: 2 | 3 | 4;
  requestedGames: number;
  attempts: number;
  discardedContexts: number;
  completedGames: number;
  drawGames: number;
  incompleteGames: number;
  wins: number;
  ownerWinRate: number | null;
  drawRate: number | null;
  baselineWinRate: number;
  deltaPp: number | null;
  specialConditionWins: number;
  specialConditionWinRate: number | null;
  averageRound: number | null;
  averageTriggers: number | null;
};

const reports: Report[] = [];
const startedAt = Date.now();
{
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

  for (const acquisitionIndex of acquisitionIndexes) {
    for (const playerCount of [2, 3, 4] as const) {
      let validGames = 0;
      let attempts = 0;
      let completedGames = 0;
      let drawGames = 0;
      let incompleteGames = 0;
      let wins = 0;
      let specialConditionWins = 0;
      let roundSum = 0;
      let triggerSum = 0;
      const maxAttempts = games * 50;
      const seedBase = 2_000_000 + (hashId(augmentId) % 500_000) + acquisitionIndex * 1_000_000 + playerCount * 100_000;

      while (validGames < games && attempts < maxAttempts) {
        const seed = seedBase + attempts;
        const result = simulateGame({
          seed: String(seed),
          ruleset,
          playerCount,
          maxActions: 20_000,
          maxRounds,
          forcedAugmentId: augmentId,
          forcedAcquisitionIndex: acquisitionIndex,
        });
        attempts += 1;
        const forcedSeat = seed % playerCount + 1;
        const forcedUserId = `sim-p${forcedSeat}`;
        const targetAcquisitions = result.acquisitions.filter((item) => item.augmentId === augmentId);
        const forcedAcquisition = targetAcquisitions.some((item) => item.userId === forcedUserId && item.acquisitionIndex === acquisitionIndex);
        const duplicateTarget = targetAcquisitions.some((item) => item.userId !== forcedUserId || item.acquisitionIndex !== acquisitionIndex);
        const earlier = result.acquisitions.filter((item) => item.userId === forcedUserId && item.acquisitionIndex < acquisitionIndex);
        const earlierSpecial = earlier.some((item) => specialIds.has(item.augmentId));
        const earlierConflict = earlier.some((item) => {
          const previous = AUGMENT_BY_ID.get(item.augmentId);
          return (target.conflicts ?? []).includes(item.augmentId) || (previous?.conflicts ?? []).includes(augmentId);
        });
        if (!forcedAcquisition || duplicateTarget || earlierSpecial || earlierConflict) continue;

        validGames += 1;
        if (result.status === "DRAW") {
          drawGames += 1;
          continue;
        }
        if (result.status !== "COMPLETED") {
          incompleteGames += 1;
          continue;
        }
        completedGames += 1;
        roundSum += result.round;
        triggerSum += result.triggerCountsByUser?.[forcedUserId]?.[augmentId] ?? 0;
        if (result.winnerSeat === forcedSeat) {
          wins += 1;
          if (specialConditions[augmentId] && result.winnerCondition === specialConditions[augmentId]) specialConditionWins += 1;
        }
      }
      if (validGames < games) throw new Error(`${augmentId} slot ${acquisitionIndex} ${playerCount}p produced ${validGames}/${games} valid contexts after ${attempts} attempts.`);
      const ownerWinRate = completedGames ? wins / completedGames : null;
      const drawRate = completedGames + drawGames ? drawGames / (completedGames + drawGames) : null;
      const baselineWinRate = 1 / playerCount;
      reports.push({
        acquisitionIndex,
        playerCount,
        requestedGames: games,
        attempts,
        discardedContexts: attempts - validGames,
        completedGames,
        drawGames,
        incompleteGames,
        wins,
        ownerWinRate,
        drawRate,
        baselineWinRate,
        deltaPp: ownerWinRate == null ? null : (ownerWinRate - baselineWinRate) * 100,
        specialConditionWins,
        specialConditionWinRate: completedGames ? specialConditionWins / completedGames : null,
        averageRound: completedGames ? roundSum / completedGames : null,
        averageTriggers: completedGames ? triggerSum / completedGames : null,
      });
      console.error(`[precision-all] ${augmentId} slot${acquisitionIndex} ${playerCount}p: complete ${completedGames}, draw ${drawGames}, incomplete ${incompleteGames}, win ${ownerWinRate == null ? "—" : (ownerWinRate * 100).toFixed(2) + "%"}`);
    }
  }

  const report = {
    augmentId,
    name: target.name,
    tier: target.tier,
    special: Boolean(target.special),
    timing: target.timing ?? "any",
    acquisitionIndexes,
    gamesPerContext: games,
    maxRounds,
    rulesetId: ruleset.id,
    generatedAt: new Date().toISOString(),
    elapsedSeconds: (Date.now() - startedAt) / 1000,
    reports,
  };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, `precision-${augmentId}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  const pct = (value: number | null) => value == null ? "—" : `${(value * 100).toFixed(2)}%`;
  const markdown = [
    `# Forced Precision — ${augmentId} ${target.name}`,
    "",
    `- tier: ${target.tier}`,
    `- timing: ${target.timing ?? "any"}`,
    `- max rounds: ${maxRounds} (DRAW after cap)`,
    `- valid games per slot/player-count context: ${games}`,
    "",
    "| Slot | Players | Win | Delta | Draw | Incomplete | Avg triggers | Special-condition win | Discarded |",
    "|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...reports.map((item) => `| ${item.acquisitionIndex} | ${item.playerCount} | ${pct(item.ownerWinRate)} | ${item.deltaPp == null ? "—" : `${item.deltaPp >= 0 ? "+" : ""}${item.deltaPp.toFixed(2)}%p`} | ${pct(item.drawRate)} | ${item.incompleteGames} | ${item.averageTriggers?.toFixed(2) ?? "—"} | ${pct(item.specialConditionWinRate)} | ${item.discardedContexts} |`),
    "",
  ].join("\n");
  writeFileSync(join(outputDir, `precision-${augmentId}.md`), `${markdown}\n`, "utf-8");
  console.log(markdown);
}
