from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:220]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# Batch 9 intentionally contains only A07 폭탄!.
replace_once(
    "src/lib/augments/catalog.ts",
    '''  { id: "A06", name: "금빛 아수라장", tier: "gold", description: "무작위 Prism 증강 1개를 즉시 획득합니다." },\n''',
    '''  { id: "A06", name: "금빛 아수라장", tier: "gold", description: "무작위 Prism 증강 1개를 즉시 획득합니다." },\n  { id: "A07", name: "폭탄!", tier: "prism", timing: "first", description: "7라운드 종료 시 판 위의 모든 말을 대기로 돌려보냅니다. 상대 묶음 수에 따라 인원별 기준으로 추가 던지기를 얻습니다." },\n''',
)

replace_once(
    "src/lib/game/types.ts",
    '''  gravityExplosionResolved?: boolean;\n''',
    '''  gravityExplosionResolved?: boolean;\n  bombResolved?: boolean;\n  bombBonusRollsPending?: number;\n''',
)

# Simultaneous A07 resolution. Every bomb owner counts opponent groups from the same pre-reset snapshot,
# then the board is reset once. These are special capture judgments only: no ordinary capture hooks fire.
replace_once(
    "src/lib/game/engine.ts",
    '''export function wormholeIsOpen(engine: GameEngineState, userId: string, ownedIds: string[]) {\n''',
    '''export function applyBombExplosion(\n  engineInput: GameEngineState,\n  bombOwnerUserIds: string[],\n  ownedByUser: Record<string, string[]>,\n): { engine: GameEngineState; caughtGroupsByUser: Record<string, number>; bonusRollsByUser: Record<string, number> } {\n  const engine = clone(engineInput);\n  const caughtGroupsByUser: Record<string, number> = {};\n  const bonusRollsByUser: Record<string, number> = {};\n  const playerCount = engine.players.length;\n  const divisor = playerCount === 2 ? 1 : playerCount === 3 ? 2 : 3;\n\n  for (const ownerUserId of bombOwnerUserIds) {\n    const groups = new Set<string>();\n    for (const player of engineInput.players) {\n      if (player.userId === ownerUserId) continue;\n      for (const piece of player.pieces) {\n        if (piece.status === "ON_BOARD") groups.add(`${player.userId}:${piece.groupId}`);\n      }\n    }\n    caughtGroupsByUser[ownerUserId] = groups.size;\n    bonusRollsByUser[ownerUserId] = Math.floor(groups.size / divisor);\n  }\n\n  for (const player of engine.players) {\n    const owned = ownedByUser[player.userId] ?? [];\n    const boardGroups = new Set(player.pieces.filter((piece) => piece.status === "ON_BOARD").map((piece) => piece.groupId));\n    for (const groupId of boardGroups) {\n      clearGroupMoveFixedToOne(engine, player.userId, groupId);\n      clearJunctionBoostForGroup(engine, player.userId, groupId);\n      clearPathControlForGroup(engine, player.userId, groupId);\n      resetAthleteAccelerationForGroup(engine, player.userId, groupId, owned);\n      clearTurtleLockForGroup(engine, player.userId, groupId);\n      clearPlagueForGroup(engine, player.userId, groupId);\n    }\n    for (const piece of player.pieces) {\n      if (piece.status !== "ON_BOARD") continue;\n      piece.status = "WAITING";\n      piece.node = null;\n      piece.groupId = piece.id;\n    }\n  }\n\n  for (const ownerUserId of bombOwnerUserIds) {\n    const runtime = runtimeForWormhole(engine, ownerUserId);\n    runtime.bombResolved = true;\n    runtime.bombBonusRollsPending = (runtime.bombBonusRollsPending ?? 0) + (bonusRollsByUser[ownerUserId] ?? 0);\n  }\n\n  const labels = bombOwnerUserIds.map((ownerUserId) => {\n    const player = engine.players.find((candidate) => candidate.userId === ownerUserId);\n    return `${player?.displayName ?? ownerUserId} ${caughtGroupsByUser[ownerUserId] ?? 0}묶음`;\n  });\n  engine.lastAction = `폭탄! · 판 위의 말을 대기로 복귀 · ${labels.join(" / ")}`;\n  return { engine, caughtGroupsByUser, bonusRollsByUser };\n}\n\nexport function wormholeIsOpen(engine: GameEngineState, userId: string, ownedIds: string[]) {\n''',
)

# Simulation: trigger once immediately after Round 7 has ended (engine.round becomes 8), then
# deliver each owner's bonus rolls on that owner's next basic-turn window.
replace_once(
    "src/lib/simulation/game.ts",
    '''  applyGrandUnity,\n  applyGravityExplosion,\n''',
    '''  applyBombExplosion,\n  applyGrandUnity,\n  applyGravityExplosion,\n''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''function maybeApplyGravityExplosion(context: SimulationContext) {\n''',
    '''function maybeApplyBombExplosion(context: SimulationContext) {\n  if (context.engine.round < 8) return false;\n  const owners = context.engine.players\n    .filter((player) => (context.ownedByUser[player.userId] ?? []).includes("A07"))\n    .filter((player) => !context.engine.augmentRuntime?.[player.userId]?.bombResolved)\n    .map((player) => player.userId);\n  if (!owners.length) return false;\n  const before = context.engine;\n  const result = applyBombExplosion(before, owners, context.ownedByUser);\n  context.engine = applyPassiveSpecialWinner(result.engine, context.ownedByUser);\n  commitTransition(context, before, context.engine, owners[0], "augment_event");\n  return true;\n}\n\nfunction injectBombBonusRolls(engineInput: GameEngineState, userId: string, ownedIds: string[]) {\n  if (!ownedIds.includes("A07") || engineInput.stage !== "AWAITING_ROLL") return engineInput;\n  const pending = engineInput.augmentRuntime?.[userId]?.bombBonusRollsPending ?? 0;\n  if (pending <= 0) return engineInput;\n  const engine = structuredClone(engineInput);\n  engine.augmentRuntime ??= {};\n  engine.augmentRuntime[userId] ??= {};\n  engine.augmentRuntime[userId].bombBonusRollsPending = 0;\n  for (let index = 0; index < pending; index += 1) engine.pendingRolls.push("AUGMENT");\n  return engine;\n}\n\nfunction maybeApplyGravityExplosion(context: SimulationContext) {\n''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''  if (applyDueAugmentEvents(context)) return;\n  if (context.engine.winnerUserId) return;\n  if (maybeApplyGravityExplosion(context)) return;\n''',
    '''  if (applyDueAugmentEvents(context)) return;\n  if (context.engine.winnerUserId) return;\n  if (maybeApplyBombExplosion(context)) return;\n  if (context.engine.winnerUserId) return;\n  if (maybeApplyGravityExplosion(context)) return;\n''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''  const actorBeforeInjection = currentPlayer(context.engine);\n  if (context.engine.stage !== "CAPTURE_CHOICE") {\n    context.engine = injectTomorrowResult(context.engine, actorBeforeInjection.userId, actorOwned(context, actorBeforeInjection.userId));\n  }\n''',
    '''  const actorBeforeInjection = currentPlayer(context.engine);\n  if (context.engine.stage !== "CAPTURE_CHOICE") {\n    context.engine = injectBombBonusRolls(context.engine, actorBeforeInjection.userId, actorOwned(context, actorBeforeInjection.userId));\n    context.engine = injectTomorrowResult(context.engine, actorBeforeInjection.userId, actorOwned(context, actorBeforeInjection.userId));\n  }\n''',
)

print("Applied ideas batch 9: A07 Bomb simultaneous Round-7 reset and owner-specific bonus rolls.")
