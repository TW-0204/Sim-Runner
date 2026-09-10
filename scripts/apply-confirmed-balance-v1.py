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

# S04: after the 5th real capture, grant exactly two future capture blocks.
replace_exact(
    "src/lib/augments/catalog.ts",
    '{ id: "S04", name: "돌파", tier: "silver", description: "자신의 말이 누적 4회 잡히면 이후 모든 자신의 말이 잡히지 않습니다." },',
    '{ id: "S04", name: "돌파", tier: "silver", description: "자신의 말이 누적 5회 잡히면 이후 처음 2번의 잡기를 무효화합니다." },',
)

# S02: one extra roll per three successful stack events, cumulative across the game.
replace_exact(
    "src/lib/augments/catalog.ts",
    '{ id: "S02", name: "어부바", tier: "silver", description: "자신의 말을 새로 업을 때마다 추가 던지기 1회를 얻습니다." },',
    '{ id: "S02", name: "어부바", tier: "silver", description: "자신의 말을 새로 업한 횟수가 누적 3회가 될 때마다 추가 던지기 1회를 얻습니다." },',
)

# G05: active for three rounds starting from the first BASIC roll after acquisition.
replace_exact(
    "src/lib/augments/catalog.ts",
    '{ id: "G05", name: "모 아니면 도", tier: "gold", conflicts: fixedRollConflicts.filter((id) => id !== "G05"), description: "다음 5회의 기본 던지기는 각각 50% 확률로 모 또는 도가 나옵니다." },',
    '{ id: "G05", name: "모 아니면 도", tier: "gold", conflicts: fixedRollConflicts.filter((id) => id !== "G05"), description: "획득한 라운드부터 3라운드 동안 기본 던지기는 각각 50% 확률로 모 또는 도가 나옵니다." },',
)

# G15 remains Silver for now while its balance anomaly is investigated; effect unchanged.
replace_exact(
    "src/lib/augments/catalog.ts",
    '{ id: "G15", name: "육상선수", tier: "gold", conflicts: ["P16"], description: "상대를 잡을 수 없는 대신, 한 턴의 이동을 잡기와 업기 없이 끝내면 추가 던지기 1회를 얻습니다." },',
    '{ id: "G15", name: "육상선수", tier: "silver", conflicts: ["P16"], description: "상대를 잡을 수 없는 대신, 한 턴의 이동을 잡기와 업기 없이 끝내면 추가 던지기 1회를 얻습니다." },',
)

replace_exact(
    "src/lib/game/types.ts",
    '  timesCaptured?: number;\n',
    '  timesCaptured?: number;\n  breakthroughBlocksRemaining?: number;\n  piggybackStackCount?: number;\n  g05StartRound?: number;\n',
)

replace_exact(
    "src/lib/augments/effects.ts",
    '''  const runtime = runtimeForPlayer(engine, userId);\n  const used = runtime.controlledBasicRollsUsed ?? 0;\n  if (used >= 5) return face;\n  runtime.controlledBasicRollsUsed = used + 1;\n''',
    '''  const runtime = runtimeForPlayer(engine, userId);\n  const used = runtime.controlledBasicRollsUsed ?? 0;\n  if (has(ownedIds, "G05")) {\n    runtime.g05StartRound ??= engine.round;\n    if (engine.round >= runtime.g05StartRound + 3) return face;\n  } else {\n    if (used >= 5) return face;\n    runtime.controlledBasicRollsUsed = used + 1;\n  }\n''',
)

replace_exact(
    "src/lib/augments/effects.ts",
    '''export function stackAugmentExtraRolls(stack: boolean, ownedIds: string[]) {\n  return stack && has(ownedIds, "S02") ? 1 : 0;\n}\n''',
    '''export function stackAugmentExtraRolls(\n  engine: GameEngineState,\n  userId: string,\n  stack: boolean,\n  ownedIds: string[],\n) {\n  if (!stack || !has(ownedIds, "S02")) return 0;\n  const runtime = runtimeForPlayer(engine, userId);\n  runtime.piggybackStackCount = (runtime.piggybackStackCount ?? 0) + 1;\n  return runtime.piggybackStackCount % 3 === 0 ? 1 : 0;\n}\n''',
)

replace_exact(
    "src/lib/augments/effects.ts",
    '''export function isCaptureImmune(engine: GameEngineState, userId: string, ownedIds: string[]) {\n  if (!has(ownedIds, "S04")) return false;\n  return (engine.augmentRuntime?.[userId]?.timesCaptured ?? 0) >= 4;\n}\n\nexport function recordCaptureAgainstPlayer(engine: GameEngineState, userId: string, ownedIds: string[]) {\n  if (!has(ownedIds, "S04") && !has(ownedIds, "S07") && !has(ownedIds, "S11")) return;\n  const runtime = runtimeForPlayer(engine, userId);\n  if (has(ownedIds, "S04")) runtime.timesCaptured = (runtime.timesCaptured ?? 0) + 1;\n  if (has(ownedIds, "S07")) runtime.revengeBasicPending = true;\n  if (has(ownedIds, "S11")) runtime.counterRollPending = true;\n}\n''',
    '''export function isCaptureImmune(_engine: GameEngineState, _userId: string, _ownedIds: string[]) {\n  return false;\n}\n\nexport function consumeBreakthroughCaptureBlock(engine: GameEngineState, userId: string, ownedIds: string[]) {\n  if (!has(ownedIds, "S04")) return false;\n  const runtime = runtimeForPlayer(engine, userId);\n  const remaining = runtime.breakthroughBlocksRemaining ?? 0;\n  if (remaining <= 0) return false;\n  runtime.breakthroughBlocksRemaining = remaining - 1;\n  return true;\n}\n\nexport function recordCaptureAgainstPlayer(engine: GameEngineState, userId: string, ownedIds: string[]) {\n  if (!has(ownedIds, "S04") && !has(ownedIds, "S07") && !has(ownedIds, "S11")) return;\n  const runtime = runtimeForPlayer(engine, userId);\n  if (has(ownedIds, "S04")) {\n    runtime.timesCaptured = (runtime.timesCaptured ?? 0) + 1;\n    if (runtime.timesCaptured === 5) runtime.breakthroughBlocksRemaining = 2;\n  }\n  if (has(ownedIds, "S07")) runtime.revengeBasicPending = true;\n  if (has(ownedIds, "S11")) runtime.counterRollPending = true;\n}\n''',
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

replace_exact(
    "src/lib/game/engine.ts",
    '    pending.augmentExtraRolls += stackAugmentExtraRolls(true, ownedIds);\n',
    '    pending.augmentExtraRolls += stackAugmentExtraRolls(engine, player.userId, true, ownedIds);\n',
)
replace_exact(
    "src/lib/game/engine.ts",
    '  const augmentExtraRolls = (pending.augmentExtraRolls ?? 0) + stackAugmentExtraRolls(stack, ownedIds);\n',
    '  const augmentExtraRolls = (pending.augmentExtraRolls ?? 0) + stackAugmentExtraRolls(engine, player.userId, stack, ownedIds);\n',
)
replace_exact(
    "src/lib/game/engine.ts",
    '  const augmentExtraRolls = stackAugmentExtraRolls(true, ownedIds);\n',
    '  const augmentExtraRolls = stackAugmentExtraRolls(engine, player.userId, true, ownedIds);\n',
)

print("Applied confirmed balance v3: S04 five captures then two blocks, G01 prism, S02 every three stacks, G15 silver pending review, G05 three rounds.")
