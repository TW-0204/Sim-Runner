from pathlib import Path


def replace_one(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


# 1) Simulation result and summary types.
replace_one(
    "src/lib/simulation/types.ts",
    'export type SimulationStatus = "COMPLETED" | "STALLED" | "ACTION_LIMIT";',
    'export type SimulationStatus = "COMPLETED" | "DRAW" | "STALLED" | "ACTION_LIMIT";',
)
replace_one(
    "src/lib/simulation/types.ts",
    "  completedGames: number;\n  stalledGames: number;",
    "  completedGames: number;\n  drawGames: number;\n  stalledGames: number;",
)
replace_one(
    "src/lib/simulation/types.ts",
    "    gamesOwned: number;\n    wins: number;\n    winRate: number;",
    "    gamesOwned: number;\n    wins: number;\n    winRate: number;\n    drawGamesOwned: number;\n    drawRate: number;",
)

# 2) Batch API forwards an optional max-rounds cap.
replace_one(
    "src/lib/simulation/batch.ts",
    "  maxActions?: number;\n};",
    "  maxActions?: number;\n  maxRounds?: number;\n};",
)
replace_one(
    "src/lib/simulation/batch.ts",
    "      maxActions: options.maxActions,\n    }));",
    "      maxActions: options.maxActions,\n      maxRounds: options.maxRounds,\n    }));",
)

# 3) A capped simulation may finish as DRAW after the last turn of maxRounds.
replace_one(
    "src/lib/simulation/game.ts",
    "  playerCount: number;\n  maxActions?: number;\n};",
    "  playerCount: number;\n  maxActions?: number;\n  maxRounds?: number;\n};",
)
replace_one(
    "src/lib/simulation/game.ts",
    "  const maxActions = options.maxActions ?? 20_000;\n  const engine = createInitialEngine(playerSeeds(options.playerCount));",
    "  const maxActions = options.maxActions ?? 20_000;\n  const maxRounds = options.maxRounds;\n  if (maxRounds != null && (!Number.isInteger(maxRounds) || maxRounds < 1)) {\n    throw new Error(\"maxRounds must be a positive integer when provided.\");\n  }\n  const engine = createInitialEngine(playerSeeds(options.playerCount));",
)
replace_one(
    "src/lib/simulation/game.ts",
    "  while (!context.engine.winnerUserId && context.actions < maxActions) {",
    "  while (\n    !context.engine.winnerUserId\n    && context.actions < maxActions\n    && (maxRounds == null || context.engine.round <= maxRounds)\n  ) {",
)
replace_one(
    "src/lib/simulation/game.ts",
    "  if (context.engine.winnerUserId) status = \"COMPLETED\";\n  else if (!error && context.actions >= maxActions) status = \"ACTION_LIMIT\";",
    "  if (context.engine.winnerUserId) status = \"COMPLETED\";\n  else if (!error && maxRounds != null && context.engine.round > maxRounds) status = \"DRAW\";\n  else if (!error && context.actions >= maxActions) status = \"ACTION_LIMIT\";",
)

# 4) Metrics keep win rate based on decisive games and expose draws separately.
replace_one(
    "src/lib/simulation/metrics.ts",
    '  const completed = results.filter((result) => result.status === "COMPLETED");\n  const rounds = completed.map((result) => result.round).sort((a, b) => a - b);',
    '  const completed = results.filter((result) => result.status === "COMPLETED");\n  const draws = results.filter((result) => result.status === "DRAW");\n  const rounds = completed.map((result) => result.round).sort((a, b) => a - b);',
)
replace_one(
    "src/lib/simulation/metrics.ts",
    "  const byAugment = new Map<string, {\n",
    "  const drawGamesOwnedByAugment = new Map<string, number>();\n  for (const result of draws) {\n    const seen = new Set<string>();\n    for (const acquisition of result.acquisitions) {\n      const key = `${acquisition.userId}\\u0000${acquisition.augmentId}`;\n      if (seen.has(key)) continue;\n      seen.add(key);\n      drawGamesOwnedByAugment.set(\n        acquisition.augmentId,\n        (drawGamesOwnedByAugment.get(acquisition.augmentId) ?? 0) + 1,\n      );\n    }\n  }\n\n  const byAugment = new Map<string, {\n",
)
replace_one(
    "src/lib/simulation/metrics.ts",
    "  const augmentWinStats: BatchSummary[\"augmentWinStats\"] = {};\n  for (const [augmentId, stats] of byAugment) {",
    "  for (const augmentId of drawGamesOwnedByAugment.keys()) {\n    if (byAugment.has(augmentId)) continue;\n    byAugment.set(augmentId, {\n      gamesOwned: 0,\n      wins: 0,\n      specialWins: 0,\n      triggeredGames: 0,\n      totalTriggers: 0,\n      winningTriggers: 0,\n      totalRoundsRemaining: 0,\n      totalTurnsRemaining: 0,\n      totalGameRounds: 0,\n      byIndex: new Map<number, { games: number; wins: number }>(),\n    });\n  }\n\n  const augmentWinStats: BatchSummary[\"augmentWinStats\"] = {};\n  for (const [augmentId, stats] of byAugment) {",
)
replace_one(
    "src/lib/simulation/metrics.ts",
    "    const averageGameRound = stats.gamesOwned ? stats.totalGameRounds / stats.gamesOwned : null;\n    augmentWinStats[augmentId] = {\n      gamesOwned: stats.gamesOwned,\n      wins: stats.wins,\n      winRate: rate(stats.wins, stats.gamesOwned),",
    "    const averageGameRound = stats.gamesOwned ? stats.totalGameRounds / stats.gamesOwned : null;\n    const drawGamesOwned = drawGamesOwnedByAugment.get(augmentId) ?? 0;\n    const terminalGamesOwned = stats.gamesOwned + drawGamesOwned;\n    augmentWinStats[augmentId] = {\n      gamesOwned: stats.gamesOwned,\n      wins: stats.wins,\n      winRate: rate(stats.wins, stats.gamesOwned),\n      drawGamesOwned,\n      drawRate: rate(drawGamesOwned, terminalGamesOwned),",
)
replace_one(
    "src/lib/simulation/metrics.ts",
    "    completedGames: completed.length,\n    stalledGames: results.filter((result) => result.status === \"STALLED\").length,",
    "    completedGames: completed.length,\n    drawGames: draws.length,\n    stalledGames: results.filter((result) => result.status === \"STALLED\").length,",
)

# 5) Independent batch CLI accepts --max-rounds and reports draws separately from incomplete games.
replace_one(
    "scripts/balance-independent-batch.ts",
    'const maxActions = positiveInteger("max-actions", argument("max-actions"), 20_000);\nconst outputDir = argument("output-dir") ?? "independent-results";',
    'const maxActions = positiveInteger("max-actions", argument("max-actions"), 20_000);\nconst maxRoundsArg = argument("max-rounds");\nconst maxRounds = maxRoundsArg == null ? undefined : positiveInteger("max-rounds", maxRoundsArg, 30);\nconst outputDir = argument("output-dir") ?? "independent-results";',
)
replace_one(
    "scripts/balance-independent-batch.ts",
    "  maxActions,\n});",
    "  maxActions,\n  maxRounds,\n});",
)
replace_one(
    "scripts/balance-independent-batch.ts",
    "    elapsedSeconds,\n  },",
    "    elapsedSeconds,\n    maxRounds: maxRounds ?? null,\n  },",
)
replace_one(
    "scripts/balance-independent-batch.ts",
    "  `- completed: ${result.summary.completedGames.toLocaleString()}/${games.toLocaleString()}`,\n  `- stalled: ${result.summary.stalledGames}`,",
    "  `- completed: ${result.summary.completedGames.toLocaleString()}/${games.toLocaleString()}`,\n  `- draws: ${result.summary.drawGames.toLocaleString()}`,\n  `- max rounds: ${maxRounds ?? \"none\"}`,\n  `- stalled: ${result.summary.stalledGames}`,",
)
replace_one(
    "scripts/balance-independent-batch.ts",
    "console.error(`[independent] ${result.summary.completedGames}/${games} completed, ${incompleteGames} incomplete`);",
    "console.error(`[independent] ${result.summary.completedGames}/${games} completed, ${result.summary.drawGames} draws, ${incompleteGames} incomplete`);",
)

# 6) Merge report shows total and per-augment draw rates while keeping balance classification decisive-only.
replace_one(
    "scripts/balance-independent-merge.ts",
    "    elapsedSeconds: number;\n  };",
    "    elapsedSeconds: number;\n    maxRounds?: number | null;\n  };",
)
replace_one(
    "scripts/balance-independent-merge.ts",
    "const totalGames = batches.reduce((sum, batch) => sum + batch.metadata.games, 0);\nconst totalIncomplete = batches.reduce((sum, batch) => sum + batch.summary.stalledGames + batch.summary.actionLimitGames, 0);",
    "const totalGames = batches.reduce((sum, batch) => sum + batch.metadata.games, 0);\nconst totalDraws = batches.reduce((sum, batch) => sum + (batch.summary.drawGames ?? 0), 0);\nconst totalIncomplete = batches.reduce((sum, batch) => sum + batch.summary.stalledGames + batch.summary.actionLimitGames, 0);",
)
replace_one(
    "scripts/balance-independent-merge.ts",
    "    wins: number;\n    pooledWinRate: number | null;",
    "    wins: number;\n    drawGamesOwned: number;\n    drawRate: number | null;\n    pooledWinRate: number | null;",
)
replace_one(
    "scripts/balance-independent-merge.ts",
    "    const gamesOwned = stats.reduce((sum, stat) => sum + (stat?.gamesOwned ?? 0), 0);\n    const wins = stats.reduce((sum, stat) => sum + (stat?.wins ?? 0), 0);\n    const batchWinRates",
    "    const gamesOwned = stats.reduce((sum, stat) => sum + (stat?.gamesOwned ?? 0), 0);\n    const wins = stats.reduce((sum, stat) => sum + (stat?.wins ?? 0), 0);\n    const drawGamesOwned = stats.reduce((sum, stat) => sum + (stat?.drawGamesOwned ?? 0), 0);\n    const terminalGamesOwned = gamesOwned + drawGamesOwned;\n    const drawRate = terminalGamesOwned > 0 ? drawGamesOwned / terminalGamesOwned : null;\n    const batchWinRates",
)
replace_one(
    "scripts/balance-independent-merge.ts",
    "      gamesOwned,\n      wins,\n      pooledWinRate: classified.winRate,",
    "      gamesOwned,\n      wins,\n      drawGamesOwned,\n      drawRate,\n      pooledWinRate: classified.winRate,",
)
replace_one(
    "scripts/balance-independent-merge.ts",
    "  return `${pct(cell.pooledWinRate)} (${delta}, n=${cell.gamesOwned})<br>${batchRates}<br>spread ${spread}`;",
    "  return `${pct(cell.pooledWinRate)} (${delta}, decisive n=${cell.gamesOwned})<br>draw ${pct(cell.drawRate)} (n=${cell.drawGamesOwned})<br>${batchRates}<br>spread ${spread}`;",
)
replace_one(
    "scripts/balance-independent-merge.ts",
    "  `- 미완료 게임: ${totalIncomplete.toLocaleString()}판`,",
    "  `- 무승부: ${totalDraws.toLocaleString()}판`,\n  `- 미완료 게임: ${totalIncomplete.toLocaleString()}판`,",
)
replace_one(
    "scripts/balance-independent-merge.ts",
    ".map((batch) => `- ${batch.metadata.playerCount}P #${batch.metadata.batchId}: seeds ${batch.metadata.seedStart}–${batch.metadata.seedEnd}, ${batch.metadata.elapsedSeconds.toFixed(1)}s, completed ${batch.summary.completedGames}/${batch.metadata.games}`),",
    ".map((batch) => `- ${batch.metadata.playerCount}P #${batch.metadata.batchId}: seeds ${batch.metadata.seedStart}–${batch.metadata.seedEnd}, ${batch.metadata.elapsedSeconds.toFixed(1)}s, completed ${batch.summary.completedGames}/${batch.metadata.games}, draws ${batch.summary.drawGames ?? 0}`),",
)
replace_one(
    "scripts/balance-independent-merge.ts",
    "  totalGames,\n  totalIncomplete,",
    "  totalGames,\n  totalDraws,\n  totalIncomplete,",
)

print("Applied simulation round-cap support: optional maxRounds, DRAW status, and draw-aware balance reporting.")
