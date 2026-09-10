from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:220]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# Batch 11 intentionally contains only A02 뽑기 기계.
replace_once(
    "src/lib/augments/catalog.ts",
    '''  { id: "A01", name: "중력 폭발", tier: "prism", description: "첫 증강에서 얻으면 8라운드 후, 두 번째 증강에서 얻으면 4라운드 후 판 위의 모든 말을 내부 경로의 무작위 칸으로 강제 이동시킵니다." },\n''',
    '''  { id: "A01", name: "중력 폭발", tier: "prism", description: "첫 증강에서 얻으면 8라운드 후, 두 번째 증강에서 얻으면 4라운드 후 판 위의 모든 말을 내부 경로의 무작위 칸으로 강제 이동시킵니다." },\n  { id: "A02", name: "뽑기 기계", tier: "prism", description: "2라운드마다 판 위의 내 말 또는 상대 말 1기를 골라 원하는 칸으로 이동을 시도합니다. 40%는 지정 칸, 60%는 다른 무작위 칸으로 이동하며 강제 이동 순간 잡기는 발생하지 않습니다." },\n''',
)

replace_once(
    "src/lib/game/types.ts",
    '''  bombBonusRollsPending?: number;\n''',
    '''  bombBonusRollsPending?: number;\n  gachaNextUseRound?: number;\n''',
)

# A02 moves one physical ON_BOARD piece, not an entire stack. A stacked target is detached from
# its group; the remaining group keeps group-scoped runtime state. The teleported piece never
# captures or auto-stacks at the landing node.
replace_once(
    "src/lib/game/engine.ts",
    '''const UPHEAVAL_BOARD_NODES = Array.from({ length: 29 }, (_, index) => index + 1);\n''',
    '''const GACHA_BOARD_NODES = Array.from({ length: 29 }, (_, index) => index + 1);\n\nexport function armGachaMachineOnAcquisition(engine: GameEngineState, userId: string) {\n  const runtime = runtimeForWormhole(engine, userId);\n  runtime.gachaNextUseRound = engine.round + 2;\n}\n\nexport function gachaMachineIsReady(engine: GameEngineState, userId: string, ownedIds: string[]) {\n  if (!ownedIds.includes("A02")) return false;\n  const nextUseRound = engine.augmentRuntime?.[userId]?.gachaNextUseRound;\n  return nextUseRound != null && engine.round >= nextUseRound;\n}\n\nfunction clearGachaSingletonRuntime(engine: GameEngineState, userId: string, groupId: string) {\n  clearGroupMoveFixedToOne(engine, userId, groupId);\n  clearJunctionBoostForGroup(engine, userId, groupId);\n  clearPathControlForGroup(engine, userId, groupId);\n  const runtime = engine.augmentRuntime?.[userId];\n  if (!runtime) return;\n  delete runtime.sanctuaryGroups?.[groupId];\n  delete runtime.sanctuaryPassBlocks?.[groupId];\n  delete runtime.alleyBlockades?.[groupId];\n  delete runtime.universeCenterGroups?.[groupId];\n}\n\nexport function applyGachaMachine(\n  engineInput: GameEngineState,\n  sourceUserId: string,\n  targetUserId: string,\n  pieceId: string,\n  desiredNode: number,\n  ownedByUser: Record<string, string[]>,\n  random: () => number = Math.random,\n): { engine: GameEngineState; success: boolean; landedNode: number } {\n  if (engineInput.stage !== "AWAITING_ROLL" || engineInput.pendingRolls[0] !== "BASIC") {\n    throw new Error("뽑기 기계는 기본 던지기 전에 사용할 수 있습니다.");\n  }\n  const actor = currentPlayer(engineInput);\n  const sourceOwned = ownedByUser[sourceUserId] ?? [];\n  if (actor.userId !== sourceUserId) throw new Error("현재 플레이어만 뽑기 기계를 사용할 수 있습니다.");\n  if (!gachaMachineIsReady(engineInput, sourceUserId, sourceOwned)) throw new Error("아직 뽑기 기계를 사용할 수 없습니다.");\n  if (!GACHA_BOARD_NODES.includes(desiredNode)) throw new Error("지정 위치는 판 위의 유효 칸이어야 합니다.");\n\n  const engine = clone(engineInput);\n  const targetPlayer = engine.players.find((player) => player.userId === targetUserId);\n  const piece = targetPlayer?.pieces.find((candidate) => candidate.id === pieceId);\n  if (!targetPlayer || !piece || piece.status !== "ON_BOARD" || piece.node == null) {\n    throw new Error("뽑기 기계로 이동할 판 위의 말을 찾지 못했습니다.");\n  }\n\n  const oldGroupId = piece.groupId;\n  const group = targetPlayer.pieces.filter((candidate) => candidate.status === "ON_BOARD" && candidate.groupId === oldGroupId);\n  resetAthleteAccelerationForGroup(engine, targetUserId, oldGroupId, ownedByUser[targetUserId] ?? []);\n  if (group.length <= 1) {\n    clearGachaSingletonRuntime(engine, targetUserId, oldGroupId);\n  } else if (piece.id === oldGroupId) {\n    const remaining = group.filter((candidate) => candidate.id !== piece.id);\n    const newGroupId = remaining[0]?.id;\n    if (!newGroupId) throw new Error("뽑기 기계 분리 후 남은 묶음을 찾지 못했습니다.");\n    for (const candidate of remaining) candidate.groupId = newGroupId;\n    renameGroupRuntimeKey(engine, targetUserId, oldGroupId, newGroupId);\n  }\n\n  const success = random() < 0.4;\n  let landedNode = desiredNode;\n  if (!success) {\n    const failureNodes = GACHA_BOARD_NODES.filter((node) => node !== desiredNode);\n    const index = Math.min(failureNodes.length - 1, Math.floor(random() * failureNodes.length));\n    landedNode = failureNodes[index] ?? failureNodes[0] ?? desiredNode;\n  }\n\n  piece.status = "ON_BOARD";\n  piece.node = landedNode;\n  piece.groupId = piece.id;\n  piece.hasEntered = true;\n\n  const sourceRuntime = runtimeForWormhole(engine, sourceUserId);\n  sourceRuntime.gachaNextUseRound = engine.round + 2;\n  const source = engine.players.find((player) => player.userId === sourceUserId);\n  engine.lastAction = `${source?.displayName ?? "플레이어"}: 뽑기 기계 · ${success ? "성공" : "실패"} · 말 1기를 ${landedNode}번 칸으로 강제 이동`;\n  return { engine, success, landedNode };\n}\n\nconst UPHEAVAL_BOARD_NODES = Array.from({ length: 29 }, (_, index) => index + 1);\n''',
)

# Simulation integration. The bot uses A02 as a free pre-roll action when its two-round cooldown is ready.
# It prefers advancing its least-progressed own piece to 29; if no useful own target exists, it sends the
# most-progressed opponent piece toward 1.
replace_once(
    "src/lib/simulation/game.ts",
    '''  applyGrandUnity,\n  applyGreatUpheaval,\n''',
    '''  applyGachaMachine,\n  applyGrandUnity,\n  applyGreatUpheaval,\n''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''  applyTurtleAndHarePlacement,\n  armWormholeOnAcquisition,\n''',
    '''  applyTurtleAndHarePlacement,\n  armGachaMachineOnAcquisition,\n  armWormholeOnAcquisition,\n''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''  resolveDueWormholeReturns,\n  wormholeIsOpen,\n''',
    '''  gachaMachineIsReady,\n  resolveDueWormholeReturns,\n  wormholeIsOpen,\n''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''      if (acquiredId === "A08") {\n''',
    '''      if (acquiredId === "A02") armGachaMachineOnAcquisition(context.engine, offer.userId);\n      if (acquiredId === "A08") {\n''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''function maybeUseMarginExit(context: SimulationContext) {\n''',
    '''function maybeUseGachaMachine(context: SimulationContext) {\n  const engine = context.engine;\n  if (engine.stage !== "AWAITING_ROLL" || engine.pendingRolls[0] !== "BASIC") return false;\n  const actor = currentPlayer(engine);\n  const owned = actorOwned(context, actor.userId);\n  if (!gachaMachineIsReady(engine, actor.userId, owned)) return false;\n\n  const ownCandidates = actor.pieces\n    .filter((piece) => piece.status === "ON_BOARD" && piece.node != null && piece.node !== 29)\n    .sort((left, right) => left.pathHistory.length - right.pathHistory.length);\n  const opponentCandidates = engine.players\n    .filter((player) => player.userId !== actor.userId)\n    .flatMap((player) => player.pieces.map((piece) => ({ player, piece })))\n    .filter(({ piece }) => piece.status === "ON_BOARD" && piece.node != null && piece.node !== 1)\n    .sort((left, right) => right.piece.pathHistory.length - left.piece.pathHistory.length);\n\n  const ownTarget = ownCandidates[0];\n  const opponentTarget = opponentCandidates[0];\n  if (!ownTarget && !opponentTarget) return false;\n\n  const ownValue = ownTarget ? Math.max(0, 18 - ownTarget.pathHistory.length) : -1;\n  const opponentValue = opponentTarget ? opponentTarget.piece.pathHistory.length : -1;\n  const targetUserId = opponentValue > ownValue && opponentTarget ? opponentTarget.player.userId : actor.userId;\n  const targetPiece = opponentValue > ownValue && opponentTarget ? opponentTarget.piece : ownTarget;\n  const desiredNode = targetUserId === actor.userId ? 29 : 1;\n  if (!targetPiece) return false;\n\n  const before = context.engine;\n  const result = applyGachaMachine(\n    before,\n    actor.userId,\n    targetUserId,\n    targetPiece.id,\n    desiredNode,\n    context.ownedByUser,\n    context.rng.effect.next,\n  );\n  commitTransition(context, before, result.engine, actor.userId, "augment_event");\n  return true;\n}\n\nfunction maybeUseMarginExit(context: SimulationContext) {\n''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''  if (context.engine.stage === "AWAITING_ROLL") {\n    if (maybeUseWormhole(context)) return;\n''',
    '''  if (context.engine.stage === "AWAITING_ROLL") {\n    if (maybeUseGachaMachine(context)) return;\n    if (maybeUseWormhole(context)) return;\n''',
)

print("Applied ideas batch 11: A02 Gacha Machine two-round targeted/random physical-piece relocation.")
