import { mkdirSync, writeFileSync } from "node:fs";

const cases = [
  { augmentId: "P14", seed: "6226875", playerCount: 2 },
  { augmentId: "P14", seed: "6227070", playerCount: 2 },
  { augmentId: "P14", seed: "6326327", playerCount: 3 },
  { augmentId: "P14", seed: "6326906", playerCount: 3 },
  { augmentId: "A16", seed: "6384749", playerCount: 2 },
  { augmentId: "P14", seed: "6326572", playerCount: 3, residual: true },
  { augmentId: "P16", seed: "6871323", playerCount: 4, residual: true },
  { augmentId: "P14", seed: "6226270", playerCount: 2, residual: true },
  { augmentId: "P14", seed: "6226189", playerCount: 2, residual: true },
] as const;

const [{ getBalanceRuleset }, { simulateGame }] = await Promise.all([
  import("@/lib/simulation/rulesets"),
  import("@/lib/simulation/game"),
]);
const ruleset = getBalanceRuleset("two-aug-start-r4-special-slots-v2");
const reports = [];

for (const item of cases) {
  const numericSeed = Number(item.seed);
  const forcedSeat = numericSeed % item.playerCount + 1;
  const forcedUserId = `sim-p${forcedSeat}`;
  const result = simulateGame({
    seed: item.seed,
    ruleset,
    playerCount: item.playerCount,
    maxActions: 20_000,
    maxRounds: 30,
    forcedAugmentId: item.augmentId,
    forcedAcquisitionIndex: 1,
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
