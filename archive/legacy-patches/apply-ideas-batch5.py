from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:220]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# Batch 5 intentionally contains only A15 토끼와 거북이.
# Gold is a test-only placement until balance review.
replace_once(
    "src/lib/augments/catalog.ts",
    '''  { id: "A13", name: "웜홀", tier: "prism", description: "획득 직후와 이후 2라운드마다, 자신의 기본 던지기 대신 판 위의 말 한 묶음을 웜홀에 보낼 수 있습니다. 1라운드 후 진행 방향 기준 3~18칸 앞의 무작위 유효 위치에 나타납니다." },\n];''',
    '''  { id: "A13", name: "웜홀", tier: "prism", description: "획득 직후와 이후 2라운드마다, 자신의 기본 던지기 대신 판 위의 말 한 묶음을 웜홀에 보낼 수 있습니다. 1라운드 후 진행 방향 기준 3~18칸 앞의 무작위 유효 위치에 나타납니다." },\n  { id: "A15", name: "토끼와 거북이", tier: "gold", timing: "first", description: "대기 중인 자신의 말 1기를 완주 바로 앞 칸으로 보냅니다. 그 말은 2라운드 동안 이동하거나 업을 수 없지만 상대에게 잡힐 수 있습니다." },\n];''',
)

replace_once(
    "src/lib/game/types.ts",
    '''  wormholeTransit?: Record<string, { returnRound: number; originNode: number; pieceIds: string[] }>;\n''',
    '''  wormholeTransit?: Record<string, { returnRound: number; originNode: number; pieceIds: string[] }>;\n  turtleLockedUntilRoundByPiece?: Record<string, number>;\n''',
)

replace_once(
    "src/lib/augments/effects.ts",
    '''export function isGroupUsableWithAugments(\n  engine: GameEngineState,\n  userId: string,\n  groupId: string,\n  ownedIds: string[],\n  setups: PlayerAugmentSetups = {},\n) {\n  if (!has(ownedIds, "P14")) return true;\n''',
    '''export function isTurtleGroupLocked(engine: GameEngineState, userId: string, groupId: string) {\n  const locks = engine.augmentRuntime?.[userId]?.turtleLockedUntilRoundByPiece;\n  if (!locks) return false;\n  const player = engine.players.find((candidate) => candidate.userId === userId);\n  return Boolean(player?.pieces.some((piece) => (\n    piece.groupId === groupId\n    && piece.status === "ON_BOARD"\n    && (locks[piece.id] ?? 0) > engine.round\n  )));\n}\n\nexport function clearTurtleLockForGroup(engine: GameEngineState, userId: string, groupId: string) {\n  const locks = engine.augmentRuntime?.[userId]?.turtleLockedUntilRoundByPiece;\n  const player = engine.players.find((candidate) => candidate.userId === userId);\n  if (!locks || !player) return;\n  for (const piece of player.pieces) {\n    if (piece.groupId === groupId) delete locks[piece.id];\n  }\n}\n\nexport function isGroupUsableWithAugments(\n  engine: GameEngineState,\n  userId: string,\n  groupId: string,\n  ownedIds: string[],\n  setups: PlayerAugmentSetups = {},\n) {\n  if (isTurtleGroupLocked(engine, userId, groupId)) return false;\n  if (!has(ownedIds, "P14")) return true;\n''',
)

replace_once(
    "src/lib/game/engine.ts",
    '''  clearPathControlForGroup,\n  consumeAlleyBlockade,\n''',
    '''  clearPathControlForGroup,\n  clearTurtleLockForGroup,\n  consumeAlleyBlockade,\n''',
)
replace_once(
    "src/lib/game/engine.ts",
    '''  isGroupUsableWithAugments,\n  isSanctuaryGroup,\n''',
    '''  isGroupUsableWithAugments,\n  isSanctuaryGroup,\n  isTurtleGroupLocked,\n''',
)
replace_once(
    "src/lib/game/engine.ts",
    '''export function armWormholeOnAcquisition(engine: GameEngineState, userId: string) {\n  const runtime = runtimeForWormhole(engine, userId);\n  runtime.wormholeNextOpenRound = engine.round;\n}\n''',
    '''export function armWormholeOnAcquisition(engine: GameEngineState, userId: string) {\n  const runtime = runtimeForWormhole(engine, userId);\n  runtime.wormholeNextOpenRound = engine.round;\n}\n\nexport function applyTurtleAndHarePlacement(\n  engineInput: GameEngineState,\n  userId: string,\n  pieceId: string,\n): GameEngineState {\n  const engine = clone(engineInput);\n  const player = engine.players.find((candidate) => candidate.userId === userId);\n  const piece = player?.pieces.find((candidate) => candidate.id === pieceId);\n  if (!player || !piece) throw new Error("토끼와 거북이 대상 말을 찾지 못했습니다.");\n  if (piece.status !== "WAITING") throw new Error("토끼와 거북이는 대기 중인 말만 선택할 수 있습니다.");\n\n  piece.status = "ON_BOARD";\n  piece.node = 29;\n  piece.groupId = piece.id;\n  piece.hasEntered = true;\n  piece.pathHistory = [29];\n\n  engine.augmentRuntime ??= {};\n  engine.augmentRuntime[userId] ??= {};\n  const runtime = engine.augmentRuntime[userId];\n  runtime.turtleLockedUntilRoundByPiece ??= {};\n  runtime.turtleLockedUntilRoundByPiece[piece.id] = engine.round + 2;\n  engine.lastAction = `${player.displayName}: 토끼와 거북이 · 말 1기를 완주 바로 앞 칸에 배치했습니다.`;\n  return engine;\n}\n''',
)
replace_once(
    "src/lib/game/engine.ts",
    '''    clearPathControlForGroup(engine, victim.ownerUserId, victim.groupId);\n    resetAthleteAccelerationForGroup(engine, victim.ownerUserId, victim.groupId, victimOwned);\n\n    returnPiecesAfterEnemyCapture(capturedGroup, victimOwned);\n''',
    '''    clearPathControlForGroup(engine, victim.ownerUserId, victim.groupId);\n    resetAthleteAccelerationForGroup(engine, victim.ownerUserId, victim.groupId, victimOwned);\n    clearTurtleLockForGroup(engine, victim.ownerUserId, victim.groupId);\n\n    returnPiecesAfterEnemyCapture(capturedGroup, victimOwned);\n''',
)
replace_once(
    "src/lib/game/engine.ts",
    '''  return [...new Set(\n    player.pieces\n      .filter((piece) => piece.status === "ON_BOARD" && piece.node === destination && piece.groupId !== movingGroupId)\n      .map((piece) => piece.groupId),\n  )];\n''',
    '''  return [...new Set(\n    player.pieces\n      .filter((piece) => piece.status === "ON_BOARD" && piece.node === destination && piece.groupId !== movingGroupId)\n      .map((piece) => piece.groupId),\n  )].filter((groupId) => !isTurtleGroupLocked(engine, moverUserId, groupId));\n''',
)
replace_once(
    "src/lib/game/engine.ts",
    '''  for (const [groupId, pieces] of groups) {\n    if (groupId === movingGroupId || !pieces.length) continue;\n''',
    '''  for (const [groupId, pieces] of groups) {\n    if (groupId === movingGroupId || !pieces.length) continue;\n    if (isTurtleGroupLocked(engine, userId, groupId)) continue;\n''',
)
replace_once(
    "src/lib/game/engine.ts",
    '''  const groups = playerBoardGroups(engine, player.userId);\n  if (groups.size < 2) throw new Error("말판 위에 모을 다른 묶음이 필요합니다.");\n''',
    '''  const groups = playerBoardGroups(engine, player.userId);\n  for (const groupId of [...groups.keys()]) {\n    if (isTurtleGroupLocked(engine, player.userId, groupId)) groups.delete(groupId);\n  }\n  if (groups.size < 2) throw new Error("말판 위에 모을 다른 묶음이 필요합니다.");\n''',
)

replace_once(
    "src/lib/game/capture-choice.ts",
    '''  clearPathControlForGroup,\n  isCaptureImmune,\n''',
    '''  clearPathControlForGroup,\n  clearTurtleLockForGroup,\n  isCaptureImmune,\n''',
)
replace_once(
    "src/lib/game/capture-choice.ts",
    '''  clearPathControlForGroup(engine, target.victimUserId, target.victimGroupId);\n  resetAthleteAccelerationForGroup(engine, target.victimUserId, target.victimGroupId, victimOwned);\n  returnPiecesAfterEnemyCapture(pieces, victimOwned);\n''',
    '''  clearPathControlForGroup(engine, target.victimUserId, target.victimGroupId);\n  resetAthleteAccelerationForGroup(engine, target.victimUserId, target.victimGroupId, victimOwned);\n  clearTurtleLockForGroup(engine, target.victimUserId, target.victimGroupId);\n  returnPiecesAfterEnemyCapture(pieces, victimOwned);\n''',
)

replace_once(
    "src/lib/simulation/game.ts",
    '''  applyWormholeTurn,\n  armWormholeOnAcquisition,\n''',
    '''  applyWormholeTurn,\n  applyTurtleAndHarePlacement,\n  armWormholeOnAcquisition,\n''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''      if (acquiredId === "A13") armWormholeOnAcquisition(context.engine, offer.userId);\n      if (acquiredId === "A10") {\n''',
    '''      if (acquiredId === "A13") armWormholeOnAcquisition(context.engine, offer.userId);\n      if (acquiredId === "A15") {\n        const owner = context.engine.players.find((candidate) => candidate.userId === offer.userId);\n        const waiting = owner?.pieces.filter((piece) => piece.status === "WAITING") ?? [];\n        if (waiting.length) {\n          const target = waiting[context.rng.effect.int(waiting.length)] ?? waiting[0];\n          context.engine = applyTurtleAndHarePlacement(context.engine, offer.userId, target.id);\n        }\n      }\n      if (acquiredId === "A10") {\n''',
)

print("Applied ideas batch 5: A15 Turtle and Hare placement and two-round freeze.")
