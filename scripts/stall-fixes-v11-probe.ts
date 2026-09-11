import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const cases = [
  { augmentId: "P14", seed: "6226875", playerCount: 2 },
  { augmentId: "P14", seed: "6227070", playerCount: 2 },
  { augmentId: "P14", seed: "6326327", playerCount: 3 },
  { augmentId: "P14", seed: "6326906", playerCount: 3 },
  { augmentId: "A16", seed: "6384749", playerCount: 2, expectedWinnerSeat: 2, expectedWinnerCondition: "MOONWALK" },
] as const;

const gamePath = join(process.cwd(), "src/lib/simulation/game.ts");
const originalGameSource = readFileSync(gamePath, "utf-8");

const selectionBlock = `      const visible = offer.offerIds.slice(0, 3);\n      const player = context.engine.players.find((candidate) => candidate.userId === offer.userId);\n      if (!player) throw new Error(\`Missing simulation player \${offer.userId}.\`);\n      const currentlyEligible = visible.filter((id) => id !== "A10" || playerHasWaitingPiece(context, offer.userId));\n      const selectedId = context.rng.augment.pick(currentlyEligible.length > 0 ? currentlyEligible : visible);`;

const forcedSelectionBlock = `      const visible = offer.offerIds.slice(0, 3);\n      const player = context.engine.players.find((candidate) => candidate.userId === offer.userId);\n      if (!player) throw new Error(\`Missing simulation player \${offer.userId}.\`);\n      const currentlyEligible = visible.filter((id) => id !== "A10" || playerHasWaitingPiece(context, offer.userId));\n      const forcedAugmentId = process.env.SIM_FORCED_AUGMENT_ID;\n      const forcedAcquisitionIndex = Number(process.env.SIM_FORCED_ACQUISITION_INDEX ?? "1");\n      const numericSeed = Number(context.seed);\n      const forcedSeat = (Number.isFinite(numericSeed) ? numericSeed : 0) % context.engine.players.length + 1;\n      const forceEligible = forcedAugmentId !== "A10" || playerHasWaitingPiece(context, offer.userId);\n      const shouldForce = Boolean(forcedAugmentId) && forceEligible && eventIndex + 1 === forcedAcquisitionIndex && player.seat === forcedSeat;\n      const selectedId = shouldForce ? forcedAugmentId! : context.rng.augment.pick(currentlyEligible.length > 0 ? currentlyEligible : visible);`;

if (!originalGameSource.includes(selectionBlock)) {
  throw new Error("Could not locate post-v11 augment-selection block.");
}

writeFileSync(gamePath, originalGameSource.replace(selectionBlock, forcedSelectionBlock), "utf-8");
process.env.SIM_FORCED_ACQUISITION_INDEX = "1";

try {
  const [{ getBalanceRuleset }, { simulateGame }, { createInitialEngine }, { isMoonwalkHome }] = await Promise.all([
    import("@/lib/simulation/rulesets"),
    import("@/lib/simulation/game"),
    import("@/lib/game/engine"),
    import("@/lib/game/passive-win"),
  ]);
  const ruleset = getBalanceRuleset("two-aug-start-r4-special-slots-v2");

  const semanticEngine = createInitialEngine([
    { userId: "sim-p1", displayName: "Sim P1", seat: 1 },
    { userId: "sim-p2", displayName: "Sim P2", seat: 2 },
  ]);
  const p1 = semanticEngine.players[0];
  const p2 = semanticEngine.players[1];
  const borrowed = p1.pieces.shift();
  if (!borrowed) throw new Error("Missing semantic probe piece.");
  borrowed.ownerUserId = p2.userId;
  borrowed.seat = p2.seat;
  borrowed.betrayalOriginalOwnerUserId = p1.userId;
  p2.pieces.push(borrowed);
  if (!isMoonwalkHome(semanticEngine, p2.userId)) {
    throw new Error("P02 semantic probe failed: borrowed Betrayal piece blocked the owner's four WAITING pieces.");
  }
  if (isMoonwalkHome(semanticEngine, p1.userId)) {
    throw new Error("P02 semantic probe failed: an original piece still under opponent control counted as home.");
  }

  for (const item of cases) {
    process.env.SIM_FORCED_AUGMENT_ID = item.augmentId;
    const numericSeed = Number(item.seed);
    const forcedSeat = numericSeed % item.playerCount + 1;
    const forcedUserId = `sim-p${forcedSeat}`;
    const result = simulateGame({
      seed: item.seed,
      ruleset,
      playerCount: item.playerCount,
      maxActions: 20_000,
    });

    const forcedAcquisition = result.acquisitions.some((entry) => (
      entry.userId === forcedUserId
      && entry.augmentId === item.augmentId
      && entry.acquisitionIndex === 1
    ));
    if (!forcedAcquisition) {
      throw new Error(`${item.augmentId} seed ${item.seed}: forced acquisition missing.`);
    }
    if (result.status !== "COMPLETED") {
      throw new Error(`${item.augmentId} seed ${item.seed}: expected COMPLETED, got ${result.status}: ${result.error ?? "no error"}`);
    }
    if ("expectedWinnerSeat" in item && result.winnerSeat !== item.expectedWinnerSeat) {
      throw new Error(`${item.augmentId} seed ${item.seed}: expected winner seat ${item.expectedWinnerSeat}, got ${result.winnerSeat}.`);
    }
    if ("expectedWinnerCondition" in item && result.winnerCondition !== item.expectedWinnerCondition) {
      throw new Error(`${item.augmentId} seed ${item.seed}: expected ${item.expectedWinnerCondition}, got ${result.winnerCondition}.`);
    }
    console.log(`v11 seed ${item.seed} ${item.augmentId}: COMPLETED winner=${result.winnerSeat} condition=${result.winnerCondition}`);
  }

  console.log("stall fixes v11 probe PASS");
} finally {
  writeFileSync(gamePath, originalGameSource, "utf-8");
  delete process.env.SIM_FORCED_AUGMENT_ID;
  delete process.env.SIM_FORCED_ACQUISITION_INDEX;
}
