import { readFileSync, writeFileSync } from "node:fs";
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
const gamePath = join(process.cwd(), "src/lib/simulation/game.ts");
const original = readFileSync(gamePath, "utf-8");

const selectionBlock = `      const visible = offer.offerIds.slice(0, 3);\n      const selectedId = context.rng.augment.pick(visible);\n      const player = context.engine.players.find((candidate) => candidate.userId === offer.userId);\n      if (!player) throw new Error(\`Missing simulation player \${offer.userId}.\`);`;
const forcedSelectionBlock = `      const visible = offer.offerIds.slice(0, 3);\n      const player = context.engine.players.find((candidate) => candidate.userId === offer.userId);\n      if (!player) throw new Error(\`Missing simulation player \${offer.userId}.\`);\n      const numericSeed = Number(context.seed);\n      const forcedSeat = (Number.isFinite(numericSeed) ? numericSeed : 0) % context.engine.players.length + 1;\n      const selectedId = eventIndex === 0 && player.seat === forcedSeat ? \"AUG-033\" : context.rng.augment.pick(visible);`;

const returnNeedle = `    failureDiagnostics: status === "STALLED" ? {\n      engine: structuredClone(context.engine),\n      ownedByUser: structuredClone(context.ownedByUser),\n      setupsByUser: structuredClone(context.setupsByUser),\n    } : undefined,\n    error,`;
const returnReplacement = `    failureDiagnostics: status === "STALLED" ? {\n      engine: structuredClone(context.engine),\n      ownedByUser: structuredClone(context.ownedByUser),\n      setupsByUser: structuredClone(context.setupsByUser),\n    } : undefined,\n    __p04FinalPlayers: structuredClone(context.engine.players),\n    error,`;

if (!original.includes(selectionBlock)) throw new Error("Could not locate augment selection block.");
if (!original.includes(returnNeedle)) throw new Error("Could not locate simulation return block.");

writeFileSync(gamePath, original.replace(selectionBlock, forcedSelectionBlock).replace(returnNeedle, returnReplacement), "utf-8");

const CENTER = 15;
const CORNERS = new Set([5, 10, 22, 29]);
const APPROACH = new Set([11, 12, 13, 14, 16, 17, 23, 24]);
const results = [] as any[];

try {
  const [{ getBalanceRuleset }, { simulateGame }] = await Promise.all([
    import("@/lib/simulation/rulesets"),
    import("@/lib/simulation/game"),
  ]);
  const ruleset = getBalanceRuleset("two-aug-start-r4-special-slots-v2");

  for (const playerCount of [2, 3, 4] as const) {
    let valid = 0;
    let attempts = 0;
    let wins = 0;
    let incomplete = 0;
    const lossCenterDist = [0, 0, 0, 0, 0];
    const lossLargestGroupDist = [0, 0, 0, 0, 0];
    let lossApproachSum = 0;
    let lossCornerSum = 0;
    let lossWaitingSum = 0;
    let lossOnBoardSum = 0;
    let lossCenterHistorySum = 0;
    let losses = 0;

    while (valid < games && attempts < games * 20) {
      const seed = attempts;
      const game = simulateGame({ seed: String(seed), ruleset, playerCount, maxActions: 20_000 }) as any;
      attempts += 1;
      const forcedSeat = seed % playerCount + 1;
      const forcedUserId = `sim-p${forcedSeat}`;
      const forced = game.acquisitions.some((a: any) => a.userId === forcedUserId && a.augmentId === "AUG-033" && a.acquisitionIndex === 1);
      const duplicate = game.acquisitions.some((a: any) => a.userId !== forcedUserId && a.augmentId === "AUG-033");
      if (!forced || duplicate) continue;

      valid += 1;
      if (game.status !== "COMPLETED") {
        incomplete += 1;
        continue;
      }
      if (game.winnerSeat === forcedSeat) {
        wins += 1;
        continue;
      }

      losses += 1;
      const player = game.__p04FinalPlayers.find((p: any) => p.userId === forcedUserId);
      if (!player) throw new Error("Missing forced AUG-033 player in final snapshot.");
      const pieces = player.pieces as any[];
      const centerPieces = pieces.filter((p) => p.status === "ON_BOARD" && p.node === CENTER);
      const groupCounts = new Map<string, number>();
      for (const p of centerPieces) groupCounts.set(p.groupId, (groupCounts.get(p.groupId) ?? 0) + 1);
      const largestCenterGroup = Math.max(0, ...groupCounts.values());
      const centerCount = Math.min(4, centerPieces.length);
      lossCenterDist[centerCount] += 1;
      lossLargestGroupDist[Math.min(4, largestCenterGroup)] += 1;
      lossApproachSum += pieces.filter((p) => p.status === "ON_BOARD" && APPROACH.has(p.node)).length;
      lossCornerSum += pieces.filter((p) => p.status === "ON_BOARD" && CORNERS.has(p.node)).length;
      lossWaitingSum += pieces.filter((p) => p.status === "WAITING").length;
      lossOnBoardSum += pieces.filter((p) => p.status === "ON_BOARD").length;
      lossCenterHistorySum += pieces.filter((p) => Array.isArray(p.pathHistory) && p.pathHistory.includes(CENTER)).length;
    }

    results.push({
      playerCount,
      validGames: valid,
      attempts,
      incomplete,
      wins,
      ownerWinRate: wins / Math.max(1, valid - incomplete),
      losses,
      lossCenterDist,
      lossLargestGroupDist,
      avgApproachPiecesAtLoss: losses ? lossApproachSum / losses : 0,
      avgCornerPiecesAtLoss: losses ? lossCornerSum / losses : 0,
      avgWaitingPiecesAtLoss: losses ? lossWaitingSum / losses : 0,
      avgOnBoardPiecesAtLoss: losses ? lossOnBoardSum / losses : 0,
      avgPiecesWithCenterInCurrentHistoryAtLoss: losses ? lossCenterHistorySum / losses : 0,
    });
  }
} finally {
  writeFileSync(gamePath, original, "utf-8");
}

console.log("# AUG-033 Bottleneck Diagnostic\n");
console.log(`- ${games.toLocaleString()} valid forced-AUG-033 games per player count`);
console.log("- distributions below describe only games where the AUG-033 owner lost\n");
console.log("| Players | Owner win | Loss center 0/1/2/3 | Largest center group 0/1/2/3 | Avg approach | Avg corner | Avg waiting | Avg onboard | Center-history pieces | Incomplete |");
console.log("|---:|---:|---|---|---:|---:|---:|---:|---:|---:|");
for (const r of results) {
  console.log(`| ${r.playerCount} | ${(r.ownerWinRate * 100).toFixed(2)}% | ${r.lossCenterDist.slice(0,4).join("/")} | ${r.lossLargestGroupDist.slice(0,4).join("/")} | ${r.avgApproachPiecesAtLoss.toFixed(2)} | ${r.avgCornerPiecesAtLoss.toFixed(2)} | ${r.avgWaitingPiecesAtLoss.toFixed(2)} | ${r.avgOnBoardPiecesAtLoss.toFixed(2)} | ${r.avgPiecesWithCenterInCurrentHistoryAtLoss.toFixed(2)} | ${r.incomplete} |`);
}
console.log("\nJSON");
console.log(JSON.stringify(results, null, 2));
