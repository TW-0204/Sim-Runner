from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:220]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# Pre-regular-test rough tuning only.
# 1) A10 Betrayal: move test placement from Gold to Prism. Effect semantics are unchanged.
replace_once(
    "src/lib/augments/catalog.ts",
    '  { id: "A10", name: "배반", tier: "gold", description: "자신의 대기 중인 말 1기를 무작위 상대 플레이어의 소유로 변경합니다." },\n',
    '  { id: "A10", name: "배반", tier: "prism", description: "자신의 대기 중인 말 1기를 무작위 상대 플레이어의 소유로 변경합니다." },\n',
)

# 2) A14 Plague: teach the simulation evaluator that creating a new enemy infection is useful,
# while becoming newly infected itself is harmful. This changes bot decision quality, not game rules.
replace_once(
    "src/lib/simulation/game.ts",
    '''function outcomeScore(context: SimulationContext, before: GameEngineState, after: GameEngineState, userId: string) {\n  const base = playerPositionScore(after, userId, actorOwned(context, userId), actorSetups(context, userId));\n  return base + capturedEnemyPieceCount(before, after, userId) * 85;\n}\n''',
    '''function newlyInfectedGroupCount(before: GameEngineState, after: GameEngineState, targetUserId: string) {\n  const afterPlayer = after.players.find((player) => player.userId === targetUserId);\n  if (!afterPlayer) return 0;\n  const beforeInfected = before.augmentRuntime?.[targetUserId]?.plaguePieceIds ?? {};\n  const afterInfected = after.augmentRuntime?.[targetUserId]?.plaguePieceIds ?? {};\n  const groups = new Map<string, string[]>();\n  for (const piece of afterPlayer.pieces) {\n    if (piece.status !== "ON_BOARD") continue;\n    const list = groups.get(piece.groupId) ?? [];\n    list.push(piece.id);\n    groups.set(piece.groupId, list);\n  }\n  let count = 0;\n  for (const pieceIds of groups.values()) {\n    const isNowInfected = pieceIds.some((pieceId) => Boolean(afterInfected[pieceId]));\n    const wasAlreadyInfected = pieceIds.some((pieceId) => Boolean(beforeInfected[pieceId]));\n    if (isNowInfected && !wasAlreadyInfected) count += 1;\n  }\n  return count;\n}\n\nfunction outcomeScore(context: SimulationContext, before: GameEngineState, after: GameEngineState, userId: string) {\n  const base = playerPositionScore(after, userId, actorOwned(context, userId), actorSetups(context, userId));\n  const captureScore = capturedEnemyPieceCount(before, after, userId) * 85;\n  const enemyInfectionScore = after.players\n    .filter((player) => player.userId !== userId)\n    .reduce((sum, player) => sum + newlyInfectedGroupCount(before, after, player.userId), 0) * 45;\n  const selfInfectionPenalty = newlyInfectedGroupCount(before, after, userId) * 35;\n  return base + captureScore + enemyInfectionScore - selfInfectionPenalty;\n}\n''',
)

# 3) A16 Margin: the old smoke bot hid a leading piece on 35% of eligible turns, then paid a move result
# to return it. Reduce this crude auto-use rate to 10% and choose by actual path progress instead of node id.
replace_once(
    "src/lib/simulation/game.ts",
    '  if (marginCount > 0 || context.rng.effect.next() >= 0.35) return false;\n',
    '  if (marginCount > 0 || context.rng.effect.next() >= 0.10) return false;\n',
)
replace_once(
    "src/lib/simulation/game.ts",
    '  const target = [...candidates].sort((left, right) => (right.node ?? 0) - (left.node ?? 0))[0];\n',
    '  const target = [...candidates].sort((left, right) => right.pathHistory.length - left.pathHistory.length)[0];\n',
)

print("Applied pretest rough tuning: A10 Prism, A14 infection-aware bot scoring, A16 conservative margin use.")
