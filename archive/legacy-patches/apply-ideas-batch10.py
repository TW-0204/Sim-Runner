from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:220]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# Batch 10 intentionally contains only A08 대격변.
replace_once(
    "src/lib/augments/catalog.ts",
    '''  { id: "A07", name: "폭탄!", tier: "prism", timing: "first", description: "7라운드 종료 시 판 위의 모든 말을 대기로 돌려보냅니다. 상대 묶음 수에 따라 인원별 기준으로 추가 던지기를 얻습니다." },\n''',
    '''  { id: "A07", name: "폭탄!", tier: "prism", timing: "first", description: "7라운드 종료 시 판 위의 모든 말을 대기로 돌려보냅니다. 상대 묶음 수에 따라 인원별 기준으로 추가 던지기를 얻습니다." },\n  { id: "A08", name: "대격변", tier: "prism", timing: "last", description: "획득 즉시 모든 플레이어의 모든 말을 대기, 무작위 판 위 위치, 완주 중 하나로 무작위 재배치합니다. 모든 업기는 해제되며 재배치 순간 잡기는 발생하지 않습니다." },\n''',
)

# Global reshuffle. Each physical piece independently picks one of WAITING / ON_BOARD / FINISHED
# with equal probability. ON_BOARD then uniformly picks one of the 29 valid board nodes.
# Existing stacks are broken and temporary off-board transit reservations are cancelled.
replace_once(
    "src/lib/game/engine.ts",
    '''export function applyBombExplosion(\n''',
    '''const UPHEAVAL_BOARD_NODES = Array.from({ length: 29 }, (_, index) => index + 1);\n\nexport function applyGreatUpheaval(\n  engineInput: GameEngineState,\n  sourceUserId: string,\n  ownedByUser: Record<string, string[]>,\n  random: () => number = Math.random,\n): GameEngineState {\n  const engine = clone(engineInput);\n\n  for (const player of engine.players) {\n    const oldGroupIds = new Set(player.pieces.map((piece) => piece.groupId));\n    for (const groupId of oldGroupIds) {\n      clearGroupMoveFixedToOne(engine, player.userId, groupId);\n      clearJunctionBoostForGroup(engine, player.userId, groupId);\n      clearPathControlForGroup(engine, player.userId, groupId);\n      resetAthleteAccelerationForGroup(engine, player.userId, groupId, ownedByUser[player.userId] ?? []);\n    }\n\n    const runtime = engine.augmentRuntime?.[player.userId];\n    if (runtime) {\n      runtime.fixedOneGroups = {};\n      runtime.junctionBoostGroups = {};\n      runtime.sanctuaryGroups = {};\n      runtime.universeCenterGroups = {};\n      runtime.wormholeTransit = {};\n      runtime.marginOriginByPiece = {};\n    }\n\n    for (const piece of player.pieces) {\n      const stateRoll = Math.min(2, Math.floor(random() * 3));\n      piece.groupId = piece.id;\n      piece.pathHistory = [];\n\n      if (stateRoll === 0) {\n        piece.status = "WAITING";\n        piece.node = null;\n        piece.hasEntered = false;\n        continue;\n      }\n\n      if (stateRoll === 1) {\n        const nodeIndex = Math.min(UPHEAVAL_BOARD_NODES.length - 1, Math.floor(random() * UPHEAVAL_BOARD_NODES.length));\n        piece.status = "ON_BOARD";\n        piece.node = UPHEAVAL_BOARD_NODES[nodeIndex] ?? 1;\n        piece.hasEntered = true;\n        continue;\n      }\n\n      piece.status = "FINISHED";\n      piece.node = null;\n      piece.hasEntered = true;\n    }\n  }\n\n  // The reshuffle can itself complete a normal win. If more than one player completes\n  // simultaneously, the A08 owner takes priority, then normal seat order.\n  const orderedPlayers = [...engine.players].sort((left, right) => {\n    if (left.userId === sourceUserId) return -1;\n    if (right.userId === sourceUserId) return 1;\n    return left.seat - right.seat;\n  });\n  for (const player of orderedPlayers) {\n    const owned = ownedByUser[player.userId] ?? [];\n    if (owned.includes("P02") || replacesNormalWinCondition(owned)) continue;\n    if (!player.pieces.every((piece) => piece.status === "FINISHED")) continue;\n    declareWinner(engine, player.userId, "NORMAL", `${player.displayName}: 대격변으로 모든 말이 완주했습니다!`);\n    return engine;\n  }\n\n  const source = engine.players.find((player) => player.userId === sourceUserId);\n  engine.lastAction = `${source?.displayName ?? "플레이어"}: 대격변 · 모든 말의 상태와 위치가 무작위로 재배치되었습니다.`;\n  return engine;\n}\n\nexport function applyBombExplosion(\n''',
)

# Apply immediately when A08 is acquired. timing:last keeps it in the second augment only.
replace_once(
    "src/lib/simulation/game.ts",
    '''  applyBombExplosion,\n  applyGrandUnity,\n''',
    '''  applyBombExplosion,\n  applyGrandUnity,\n  applyGreatUpheaval,\n''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''      if (acquiredId === "A13") armWormholeOnAcquisition(context.engine, offer.userId);\n''',
    '''      if (acquiredId === "A08") {\n        const beforeUpheaval = context.engine;\n        const afterUpheaval = applyGreatUpheaval(\n          beforeUpheaval,\n          offer.userId,\n          context.ownedByUser,\n          context.rng.effect.next,\n        );\n        commitTransition(context, beforeUpheaval, afterUpheaval, offer.userId, "augment_event");\n      }\n      if (acquiredId === "A13") armWormholeOnAcquisition(context.engine, offer.userId);\n''',
)

print("Applied ideas batch 10: A08 Great Upheaval immediate global state and position reshuffle.")
