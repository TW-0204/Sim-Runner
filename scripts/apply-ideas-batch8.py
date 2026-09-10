from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:220]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# Batch 8 intentionally contains only A01 중력 폭발.
replace_once(
    "src/lib/augments/catalog.ts",
    '''  { id: "A04", name: "강해져서 돌아오마", tier: "gold", timing: "first", description: "선택 후 바로 다음 기본 던지기가 끝나면 추가 던지기 1회를 얻고, 다음 증강의 등급이 한 단계 상승합니다." },\n''',
    '''  { id: "A01", name: "중력 폭발", tier: "prism", description: "첫 증강에서 얻으면 8라운드 후, 두 번째 증강에서 얻으면 4라운드 후 판 위의 모든 말을 내부 경로의 무작위 칸으로 강제 이동시킵니다." },\n  { id: "A04", name: "강해져서 돌아오마", tier: "gold", timing: "first", description: "선택 후 바로 다음 기본 던지기가 끝나면 추가 던지기 1회를 얻고, 다음 증강의 등급이 한 단계 상승합니다." },\n''',
)
replace_once(
    "src/lib/game/types.ts",
    '''  plaguePieceIds?: Record<string, boolean>;\n''',
    '''  plaguePieceIds?: Record<string, boolean>;\n  gravityExplosionRound?: number;\n  gravityExplosionResolved?: boolean;\n''',
)

# Engine helper: teleport each eligible physical piece independently and break stacks. No landing capture is evaluated.
replace_once(
    "src/lib/game/engine.ts",
    '''export function wormholeIsOpen(engine: GameEngineState, userId: string, ownedIds: string[]) {\n''',
    '''const GRAVITY_INTERNAL_NODES = [11, 12, 13, 14, 15, 16, 17, 23, 24] as const;\n\nexport function applyGravityExplosion(\n  engineInput: GameEngineState,\n  sourceUserId: string,\n  ownedByUser: Record<string, string[]>,\n  random: () => number = Math.random,\n): GameEngineState {\n  const engine = clone(engineInput);\n  for (const player of engine.players) {\n    // P10 forces that player's movement to the outer route, so those pieces are explicitly exempt.\n    if ((ownedByUser[player.userId] ?? []).includes("P10")) continue;\n    const affectedGroups = new Set(player.pieces.filter((piece) => piece.status === "ON_BOARD").map((piece) => piece.groupId));\n    for (const groupId of affectedGroups) {\n      clearGroupMoveFixedToOne(engine, player.userId, groupId);\n      clearJunctionBoostForGroup(engine, player.userId, groupId);\n      clearPathControlForGroup(engine, player.userId, groupId);\n      resetAthleteAccelerationForGroup(engine, player.userId, groupId, ownedByUser[player.userId] ?? []);\n    }\n    for (const piece of player.pieces) {\n      if (piece.status !== "ON_BOARD") continue;\n      const index = Math.min(GRAVITY_INTERNAL_NODES.length - 1, Math.floor(random() * GRAVITY_INTERNAL_NODES.length));\n      piece.node = GRAVITY_INTERNAL_NODES[index] ?? GRAVITY_INTERNAL_NODES[0];\n      piece.groupId = piece.id;\n      piece.hasEntered = true;\n    }\n  }\n  engine.augmentRuntime ??= {};\n  engine.augmentRuntime[sourceUserId] ??= {};\n  engine.augmentRuntime[sourceUserId].gravityExplosionResolved = true;\n  const source = engine.players.find((player) => player.userId === sourceUserId);\n  engine.lastAction = `${source?.displayName ?? "플레이어"}: 중력 폭발 · 판 위의 말들이 내부 경로로 흩어졌습니다.`;\n  return engine;\n}\n\nexport function wormholeIsOpen(engine: GameEngineState, userId: string, ownedIds: string[]) {\n''',
)

# Simulation import, acquisition schedule, and automatic due resolution.
replace_once(
    "src/lib/simulation/game.ts",
    '''  applyGrandUnity,\n  applyMarginExit,\n''',
    '''  applyGrandUnity,\n  applyGravityExplosion,\n  applyMarginExit,\n''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''      if (acquiredId === "A13") armWormholeOnAcquisition(context.engine, offer.userId);\n''',
    '''      if (acquiredId === "A01") {\n        ideaRuntime.gravityExplosionRound = context.engine.round + (eventIndex === 0 ? 8 : 4);\n        ideaRuntime.gravityExplosionResolved = false;\n      }\n      if (acquiredId === "A13") armWormholeOnAcquisition(context.engine, offer.userId);\n''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''function stepGame(context: SimulationContext) {\n  if (applyDueAugmentEvents(context)) return;\n  if (context.engine.winnerUserId) return;\n''',
    '''function maybeApplyGravityExplosion(context: SimulationContext) {\n  for (const player of context.engine.players) {\n    if (!(context.ownedByUser[player.userId] ?? []).includes("A01")) continue;\n    const runtime = context.engine.augmentRuntime?.[player.userId];\n    if (runtime?.gravityExplosionResolved || runtime?.gravityExplosionRound == null) continue;\n    if (context.engine.round < runtime.gravityExplosionRound) continue;\n    const before = context.engine;\n    const next = applyGravityExplosion(before, player.userId, context.ownedByUser, context.rng.effect.next);\n    commitTransition(context, before, next, player.userId, "augment_event");\n    return true;\n  }\n  return false;\n}\n\nfunction stepGame(context: SimulationContext) {\n  if (applyDueAugmentEvents(context)) return;\n  if (context.engine.winnerUserId) return;\n  if (maybeApplyGravityExplosion(context)) return;\n''',
)

print("Applied ideas batch 8: A01 Gravity Explosion delayed global internal-route teleport.")
