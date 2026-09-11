import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const cases = [
  { augmentId: "P14", seed: "6226875", playerCount: 2 },
  { augmentId: "P14", seed: "6227070", playerCount: 2 },
  { augmentId: "P14", seed: "6326327", playerCount: 3 },
  { augmentId: "P14", seed: "6326906", playerCount: 3 },
  { augmentId: "A16", seed: "6384749", playerCount: 2 },
] as const;

const gamePath = join(process.cwd(), "src/lib/simulation/game.ts");
const originalGameSource = readFileSync(gamePath, "utf-8");

const selectionBlock = `      const visible = offer.offerIds.slice(0, 3);\n      const player = context.engine.players.find((candidate) => candidate.userId === offer.userId);\n      if (!player) throw new Error(\`Missing simulation player \${offer.userId}.\`);\n      const currentlyEligible = visible.filter((id) => id !== \"A10\" || playerHasWaitingPiece(context, offer.userId));\n      const selectedId = context.rng.augment.pick(currentlyEligible.length > 0 ? currentlyEligible : visible);`;

const forcedSelectionBlock = `      const visible = offer.offerIds.slice(0, 3);\n      const player = context.engine.players.find((candidate) => candidate.userId === offer.userId);\n      if (!player) throw new Error(\`Missing simulation player \${offer.userId}.\`);\n      const currentlyEligible = visible.filter((id) => id !== \"A10\" || playerHasWaitingPiece(context, offer.userId));\n      const forcedAugmentId = process.env.SIM_FORCED_AUGMENT_ID;\n      const forcedAcquisitionIndex = Number(process.env.SIM_FORCED_ACQUISITION_INDEX ?? \"1\");\n      const numericSeed = Number(context.seed);\n      const forcedSeat = (Number.isFinite(numericSeed) ? numericSeed : 0) % context.engine.players.length + 1;\n      const forceEligible = forcedAugmentId !== \"A10\" || playerHasWaitingPiece(context, offer.userId);\n      const shouldForce = Boolean(forcedAugmentId) && forceEligible && eventIndex + 1 === forcedAcquisitionIndex && player.seat === forcedSeat;\n      const selectedId = shouldForce ? forcedAugmentId! : context.rng.augment.pick(currentlyEligible.length > 0 ? currentlyEligible : visible);`;

let instrumentedSource = originalGameSource.replace(selectionBlock, forcedSelectionBlock);
if (instrumentedSource === originalGameSource) {
  throw new Error("Could not locate post-v10 augment-selection block. Apply the current v3 stack before running diagnostics.");
}

const transitionNeedle = `  context.engine = after;\n}\n\nfunction applyDueAugmentEvents`;
const transitionReplacement = `  const traceUserId = process.env.SIM_TRACE_USER_ID;\n  if (traceUserId) {\n    const beforePlayer = before.players.find((candidate) => candidate.userId === traceUserId);\n    const afterPlayer = after.players.find((candidate) => candidate.userId === traceUserId);\n    const summarize = (player: typeof beforePlayer) => player?.pieces.map((piece) => ({\n      id: piece.id,\n      ownerUserId: piece.ownerUserId,\n      status: piece.status,\n      node: piece.node,\n      groupId: piece.groupId,\n      hasEntered: piece.hasEntered,\n      betrayalOriginalOwnerUserId: piece.betrayalOriginalOwnerUserId ?? null,\n    })) ?? [];\n    const trace = ((globalThis as any).__criticalTrace ??= []);\n    trace.push({\n      action: context.actions,\n      actionKind,\n      p14PieceId: context.setupsByUser[traceUserId]?.P14?.pieceId ?? null,\n      owned: [...(context.ownedByUser[traceUserId] ?? [])],\n      before: {\n        round: before.round, turnNumber: before.turnNumber, stage: before.stage,\n        lastAction: before.lastAction, pieces: summarize(beforePlayer),\n        results: structuredClone(before.results), pendingRolls: [...before.pendingRolls],\n        runtime: structuredClone(before.augmentRuntime?.[traceUserId] ?? null),\n      },\n      after: {\n        round: after.round, turnNumber: after.turnNumber, stage: after.stage,\n        lastAction: after.lastAction, pieces: summarize(afterPlayer),\n        results: structuredClone(after.results), pendingRolls: [...after.pendingRolls],\n        runtime: structuredClone(after.augmentRuntime?.[traceUserId] ?? null),\n      },\n    });\n  }\n  context.engine = after;\n}\n\nfunction applyDueAugmentEvents`;
if (!instrumentedSource.includes(transitionNeedle)) {
  throw new Error("Could not locate commitTransition tail for trace instrumentation.");
}
instrumentedSource = instrumentedSource.replace(transitionNeedle, transitionReplacement);

writeFileSync(gamePath, instrumentedSource, "utf-8");
process.env.SIM_FORCED_ACQUISITION_INDEX = "1";

try {
  const [{ getBalanceRuleset }, { simulateGame }] = await Promise.all([
    import("@/lib/simulation/rulesets"),
    import("@/lib/simulation/game"),
  ]);
  const ruleset = getBalanceRuleset("two-aug-start-r4-special-slots-v2");
  const reports = [];

  for (const item of cases) {
    process.env.SIM_FORCED_AUGMENT_ID = item.augmentId;
    const numericSeed = Number(item.seed);
    const forcedSeat = numericSeed % item.playerCount + 1;
    const forcedUserId = `sim-p${forcedSeat}`;
    process.env.SIM_TRACE_USER_ID = forcedUserId;
    (globalThis as any).__criticalTrace = [];

    const result = simulateGame({
      seed: item.seed,
      ruleset,
      playerCount: item.playerCount,
      maxActions: 20_000,
      maxRounds: 30,
    });
    const engine = result.failureDiagnostics?.engine;
    const player = engine?.players.find((candidate) => candidate.userId === forcedUserId);
    reports.push({
      ...item,
      forcedSeat,
      forcedUserId,
      status: result.status,
      error: result.error ?? null,
      round: result.round,
      turnNumber: result.turnNumber,
      acquisitions: result.acquisitions,
      lastAction: engine?.lastAction ?? null,
      stage: engine?.stage ?? null,
      currentSeat: engine?.currentSeat ?? null,
      pendingRolls: engine?.pendingRolls ?? null,
      results: engine?.results ?? null,
      forcedPlayerPieces: player?.pieces ?? null,
      ownedByUser: result.failureDiagnostics?.ownedByUser ?? null,
      setupsByUser: result.failureDiagnostics?.setupsByUser ?? null,
      engine: engine ?? null,
      trace: structuredClone((globalThis as any).__criticalTrace ?? []),
    });
  }

  mkdirSync("critical-stall-diagnostics", { recursive: true });
  writeFileSync(
    "critical-stall-diagnostics/diagnostics.json",
    `${JSON.stringify({ generatedAt: new Date().toISOString(), rulesetId: ruleset.id, reports }, null, 2)}\n`,
    "utf-8",
  );

  const lines = [
    "# Critical Stall Diagnostics",
    "",
    "| Augment | Seed | Players | Seat | Status | Round | Turn | Stage | Last action |",
    "|---|---:|---:|---:|---|---:|---:|---|---|",
    ...reports.map((row) => `| ${row.augmentId} | ${row.seed} | ${row.playerCount} | ${row.forcedSeat} | ${row.status} | ${row.round} | ${row.turnNumber} | ${row.stage ?? "—"} | ${(row.lastAction ?? "—").replaceAll("|", "\\|")} |`),
    "",
  ];
  writeFileSync("critical-stall-diagnostics/diagnostics.md", `${lines.join("\n")}\n`, "utf-8");
  console.log(lines.join("\n"));
} finally {
  writeFileSync(gamePath, originalGameSource, "utf-8");
  delete process.env.SIM_FORCED_AUGMENT_ID;
  delete process.env.SIM_FORCED_ACQUISITION_INDEX;
  delete process.env.SIM_TRACE_USER_ID;
  delete (globalThis as any).__criticalTrace;
}
