from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:220]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# Batch 6 intentionally contains only A16 여백의 미.
replace_once(
    "src/lib/augments/catalog.ts",
    '''  { id: "A15", name: "토끼와 거북이", tier: "gold", timing: "first", description: "대기 중인 자신의 말 1기를 완주 바로 앞 칸으로 보냅니다. 그 말은 2라운드 동안 이동하거나 업을 수 없지만 상대에게 잡힐 수 있습니다." },\n];''',
    '''  { id: "A15", name: "토끼와 거북이", tier: "gold", timing: "first", description: "대기 중인 자신의 말 1기를 완주 바로 앞 칸으로 보냅니다. 그 말은 2라운드 동안 이동하거나 업을 수 없지만 상대에게 잡힐 수 있습니다." },\n  { id: "A16", name: "여백의 미", tier: "gold", description: "자신의 턴에 판 위의 말 1기를 여백으로 피신시킬 수 있습니다. 이동 결과 하나를 소모하면 들어가기 직전 칸으로 돌아오며, 복귀 시 잡기와 업기가 가능합니다." },\n];''',
)

# A16 has a true off-board state, distinct from WAITING and WORMHOLE.
replace_once(
    "src/lib/game/types.ts",
    'export type PieceStatus = "WAITING" | "ON_BOARD" | "WORMHOLE" | "FINISHED";\n',
    'export type PieceStatus = "WAITING" | "ON_BOARD" | "WORMHOLE" | "MARGIN" | "FINISHED";\n',
)
replace_once(
    "src/lib/game/types.ts",
    '''  turtleLockedUntilRoundByPiece?: Record<string, number>;\n''',
    '''  turtleLockedUntilRoundByPiece?: Record<string, number>;\n  marginOriginByPiece?: Record<string, number>;\n  marginSentTurnNumber?: number;\n''',
)

# Simulation group enumeration must ignore margin pieces just like wormhole pieces.
replace_once(
    "src/lib/simulation/game.ts",
    '''    if (piece.status === "WORMHOLE") return false;\n    if (piece.status === "FINISHED" && !allowFinished) return false;\n''',
    '''    if (piece.status === "WORMHOLE" || piece.status === "MARGIN") return false;\n    if (piece.status === "FINISHED" && !allowFinished) return false;\n''',
)

# Engine-level A16 state transitions. A physical piece can leave a stack; the remaining stack retains group-scoped effects.
replace_once(
    "src/lib/game/engine.ts",
    '''export function wormholeIsOpen(engine: GameEngineState, userId: string, ownedIds: string[]) {\n''',
    '''function renameGroupRuntimeKey(engine: GameEngineState, userId: string, oldGroupId: string, newGroupId: string) {\n  if (oldGroupId === newGroupId) return;\n  const runtime = engine.augmentRuntime?.[userId];\n  if (!runtime) return;\n  const remap = <T>(map: Record<string, T> | undefined) => {\n    if (!map || !Object.prototype.hasOwnProperty.call(map, oldGroupId)) return;\n    map[newGroupId] = map[oldGroupId];\n    delete map[oldGroupId];\n  };\n  remap(runtime.fixedOneGroups);\n  remap(runtime.junctionBoostGroups);\n  remap(runtime.sanctuaryGroups);\n  remap(runtime.sanctuaryPassBlocks);\n  remap(runtime.alleyBlockades);\n  remap(runtime.universeCenterGroups);\n}\n\nexport function applyMarginExit(\n  engineInput: GameEngineState,\n  userId: string,\n  pieceId: string,\n  ownedIds: string[],\n): GameEngineState {\n  if (!ownedIds.includes("A16")) throw new Error("여백의 미 증강을 보유하고 있지 않습니다.");\n  if (engineInput.stage !== "AWAITING_ROLL" && engineInput.stage !== "MOVING") {\n    throw new Error("현재 단계에서는 여백으로 보낼 수 없습니다.");\n  }\n  const actor = currentPlayer(engineInput);\n  if (actor.userId !== userId) throw new Error("현재 플레이어의 말만 여백으로 보낼 수 있습니다.");\n\n  const engine = clone(engineInput);\n  const player = currentPlayer(engine);\n  const runtime = runtimeForWormhole(engine, userId);\n  if (runtime.marginSentTurnNumber === engine.turnNumber) throw new Error("한 턴에는 말 1기만 여백으로 보낼 수 있습니다.");\n  const piece = player.pieces.find((candidate) => candidate.id === pieceId);\n  if (!piece || piece.status !== "ON_BOARD" || piece.node == null) throw new Error("여백으로 보낼 판 위의 말을 찾지 못했습니다.");\n  if (isTurtleGroupLocked(engine, userId, piece.groupId)) throw new Error("토끼와 거북이로 이동 제한 중인 말은 여백으로 보낼 수 없습니다.");\n\n  const originNode = piece.node;\n  const oldGroupId = piece.groupId;\n  const group = player.pieces.filter((candidate) => candidate.groupId === oldGroupId && candidate.status === "ON_BOARD");\n  resetAthleteAccelerationForGroup(engine, userId, oldGroupId, ownedIds);\n\n  if (group.length <= 1) {\n    clearGroupMoveFixedToOne(engine, userId, oldGroupId);\n    clearJunctionBoostForGroup(engine, userId, oldGroupId);\n    clearPathControlForGroup(engine, userId, oldGroupId);\n  } else if (piece.id === oldGroupId) {\n    const remaining = group.filter((candidate) => candidate.id !== piece.id);\n    const newGroupId = remaining[0]?.id;\n    if (!newGroupId) throw new Error("여백 분리 후 남은 묶음을 찾지 못했습니다.");\n    for (const candidate of remaining) candidate.groupId = newGroupId;\n    renameGroupRuntimeKey(engine, userId, oldGroupId, newGroupId);\n  }\n\n  piece.status = "MARGIN";\n  piece.node = null;\n  piece.groupId = piece.id;\n  runtime.marginOriginByPiece ??= {};\n  runtime.marginOriginByPiece[piece.id] = originNode;\n  runtime.marginSentTurnNumber = engine.turnNumber;\n  engine.lastAction = `${player.displayName}: 여백의 미 · 말 1기를 ${originNode}번 칸에서 여백으로 보냈습니다.`;\n  return engine;\n}\n\nexport function applyMarginReturn(\n  engineInput: GameEngineState,\n  userId: string,\n  pieceId: string,\n  resultId: string,\n  ownedIds: string[],\n  ownedByUser: Record<string, string[]> = {},\n): GameEngineState {\n  if (!ownedIds.includes("A16")) throw new Error("여백의 미 증강을 보유하고 있지 않습니다.");\n  if (engineInput.stage !== "MOVING") throw new Error("이동 결과가 있을 때만 여백에서 복귀할 수 있습니다.");\n  const actor = currentPlayer(engineInput);\n  if (actor.userId !== userId) throw new Error("현재 플레이어의 말만 여백에서 복귀할 수 있습니다.");\n\n  const engine = clone(engineInput);\n  const player = currentPlayer(engine);\n  const runtime = runtimeForWormhole(engine, userId);\n  const piece = player.pieces.find((candidate) => candidate.id === pieceId);\n  const originNode = runtime.marginOriginByPiece?.[pieceId];\n  if (!piece || piece.status !== "MARGIN" || originNode == null) throw new Error("여백에 있는 말을 찾지 못했습니다.");\n\n  const resultIndex = engine.results.findIndex((result) => result.id === resultId);\n  if (resultIndex < 0) throw new Error("복귀에 사용할 이동 결과를 찾지 못했습니다.");\n  const result = engine.results[resultIndex];\n  if (!["DO", "GAE", "GEOL", "YUT", "MO"].includes(result.face) || result.numericPool) {\n    throw new Error("여백 복귀에는 도, 개, 걸, 윷, 모 결과만 사용할 수 있습니다.");\n  }\n  engine.results.splice(resultIndex, 1);\n\n  piece.status = "ON_BOARD";\n  piece.node = originNode;\n  piece.groupId = piece.id;\n  piece.hasEntered = true;\n  delete runtime.marginOriginByPiece?.[pieceId];\n\n  const captures = captureAtNode(engine, piece.groupId, originNode, ownedByUser);\n  recordEnemyCaptures(engine, userId, captures.captureCount, ownedIds);\n  if (captures.attackerReturned) {\n    returnMovingGroupAfterEnemyEffect(engine, userId, piece.groupId, ownedIds);\n    engine.lastAction = `${player.displayName}: 여백의 미 복귀 · ${originNode}번에서 잡기 후 물귀신으로 대기 복귀`;\n    finishResolvedMove(engine, captures.captureExtraRollCount, 0, ownedIds);\n    return engine;\n  }\n\n  armJunctionBoostAtDestination(engine, userId, piece.groupId, originNode, ownedIds);\n  armPathControlAtDestination(engine, userId, piece.groupId, originNode, ownedIds);\n  const alliedGroupIds = alliedGroupsAtDestination(engine, userId, piece.groupId, originNode);\n  const captureText = captures.captureCount > 0 ? ` · 상대 묶음 ${captures.captureCount}개 잡기` : "";\n  engine.lastAction = `${player.displayName}: 여백의 미 · ${originNode}번 칸으로 복귀${captureText}`;\n  if (checkSpecialWinner(engine, ownedIds)) return engine;\n\n  if (alliedGroupIds.length > 0) {\n    engine.stage = "STACK_CHOICE";\n    engine.pendingStackChoice = {\n      movingGroupId: piece.groupId,\n      destination: originNode,\n      alliedGroupIds,\n      captureCount: captures.captureCount,\n      captureExtraRollCount: captures.captureExtraRollCount,\n      augmentExtraRolls: 0,\n    };\n    return engine;\n  }\n  finishResolvedMove(engine, captures.captureExtraRollCount, 0, ownedIds);\n  return engine;\n}\n\nexport function wormholeIsOpen(engine: GameEngineState, userId: string, ownedIds: string[]) {\n''',
)

# Telemetry action names so transitions remain observable.
replace_once(
    "src/lib/simulation/triggers.ts",
    '''  | "ally_capture"\n  | "split";\n''',
    '''  | "ally_capture"\n  | "margin_exit"\n  | "margin_return"\n  | "split";\n''',
)

# Simulation bot: occasionally hide one physical piece, then prioritize bringing a margin piece back with a positive result.
replace_once(
    "src/lib/simulation/game.ts",
    '''  applyGrandUnity,\n  applyMove,\n  applyWormholeTurn,\n  applyTurtleAndHarePlacement,\n''',
    '''  applyGrandUnity,\n  applyMarginExit,\n  applyMarginReturn,\n  applyMove,\n  applyWormholeTurn,\n  applyTurtleAndHarePlacement,\n''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''function maybeUseWormhole(context: SimulationContext) {\n''',
    '''function maybeUseMarginExit(context: SimulationContext) {\n  const engine = context.engine;\n  if (engine.stage !== "AWAITING_ROLL" || engine.pendingRolls[0] !== "BASIC") return false;\n  const actor = currentPlayer(engine);\n  const owned = actorOwned(context, actor.userId);\n  if (!owned.includes("A16")) return false;\n  if (engine.augmentRuntime?.[actor.userId]?.marginSentTurnNumber === engine.turnNumber) return false;\n  const marginCount = actor.pieces.filter((piece) => piece.status === "MARGIN").length;\n  if (marginCount > 0 || context.rng.effect.next() >= 0.35) return false;\n  const candidates = actor.pieces.filter((piece) => (\n    piece.status === "ON_BOARD"\n    && piece.node != null\n    && isGroupUsableWithAugments(engine, actor.userId, piece.groupId, owned, actorSetups(context, actor.userId))\n  ));\n  if (!candidates.length) return false;\n  const target = [...candidates].sort((left, right) => (right.node ?? 0) - (left.node ?? 0))[0];\n  if (!target) return false;\n  const before = context.engine;\n  const next = applyMarginExit(before, actor.userId, target.id, owned);\n  commitTransition(context, before, next, actor.userId, "margin_exit");\n  return true;\n}\n\nfunction maybeReturnMargin(context: SimulationContext, engine: GameEngineState, userId: string) {\n  const owned = actorOwned(context, userId);\n  if (!owned.includes("A16") || engine.stage !== "MOVING") return null;\n  const player = engine.players.find((candidate) => candidate.userId === userId);\n  const margin = player?.pieces.filter((piece) => piece.status === "MARGIN") ?? [];\n  if (!margin.length) return null;\n  const result = [...engine.results]\n    .filter((candidate) => !candidate.numericPool && ["DO", "GAE", "GEOL", "YUT", "MO"].includes(candidate.face))\n    .sort((left, right) => left.finalSteps - right.finalSteps)[0];\n  if (!result) return null;\n  const target = [...margin].sort((left, right) => (\n    (engine.augmentRuntime?.[userId]?.marginOriginByPiece?.[right.id] ?? 0)\n    - (engine.augmentRuntime?.[userId]?.marginOriginByPiece?.[left.id] ?? 0)\n  ))[0];\n  if (!target) return null;\n  return applyMarginReturn(engine, userId, target.id, result.id, owned, context.ownedByUser);\n}\n\nfunction maybeUseWormhole(context: SimulationContext) {\n''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''  if (context.engine.stage === "AWAITING_ROLL") {\n    if (maybeUseWormhole(context)) return;\n    queueA04BonusForNextBasic(context.engine, userId, actorOwned(context, userId));\n''',
    '''  if (context.engine.stage === "AWAITING_ROLL") {\n    if (maybeUseWormhole(context)) return;\n    if (maybeUseMarginExit(context)) return;\n    queueA04BonusForNextBasic(context.engine, userId, actorOwned(context, userId));\n''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''    let before = context.engine;\n    const saved = maybeSaveTomorrow(context, before, userId);\n''',
    '''    let before = context.engine;\n    const marginReturn = maybeReturnMargin(context, before, userId);\n    if (marginReturn) {\n      commitTransition(context, before, marginReturn, userId, "margin_return");\n      return;\n    }\n\n    before = context.engine;\n    const saved = maybeSaveTomorrow(context, before, userId);\n''',
)

print("Applied ideas batch 6: A16 Margin exit, stored origin return, capture, and stacking.")
