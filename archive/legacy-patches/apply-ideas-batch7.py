from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:220]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# Batch 7 intentionally contains only A14 역병.
replace_once(
    "src/lib/augments/catalog.ts",
    '''  { id: "A15", name: "토끼와 거북이", tier: "gold", timing: "first", description: "대기 중인 자신의 말 1기를 완주 바로 앞 칸으로 보냅니다. 그 말은 2라운드 동안 이동하거나 업을 수 없지만 상대에게 잡힐 수 있습니다." },\n''',
    '''  { id: "A14", name: "역병", tier: "gold", description: "자신의 말은 상대를 잡는 대신 감염시킵니다. 감염된 말은 전진 이동량이 -2칸 감소하며, 보정 후 0 이하가 되면 대기로 돌아갑니다." },\n  { id: "A15", name: "토끼와 거북이", tier: "gold", timing: "first", description: "대기 중인 자신의 말 1기를 완주 바로 앞 칸으로 보냅니다. 그 말은 2라운드 동안 이동하거나 업을 수 없지만 상대에게 잡힐 수 있습니다." },\n''',
)

replace_once(
    "src/lib/game/types.ts",
    '''  marginSentTurnNumber?: number;\n''',
    '''  marginSentTurnNumber?: number;\n  plaguePieceIds?: Record<string, boolean>;\n''',
)

# Physical-piece infection state; a stacked group is slowed once if any member is infected.
replace_once(
    "src/lib/augments/effects.ts",
    '''export function adjustedResultForGroup(\n''',
    '''export function isPlagueGroup(engine: GameEngineState, userId: string, groupId: string) {\n  const infected = engine.augmentRuntime?.[userId]?.plaguePieceIds;\n  if (!infected) return false;\n  const player = engine.players.find((candidate) => candidate.userId === userId);\n  return Boolean(player?.pieces.some((piece) => (\n    piece.groupId === groupId\n    && (piece.status === "WAITING" || piece.status === "ON_BOARD")\n    && infected[piece.id]\n  )));\n}\n\nexport function infectPlagueGroup(engine: GameEngineState, userId: string, groupId: string) {\n  const player = engine.players.find((candidate) => candidate.userId === userId);\n  if (!player) return;\n  const runtime = runtimeForPlayer(engine, userId);\n  runtime.plaguePieceIds ??= {};\n  for (const piece of player.pieces) {\n    if (piece.groupId === groupId && piece.status === "ON_BOARD") runtime.plaguePieceIds[piece.id] = true;\n  }\n}\n\nexport function clearPlagueForGroup(engine: GameEngineState, userId: string, groupId: string) {\n  const infected = engine.augmentRuntime?.[userId]?.plaguePieceIds;\n  const player = engine.players.find((candidate) => candidate.userId === userId);\n  if (!infected || !player) return;\n  for (const piece of player.pieces) {\n    if (piece.groupId === groupId) delete infected[piece.id];\n  }\n}\n\nexport function adjustedResultForGroup(\n''',
)
replace_once(
    "src/lib/augments/effects.ts",
    '''  const forbidShortcuts = has(ownedIds, "P10");\n  if (isGroupMoveFixedToOne(engine, userId, groupId)) {\n    return { ...result, finalSteps: result.face === "BACKDO" ? -1 : 1, forbidShortcuts };\n  }\n  if (result.suppressMovementBonuses) {\n    return forbidShortcuts && !result.forbidShortcuts ? { ...result, forbidShortcuts: true } : result;\n  }\n  const bonus = movementBonusForGroup(engine, userId, groupId, result, ownedIds, setups);\n  if (bonus === 0 && !forbidShortcuts) return result;\n  return { ...result, finalSteps: result.finalSteps + bonus, forbidShortcuts };\n''',
    '''  const forbidShortcuts = has(ownedIds, "P10");\n  const plaguePenalty = result.face === "BACKDO" || !isPlagueGroup(engine, userId, groupId) ? 0 : 2;\n  if (isGroupMoveFixedToOne(engine, userId, groupId)) {\n    return { ...result, finalSteps: result.face === "BACKDO" ? -1 : 1 - plaguePenalty, forbidShortcuts };\n  }\n  if (result.suppressMovementBonuses) {\n    const finalSteps = result.finalSteps - plaguePenalty;\n    if (plaguePenalty === 0 && (!forbidShortcuts || result.forbidShortcuts)) return result;\n    return { ...result, finalSteps, forbidShortcuts: forbidShortcuts || result.forbidShortcuts };\n  }\n  const bonus = movementBonusForGroup(engine, userId, groupId, result, ownedIds, setups);\n  if (bonus === 0 && plaguePenalty === 0 && !forbidShortcuts) return result;\n  return { ...result, finalSteps: result.finalSteps + bonus - plaguePenalty, forbidShortcuts };\n''',
)

# Engine capture and movement integration.
replace_once(
    "src/lib/game/engine.ts",
    '''  clearPathControlForGroup,\n  clearTurtleLockForGroup,\n''',
    '''  clearPathControlForGroup,\n  clearPlagueForGroup,\n  clearTurtleLockForGroup,\n''',
)
replace_once(
    "src/lib/game/engine.ts",
    '''  isGroupUsableWithAugments,\n  isSanctuaryGroup,\n  isTurtleGroupLocked,\n''',
    '''  infectPlagueGroup,\n  isGroupUsableWithAugments,\n  isPlagueGroup,\n  isSanctuaryGroup,\n  isTurtleGroupLocked,\n''',
)

# If an already-adjusted forward result is <=0 because of plague, expose one forced action so bots/UIs can resolve the forced return.
replace_once(
    "src/lib/game/engine.ts",
    '''export function legalMoveTargetsWithAugments(\n  engine: GameEngineState,\n  userId: string,\n  piece: PieceState,\n  result: RollToken,\n  ownedIds: string[],\n  ownedByUser: Record<string, string[]> = {},\n): EngineMoveTarget[] {\n  if (ownedIds.includes("P02")) {\n''',
    '''export function legalMoveTargetsWithAugments(\n  engine: GameEngineState,\n  userId: string,\n  piece: PieceState,\n  result: RollToken,\n  ownedIds: string[],\n  ownedByUser: Record<string, string[]> = {},\n): EngineMoveTarget[] {\n  if (result.face !== "BACKDO" && result.finalSteps <= 0 && isPlagueGroup(engine, userId, piece.groupId)) {\n    return [{ node: null, finished: false, kind: "FORCED", path: [] }];\n  }\n  if (ownedIds.includes("P02")) {\n''',
)

# A14 replaces captures with infection at the landing cell. Capture immunity does not block infection because this is not a capture.
replace_once(
    "src/lib/game/engine.ts",
    '''  let captureExtraRollCount = 0;\n  let attackerReturned = false;\n\n  for (const capturedGroup of opponentGroupsAtNode(engine, mover.userId, node)) {\n''',
    '''  let captureExtraRollCount = 0;\n  let attackerReturned = false;\n  const moverOwned = ownedByUser[mover.userId] ?? [];\n\n  for (const capturedGroup of opponentGroupsAtNode(engine, mover.userId, node)) {\n''',
)
replace_once(
    "src/lib/game/engine.ts",
    '''    const victimOwned = ownedByUser[victim.ownerUserId] ?? [];\n    if (isSanctuaryGroup(engine, victim.ownerUserId, victim.groupId, node)) continue;\n''',
    '''    const victimOwned = ownedByUser[victim.ownerUserId] ?? [];\n    if (moverOwned.includes("A14")) {\n      infectPlagueGroup(engine, victim.ownerUserId, victim.groupId);\n      continue;\n    }\n    if (isSanctuaryGroup(engine, victim.ownerUserId, victim.groupId, node)) continue;\n''',
)
replace_once(
    "src/lib/game/engine.ts",
    '''    returnPiecesAfterEnemyCapture(capturedGroup, victimOwned);\n''',
    '''    if (isPlagueGroup(engine, victim.ownerUserId, victim.groupId)) {\n      infectPlagueGroup(engine, mover.userId, movingGroupId);\n    }\n    clearPlagueForGroup(engine, victim.ownerUserId, victim.groupId);\n    returnPiecesAfterEnemyCapture(capturedGroup, victimOwned);\n''',
)

# Plague makes Cleaner capture behavior inert for its owner; A14 only infects at the actual destination.
replace_once(
    "src/lib/game/engine.ts",
    '''  const cleanerWasActive = isCleanerActive(engine, mover.userId, ownedIds);\n''',
    '''  const cleanerWasActive = isCleanerActive(engine, mover.userId, ownedIds) && !ownedIds.includes("A14");\n''',
)

# A plague-adjusted move of 0 or less sends the whole current stack to waiting and clears infection; this is not a capture.
replace_once(
    "src/lib/game/engine.ts",
    '''  const effectiveResult = adjustedMoonwalkResult(engine, mover.userId, args.groupId, result, ownedIds, setups);\n  const cleanerWasActive = isCleanerActive(engine, mover.userId, ownedIds) && !ownedIds.includes("A14");\n''',
    '''  const effectiveResult = adjustedMoonwalkResult(engine, mover.userId, args.groupId, result, ownedIds, setups);\n  if (result.face !== "BACKDO" && isPlagueGroup(engine, mover.userId, args.groupId) && effectiveResult.finalSteps <= 0) {\n    engine.results.splice(resultIndex, 1);\n    clearGroupMoveFixedToOne(engine, mover.userId, args.groupId);\n    clearJunctionBoostForGroup(engine, mover.userId, args.groupId);\n    clearPathControlForGroup(engine, mover.userId, args.groupId);\n    resetAthleteAccelerationForGroup(engine, mover.userId, args.groupId, ownedIds);\n    clearPlagueForGroup(engine, mover.userId, args.groupId);\n    for (const piece of group) {\n      piece.status = "WAITING";\n      piece.node = null;\n      piece.groupId = piece.id;\n    }\n    engine.lastAction = `${mover.displayName}: 역병 · 이동량이 0 이하가 되어 대기로 돌아갑니다.`;\n    finishResolvedMove(engine, 0, 0, ownedIds);\n    return engine;\n  }\n  const cleanerWasActive = isCleanerActive(engine, mover.userId, ownedIds) && !ownedIds.includes("A14");\n''',
)

# P08 secondary capture also transfers plague from an infected victim to the attacker, then clears the captured infection.
replace_once(
    "src/lib/game/capture-choice.ts",
    '''  clearPathControlForGroup,\n  clearTurtleLockForGroup,\n''',
    '''  clearPathControlForGroup,\n  clearPlagueForGroup,\n  clearTurtleLockForGroup,\n''',
)
replace_once(
    "src/lib/game/capture-choice.ts",
    '''  isCaptureImmune,\n  isSanctuaryGroup,\n''',
    '''  infectPlagueGroup,\n  isCaptureImmune,\n  isPlagueGroup,\n  isSanctuaryGroup,\n''',
)
replace_once(
    "src/lib/game/capture-choice.ts",
    '''  returnPiecesAfterEnemyCapture(pieces, victimOwned);\n  const attackerOwned = ownedByUser[decision.attackerUserId] ?? [];\n''',
    '''  if (isPlagueGroup(engine, target.victimUserId, target.victimGroupId)) {\n    infectPlagueGroup(engine, decision.attackerUserId, decision.attackerGroupId);\n  }\n  clearPlagueForGroup(engine, target.victimUserId, target.victimGroupId);\n  returnPiecesAfterEnemyCapture(pieces, victimOwned);\n  const attackerOwned = ownedByUser[decision.attackerUserId] ?? [];\n''',
)

print("Applied ideas batch 7: A14 Plague capture replacement, infection, movement penalty, and contagion.")
