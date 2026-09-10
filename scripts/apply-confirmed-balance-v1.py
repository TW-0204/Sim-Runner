from pathlib import Path


def replace_exact(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}")
    p.write_text(text.replace(old, new), encoding="utf-8")

# G01: Gold -> Prism, effect unchanged.
replace_exact(
    "src/lib/augments/catalog.ts",
    '{ id: "G01", name: "개판", tier: "gold", description: "개가 추가 던지기를 만들고, 윷과 모는 더 이상 추가 던지기를 만들지 않습니다." },',
    '{ id: "G01", name: "개판", tier: "prism", description: "개가 추가 던지기를 만들고, 윷과 모는 더 이상 추가 던지기를 만들지 않습니다." },',
)

# S04: after the 4th real capture, grant exactly two future capture blocks.
replace_exact(
    "src/lib/augments/catalog.ts",
    '{ id: "S04", name: "돌파", tier: "silver", description: "자신의 말이 누적 4회 잡히면 이후 모든 자신의 말이 잡히지 않습니다." },',
    '{ id: "S04", name: "돌파", tier: "silver", description: "자신의 말이 누적 4회 잡히면 이후 처음 2번의 잡기를 무효화합니다." },',
)

replace_exact(
    "src/lib/game/types.ts",
    '  timesCaptured?: number;\n',
    '  timesCaptured?: number;\n  breakthroughBlocksRemaining?: number;\n',
)

replace_exact(
    "src/lib/augments/effects.ts",
    '''export function isCaptureImmune(engine: GameEngineState, userId: string, ownedIds: string[]) {\n  if (!has(ownedIds, "S04")) return false;\n  return (engine.augmentRuntime?.[userId]?.timesCaptured ?? 0) >= 4;\n}\n\nexport function recordCaptureAgainstPlayer(engine: GameEngineState, userId: string, ownedIds: string[]) {\n  if (!has(ownedIds, "S04") && !has(ownedIds, "S07") && !has(ownedIds, "S11")) return;\n  const runtime = runtimeForPlayer(engine, userId);\n  if (has(ownedIds, "S04")) runtime.timesCaptured = (runtime.timesCaptured ?? 0) + 1;\n  if (has(ownedIds, "S07")) runtime.revengeBasicPending = true;\n  if (has(ownedIds, "S11")) runtime.counterRollPending = true;\n}\n''',
    '''export function isCaptureImmune(_engine: GameEngineState, _userId: string, _ownedIds: string[]) {\n  return false;\n}\n\nexport function consumeBreakthroughCaptureBlock(engine: GameEngineState, userId: string, ownedIds: string[]) {\n  if (!has(ownedIds, "S04")) return false;\n  const runtime = runtimeForPlayer(engine, userId);\n  const remaining = runtime.breakthroughBlocksRemaining ?? 0;\n  if (remaining <= 0) return false;\n  runtime.breakthroughBlocksRemaining = remaining - 1;\n  return true;\n}\n\nexport function recordCaptureAgainstPlayer(engine: GameEngineState, userId: string, ownedIds: string[]) {\n  if (!has(ownedIds, "S04") && !has(ownedIds, "S07") && !has(ownedIds, "S11")) return;\n  const runtime = runtimeForPlayer(engine, userId);\n  if (has(ownedIds, "S04")) {\n    runtime.timesCaptured = (runtime.timesCaptured ?? 0) + 1;\n    if (runtime.timesCaptured === 4) runtime.breakthroughBlocksRemaining = 2;\n  }\n  if (has(ownedIds, "S07")) runtime.revengeBasicPending = true;\n  if (has(ownedIds, "S11")) runtime.counterRollPending = true;\n}\n''',
)

replace_exact(
    "src/lib/game/engine.ts",
    '  consumeCleanerMovement,\n',
    '  consumeCleanerMovement,\n  consumeBreakthroughCaptureBlock,\n',
)
replace_exact(
    "src/lib/game/engine.ts",
    '    if (isSanctuaryGroup(engine, victim.ownerUserId, victim.groupId, node)) continue;\n    if (isCaptureImmune(engine, victim.ownerUserId, victimOwned)) continue;\n\n    captureCount += 1;\n',
    '    if (isSanctuaryGroup(engine, victim.ownerUserId, victim.groupId, node)) continue;\n    if (isCaptureImmune(engine, victim.ownerUserId, victimOwned)) continue;\n    if (consumeBreakthroughCaptureBlock(engine, victim.ownerUserId, victimOwned)) continue;\n\n    captureCount += 1;\n',
)

print("Applied confirmed balance v1: S04 two capture blocks, G01 prism tier.")
