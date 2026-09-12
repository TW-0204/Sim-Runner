from pathlib import Path

ROOT = Path('.')

def patch(path, old, new, count=1):
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'missing patch anchor in {path}: {old[:100]!r}')
    text2 = text.replace(old, new, count)
    p.write_text(text2, encoding='utf-8')

# simulation/game.ts
patch('src/lib/simulation/game.ts',
'''type SimulationOptions = {\n  seed: string;\n  ruleset: BalanceRuleset;\n  playerCount: number;\n  maxActions?: number;\n  maxRounds?: number;\n  forcedAugmentId?: string;\n  forcedAcquisitionIndex?: number;\n};''',
'''type SimulationOptions = {\n  seed: string;\n  ruleset: BalanceRuleset;\n  playerCount: number;\n  maxActions?: number;\n  maxRounds?: number;\n  forcedAugmentId?: string;\n  forcedAcquisitionIndex?: number;\n  preserveSelectionRng?: boolean;\n};''')

patch('src/lib/simulation/game.ts',
'''  forcedAugmentId?: string;\n  forcedAcquisitionIndex?: number;\n  tokenCounter: number;\n  actions: number;\n  s16BasicRollsByUser: Record<string, number>;''',
'''  forcedAugmentId?: string;\n  forcedAcquisitionIndex?: number;\n  preserveSelectionRng: boolean;\n  tokenCounter: number;\n  actions: number;\n  performanceByUser: Record<string, { rolls: number; moves: number; enemyPiecesCaptured: number; ownPiecesSentToWaiting: number; piecesFinished: number }>;\n  s16BasicRollsByUser: Record<string, number>;''')

patch('src/lib/simulation/game.ts',
'''      const selectedId = shouldForce\n        ? context.forcedAugmentId!\n        : context.rng.augment.pick(currentlyEligible.length > 0 ? currentlyEligible : visible);''',
'''      const selectionPool = currentlyEligible.length > 0 ? currentlyEligible : visible;\n      const naturalSelectedId = !shouldForce || context.preserveSelectionRng\n        ? context.rng.augment.pick(selectionPool)\n        : null;\n      const selectedId = shouldForce\n        ? context.forcedAugmentId!\n        : naturalSelectedId!;''')

anchor = '''function commitTransition(\n  context: SimulationContext,\n  before: GameEngineState,\n  after: GameEngineState,\n  actorUserId: string,\n  actionKind: SimulationActionKind,\n) {'''
insert = '''function performanceFor(context: SimulationContext, userId: string) {\n  context.performanceByUser[userId] ??= {\n    rolls: 0,\n    moves: 0,\n    enemyPiecesCaptured: 0,\n    ownPiecesSentToWaiting: 0,\n    piecesFinished: 0,\n  };\n  return context.performanceByUser[userId];\n}\n\nfunction ownPiecesSentToWaitingCount(before: GameEngineState, after: GameEngineState, userId: string) {\n  const beforePlayer = before.players.find((player) => player.userId === userId);\n  const afterPlayer = after.players.find((player) => player.userId === userId);\n  if (!beforePlayer || !afterPlayer) return 0;\n  return beforePlayer.pieces.filter((piece) => {\n    const next = afterPlayer.pieces.find((candidate) => candidate.id === piece.id);\n    return piece.status === "ON_BOARD" && next?.status === "WAITING";\n  }).length;\n}\n\nfunction piecesFinishedCount(before: GameEngineState, after: GameEngineState, userId: string) {\n  const beforePlayer = before.players.find((player) => player.userId === userId);\n  const afterPlayer = after.players.find((player) => player.userId === userId);\n  if (!beforePlayer || !afterPlayer) return 0;\n  return beforePlayer.pieces.filter((piece) => {\n    const next = afterPlayer.pieces.find((candidate) => candidate.id === piece.id);\n    return piece.status !== "FINISHED" && next?.status === "FINISHED";\n  }).length;\n}\n\nfunction recordPerformanceTransition(\n  context: SimulationContext,\n  before: GameEngineState,\n  after: GameEngineState,\n  actorUserId: string,\n  actionKind: SimulationActionKind,\n) {\n  const actor = performanceFor(context, actorUserId);\n  if (actionKind === "roll") actor.rolls += 1;\n  if (actionKind === "move") actor.moves += 1;\n  actor.enemyPiecesCaptured += capturedEnemyPieceCount(before, after, actorUserId);\n  actor.piecesFinished += piecesFinishedCount(before, after, actorUserId);\n  for (const player of before.players) {\n    performanceFor(context, player.userId).ownPiecesSentToWaiting += ownPiecesSentToWaitingCount(before, after, player.userId);\n  }\n}\n\n''' + anchor
patch('src/lib/simulation/game.ts', anchor, insert)

patch('src/lib/simulation/game.ts',
'''  applyG01TriggerBreakdown(\n    context.g01TriggerBreakdownByUser,\n    actorUserId,\n    detectG01TriggerBreakdown(before, after, actorUserId, context.ownedByUser),\n  );\n  context.engine = applyCrossTransitionLegacyRules(before, after, context);''',
'''  applyG01TriggerBreakdown(\n    context.g01TriggerBreakdownByUser,\n    actorUserId,\n    detectG01TriggerBreakdown(before, after, actorUserId, context.ownedByUser),\n  );\n  recordPerformanceTransition(context, before, after, actorUserId, actionKind);\n  context.engine = applyCrossTransitionLegacyRules(before, after, context);''')

patch('src/lib/simulation/game.ts',
'''  context.engine = canonicalizeRawTransition(context, before, after, actorUserId, actionKind, event);\n  assertGameStateInvariants(context.engine, {''',
'''  const canonical = canonicalizeRawTransition(context, before, after, actorUserId, actionKind, event);\n  recordPerformanceTransition(context, before, canonical, actorUserId, actionKind);\n  context.engine = canonical;\n  assertGameStateInvariants(context.engine, {''')

patch('src/lib/simulation/game.ts',
'''    forcedAugmentId: resolveAugmentId(options.forcedAugmentId) ?? options.forcedAugmentId,\n    forcedAcquisitionIndex: options.forcedAcquisitionIndex,\n    tokenCounter: 0,\n    actions: 0,\n    s16BasicRollsByUser:''',
'''    forcedAugmentId: resolveAugmentId(options.forcedAugmentId) ?? options.forcedAugmentId,\n    forcedAcquisitionIndex: options.forcedAcquisitionIndex,\n    preserveSelectionRng: Boolean(options.preserveSelectionRng),\n    tokenCounter: 0,\n    actions: 0,\n    performanceByUser: Object.fromEntries(engine.players.map((player) => [player.userId, { rolls: 0, moves: 0, enemyPiecesCaptured: 0, ownPiecesSentToWaiting: 0, piecesFinished: 0 }])),\n    s16BasicRollsByUser:''')

patch('src/lib/simulation/game.ts',
'''  else if (!error && maxRounds != null && context.engine.round > maxRounds) status = "DRAW";''',
'''  else if (!error && maxRounds != null && context.engine.round > maxRounds) status = "LONG_GAME";''')

patch('src/lib/simulation/game.ts',
'''    firstAugmentLeaderCheckpoint: context.firstAugmentLeaderCheckpoint ?? undefined,\n    s16Telemetry: {''',
'''    firstAugmentLeaderCheckpoint: context.firstAugmentLeaderCheckpoint ?? undefined,\n    performanceByUser: structuredClone(context.performanceByUser),\n    s16Telemetry: {''')

patch('src/lib/simulation/game.ts',
'''    failureDiagnostics: status === "STALLED" ? {''',
'''    failureDiagnostics: status === "STALLED" || status === "ACTION_LIMIT" || status === "LONG_GAME" ? {''')

# metrics.ts
patch('src/lib/simulation/metrics.ts',
'''  const completed = results.filter((result) => result.status === "COMPLETED");\n  const draws = results.filter((result) => result.status === "DRAW");\n  const rounds = completed.map((result) => result.round).sort((a, b) => a - b);''',
'''  const completed = results.filter((result) => result.status === "COMPLETED");\n  const draws = results.filter((result) => result.status === "DRAW");\n  const longGames = results.filter((result) => result.status === "LONG_GAME");\n  const rounds = completed.map((result) => result.round).sort((a, b) => a - b);\n  const completedBy15Games = completed.filter((result) => result.round <= 15).length;\n  const completed16To20Games = completed.filter((result) => result.round >= 16 && result.round <= 20).length;\n  const completed21To30Games = completed.filter((result) => result.round >= 21 && result.round <= 30).length;\n  const completedAfter30Games = completed.filter((result) => result.round > 30).length;\n  const durationTerminalGames = completed.length + longGames.length;\n  const over15Games = completed.filter((result) => result.round > 15).length + longGames.length;\n  const over20Games = completed.filter((result) => result.round > 20).length + longGames.length;\n  const over30Games = completed.filter((result) => result.round > 30).length + longGames.length;''')

patch('src/lib/simulation/metrics.ts',
'''  const drawGamesOwnedByAugment = new Map<string, number>();\n  for (const result of draws) {''',
'''  const drawGamesOwnedByAugment = new Map<string, number>();\n  const longGamesOwnedByAugment = new Map<string, number>();\n  const completedOver15OwnedByAugment = new Map<string, number>();\n  const completedOver20OwnedByAugment = new Map<string, number>();\n  const completedOver30OwnedByAugment = new Map<string, number>();\n  const incrementUniqueOwnerAugments = (result: SimulationGameResult, target: Map<string, number>) => {\n    const seen = new Set<string>();\n    for (const acquisition of result.acquisitions) {\n      const key = `${acquisition.userId}\\u0000${acquisition.augmentId}`;\n      if (seen.has(key)) continue;\n      seen.add(key);\n      target.set(acquisition.augmentId, (target.get(acquisition.augmentId) ?? 0) + 1);\n    }\n  };\n  for (const result of completed) {\n    if (result.round > 15) incrementUniqueOwnerAugments(result, completedOver15OwnedByAugment);\n    if (result.round > 20) incrementUniqueOwnerAugments(result, completedOver20OwnedByAugment);\n    if (result.round > 30) incrementUniqueOwnerAugments(result, completedOver30OwnedByAugment);\n  }\n  for (const result of longGames) incrementUniqueOwnerAugments(result, longGamesOwnedByAugment);\n  for (const result of draws) {''')

patch('src/lib/simulation/metrics.ts',
'''  for (const augmentId of drawGamesOwnedByAugment.keys()) {\n    if (byAugment.has(augmentId)) continue;''',
'''  for (const augmentId of new Set([...drawGamesOwnedByAugment.keys(), ...longGamesOwnedByAugment.keys()])) {\n    if (byAugment.has(augmentId)) continue;''')

patch('src/lib/simulation/metrics.ts',
'''    const drawGamesOwned = drawGamesOwnedByAugment.get(augmentId) ?? 0;\n    const terminalGamesOwned = stats.gamesOwned + drawGamesOwned;\n    augmentWinStats[augmentId] = {''',
'''    const drawGamesOwned = drawGamesOwnedByAugment.get(augmentId) ?? 0;\n    const longGameGamesOwned = longGamesOwnedByAugment.get(augmentId) ?? 0;\n    const completedOver15GamesOwned = completedOver15OwnedByAugment.get(augmentId) ?? 0;\n    const completedOver20GamesOwned = completedOver20OwnedByAugment.get(augmentId) ?? 0;\n    const completedOver30GamesOwned = completedOver30OwnedByAugment.get(augmentId) ?? 0;\n    const terminalGamesOwned = stats.gamesOwned + drawGamesOwned + longGameGamesOwned;\n    augmentWinStats[augmentId] = {''')

patch('src/lib/simulation/metrics.ts',
'''      drawGamesOwned,\n      drawRate: rate(drawGamesOwned, terminalGamesOwned),\n      specialWins:''',
'''      drawGamesOwned,\n      drawRate: rate(drawGamesOwned, terminalGamesOwned),\n      longGameGamesOwned,\n      longGameRate: rate(longGameGamesOwned, terminalGamesOwned),\n      completedOver15GamesOwned,\n      completedOver20GamesOwned,\n      completedOver30GamesOwned,\n      over15Rate: rate(completedOver15GamesOwned + longGameGamesOwned, terminalGamesOwned),\n      over20Rate: rate(completedOver20GamesOwned + longGameGamesOwned, terminalGamesOwned),\n      over30Rate: rate(completedOver30GamesOwned + longGameGamesOwned, terminalGamesOwned),\n      specialWins:''')

patch('src/lib/simulation/metrics.ts',
'''    completedGames: completed.length,\n    drawGames: draws.length,\n    stalledGames:''',
'''    completedGames: completed.length,\n    drawGames: draws.length,\n    longGameGames: longGames.length,\n    stalledGames:''')

patch('src/lib/simulation/metrics.ts',
'''    actionLimitGames: results.filter((result) => result.status === "ACTION_LIMIT").length,\n    averageRound,''',
'''    actionLimitGames: results.filter((result) => result.status === "ACTION_LIMIT").length,\n    durationBands: {\n      completedBy15Games,\n      completed16To20Games,\n      completed21To30Games,\n      completedAfter30Games,\n      roundLimitGames: longGames.length,\n      over15Rate: rate(over15Games, durationTerminalGames),\n      over20Rate: rate(over20Games, durationTerminalGames),\n      over30Rate: rate(over30Games, durationTerminalGames),\n    },\n    averageRound,''')

# independent batch diagnostics
patch('scripts/balance-independent-batch.ts',
'''const failOnIncomplete = flag("fail-on-incomplete");''',
'''const failOnIncomplete = flag("fail-on-incomplete");\nconst failOnLongGame = flag("fail-on-long-game");''')
patch('scripts/balance-independent-batch.ts',
'''const incompleteGames = result.summary.stalledGames + result.summary.actionLimitGames;''',
'''const incompleteGames = result.summary.stalledGames + result.summary.actionLimitGames;\nconst longGameGames = result.summary.longGameGames;\nconst problemGames = incompleteGames + longGameGames;''')
patch('scripts/balance-independent-batch.ts',
'''  `- draws: ${result.summary.drawGames.toLocaleString()}`,\n  `- max rounds: ${maxRounds ?? "none"}`,\n  `- stalled: ${result.summary.stalledGames}`,''',
'''  `- draws: ${result.summary.drawGames.toLocaleString()}`,\n  `- long games (round cap): ${longGameGames.toLocaleString()}`,\n  `- >15R rate: ${(result.summary.durationBands.over15Rate * 100).toFixed(2)}%`,\n  `- >20R rate: ${(result.summary.durationBands.over20Rate * 100).toFixed(2)}%`,\n  `- max rounds: ${maxRounds ?? "none"}`,\n  `- stalled: ${result.summary.stalledGames}`,''')
patch('scripts/balance-independent-batch.ts',
'''console.error(`[independent] ${result.summary.completedGames}/${games} completed, ${result.summary.drawGames} draws, ${incompleteGames} incomplete`);''',
'''console.error(`[independent] ${result.summary.completedGames}/${games} completed, ${longGameGames} long, ${incompleteGames} engine-incomplete, ${problemGames} problem games`);''')
patch('scripts/balance-independent-batch.ts',
'''if (failOnIncomplete && incompleteGames > 0) process.exitCode = 1;''',
'''if (failOnIncomplete && incompleteGames > 0) process.exitCode = 1;\nif (failOnLongGame && longGameGames > 0) process.exitCode = 1;''')

# Merge output: expose duration/problem stats without changing balance classification.
patch('scripts/balance-independent-merge.ts',
'''const totalDraws = batches.reduce((sum, batch) => sum + (batch.summary.drawGames ?? 0), 0);\nconst totalIncomplete = batches.reduce((sum, batch) => sum + batch.summary.stalledGames + batch.summary.actionLimitGames, 0);''',
'''const totalDraws = batches.reduce((sum, batch) => sum + (batch.summary.drawGames ?? 0), 0);\nconst totalLongGames = batches.reduce((sum, batch) => sum + (batch.summary.longGameGames ?? 0), 0);\nconst totalIncomplete = batches.reduce((sum, batch) => sum + batch.summary.stalledGames + batch.summary.actionLimitGames, 0);\nconst totalProblemGames = totalLongGames + totalIncomplete;''')

patch('scripts/balance-independent-merge.ts',
'''    drawGamesOwned: number;\n    drawRate: number | null;\n    pooledWinRate:''',
'''    drawGamesOwned: number;\n    drawRate: number | null;\n    longGameGamesOwned: number;\n    longGameRate: number | null;\n    over15Rate: number | null;\n    over20Rate: number | null;\n    pooledWinRate:''')

patch('scripts/balance-independent-merge.ts',
'''    const drawGamesOwned = stats.reduce((sum, stat) => sum + (stat?.drawGamesOwned ?? 0), 0);\n    const terminalGamesOwned = gamesOwned + drawGamesOwned;\n    const drawRate = terminalGamesOwned > 0 ? drawGamesOwned / terminalGamesOwned : null;''',
'''    const drawGamesOwned = stats.reduce((sum, stat) => sum + (stat?.drawGamesOwned ?? 0), 0);\n    const longGameGamesOwned = stats.reduce((sum, stat) => sum + (stat?.longGameGamesOwned ?? 0), 0);\n    const completedOver15GamesOwned = stats.reduce((sum, stat) => sum + (stat?.completedOver15GamesOwned ?? 0), 0);\n    const completedOver20GamesOwned = stats.reduce((sum, stat) => sum + (stat?.completedOver20GamesOwned ?? 0), 0);\n    const terminalGamesOwned = gamesOwned + drawGamesOwned + longGameGamesOwned;\n    const drawRate = terminalGamesOwned > 0 ? drawGamesOwned / terminalGamesOwned : null;\n    const longGameRate = terminalGamesOwned > 0 ? longGameGamesOwned / terminalGamesOwned : null;\n    const over15Rate = terminalGamesOwned > 0 ? (completedOver15GamesOwned + longGameGamesOwned) / terminalGamesOwned : null;\n    const over20Rate = terminalGamesOwned > 0 ? (completedOver20GamesOwned + longGameGamesOwned) / terminalGamesOwned : null;''')

patch('scripts/balance-independent-merge.ts',
'''      drawGamesOwned,\n      drawRate,\n      pooledWinRate:''',
'''      drawGamesOwned,\n      drawRate,\n      longGameGamesOwned,\n      longGameRate,\n      over15Rate,\n      over20Rate,\n      pooledWinRate:''')

patch('scripts/balance-independent-merge.ts',
'''  return `${pct(cell.pooledWinRate)} (${delta}, decisive n=${cell.gamesOwned})<br>draw ${pct(cell.drawRate)} (n=${cell.drawGamesOwned})<br>${batchRates}<br>spread ${spread}`;''',
'''  return `${pct(cell.pooledWinRate)} (${delta}, decisive n=${cell.gamesOwned})<br>>15R ${pct(cell.over15Rate)} · >20R ${pct(cell.over20Rate)} · 30R cap ${pct(cell.longGameRate)} (n=${cell.longGameGamesOwned})<br>${batchRates}<br>spread ${spread}`;''')

patch('scripts/balance-independent-merge.ts',
'''  `- 무승부: ${totalDraws.toLocaleString()}판`,\n  `- 미완료 게임: ${totalIncomplete.toLocaleString()}판`,''',
'''  `- 규칙상 무승부: ${totalDraws.toLocaleString()}판`,\n  `- 30R 초과 장기게임: ${totalLongGames.toLocaleString()}판`,\n  `- 엔진 미완료(STALLED/ACTION_LIMIT): ${totalIncomplete.toLocaleString()}판`,\n  `- 문제게임 합계: ${totalProblemGames.toLocaleString()}판`,''')

patch('scripts/balance-independent-merge.ts',
'''    .map((batch) => `- ${batch.metadata.playerCount}P #${batch.metadata.batchId}: seeds ${batch.metadata.seedStart}–${batch.metadata.seedEnd}, ${batch.metadata.elapsedSeconds.toFixed(1)}s, completed ${batch.summary.completedGames}/${batch.metadata.games}, draws ${batch.summary.drawGames ?? 0}`),''',
'''    .map((batch) => `- ${batch.metadata.playerCount}P #${batch.metadata.batchId}: seeds ${batch.metadata.seedStart}–${batch.metadata.seedEnd}, ${batch.metadata.elapsedSeconds.toFixed(1)}s, completed ${batch.summary.completedGames}/${batch.metadata.games}, >15R ${(batch.summary.durationBands.over15Rate * 100).toFixed(2)}%, >20R ${(batch.summary.durationBands.over20Rate * 100).toFixed(2)}%, 30R cap ${batch.summary.longGameGames ?? 0}`),''')

patch('scripts/balance-independent-merge.ts',
'''  totalDraws,\n  totalIncomplete,''',
'''  totalDraws,\n  totalLongGames,\n  totalIncomplete,\n  totalProblemGames,''')

print('balance diagnostics migration applied')
