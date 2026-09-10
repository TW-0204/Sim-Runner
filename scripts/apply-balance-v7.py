from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:160]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_all(path: str, old: str, new: str, expected: int | None = None):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count == 0 or (expected is not None and count != expected):
        raise SystemExit(f"Unexpected replacement count in {path}: got {count}, expected {expected}")
    p.write_text(text.replace(old, new), encoding="utf-8")


# Catalog changes after v4/v5/v6 patches have run.
replace_once(
    "src/lib/augments/catalog.ts",
    '{ id: "S04", name: "돌파", tier: "silver", description: "자신의 말이 누적 5회 잡히면 이후 처음 2번의 잡기를 무효화합니다." },',
    '{ id: "S04", name: "돌파", tier: "gold", description: "자신의 말이 누적 5회 잡히면 이후 처음 2번의 잡기를 무효화합니다." },',
)
replace_once(
    "src/lib/augments/catalog.ts",
    '{ id: "S15", name: "친구와 함께", tier: "silver", description: "이동을 마친 뒤 경로 기준 앞뒤 1칸의 아군 한 묶음을 불러와 업을 수 있습니다." },',
    '{ id: "S15", name: "친구와 함께", tier: "silver", description: "이동을 마친 뒤 경로 기준 앞뒤 1칸의 아군 한 묶음을 불러와 업을 수 있습니다. 이 효과로 합친 묶음은 최대 2개의 말까지만 가능합니다." },',
)
replace_once(
    "src/lib/augments/catalog.ts",
    '{ id: "G06", name: "골목대장", tier: "gold", description: "갈림길에 정확히 도착하면 상대의 통과를 한 번 막아 바로 앞 칸에 세울 수 있습니다." },',
    '{ id: "G06", name: "골목대장", tier: "silver", description: "갈림길에 정확히 도착하면 상대의 통과를 한 번 막아 바로 앞 칸에 세울 수 있습니다." },',
)
replace_once(
    "src/lib/augments/catalog.ts",
    '{ id: "G10", name: "추격자", tier: "gold", description: "이동 경로 위 상대에게 일찍 멈춰 그 말을 잡을 수 있습니다." },',
    '{ id: "G10", name: "추격자", tier: "gold", description: "이동 경로 위 상대에게 일찍 멈춰 그 말을 잡을 수 있습니다. 이 효과로 잡을 때는 추가 던지기를 얻지 않습니다." },',
)
replace_once(
    "src/lib/augments/catalog.ts",
    '{ id: "G13", name: "내일의 나에게", tier: "gold", description: "턴마다 사용하지 않은 이동 결과 하나를 다음 턴까지 저장할 수 있습니다." },',
    '{ id: "G13", name: "내일의 나에게", tier: "gold", description: "턴마다 사용하지 않은 이동 결과 하나를 다음 턴까지 저장할 수 있습니다. 저장한 결과의 이동 거리는 1칸 증가합니다." },',
)
replace_once(
    "src/lib/augments/catalog.ts",
    '  { id: "G14", name: "각자도생", tier: "gold", description: "업힌 자신의 말이 갈림길에 정확히 도착하면 원하는 방식으로 분리할 수 있습니다." },\n',
    '',
)
replace_once(
    "src/lib/augments/catalog.ts",
    '{ id: "P09", name: "길은 내가 만든다", tier: "prism", description: "갈림길에 정확히 멈추지 않아도 지나가는 순간 원하는 지름길로 진입할 수 있습니다." },',
    '{ id: "P09", name: "길은 내가 만든다", tier: "gold", description: "갈림길에 정확히 멈추지 않아도 지나가는 순간 원하는 지름길로 진입할 수 있습니다." },',
)
replace_once(
    "src/lib/augments/catalog.ts",
    '{ id: "P13", name: "성역", tier: "prism", conflicts: ["P03"], description: "갈림길에 도착한 자신의 말은 떠날 때까지 잡히지 않으며 상대는 그 갈림길을 통과할 수 없습니다." },',
    '{ id: "P13", name: "성역", tier: "prism", conflicts: ["P03"], description: "갈림길에 도착한 자신의 말은 떠날 때까지 잡히지 않으며, 상대의 통과를 한 번 막습니다." },',
)
replace_once(
    "src/lib/augments/catalog.ts",
    '{ id: "P18", name: "무임승차", tier: "prism", description: "자신의 이동 경로에서 지나친 아군 한 묶음을 도착 칸으로 불러와 업을 수 있습니다." },',
    '{ id: "P18", name: "무임승차", tier: "prism", description: "자신의 이동 경로에서 지나친 아군 한 묶음을 도착 칸으로 불러와 업을 수 있습니다. 이 효과로 합친 묶음은 최대 3개의 말까지만 가능합니다." },',
)

# S15/P18: limit by resulting stacked piece count, not player count.
replace_once(
    "src/lib/game/engine.ts",
    '''  const opportunities: RelocationOpportunity[] = [];\n\n  if (ownedIds.includes("S15")) {\n''',
    '''  const opportunities: RelocationOpportunity[] = [];\n  const actorGroups = playerBoardGroups(engine, userId);\n  const movingGroupSize = actorGroups.get(movingGroupId)?.length ?? 0;\n  const fitsStackLimit = (candidateGroupId: string, maxPieces: number) => (\n    movingGroupSize + (actorGroups.get(candidateGroupId)?.length ?? 0) <= maxPieces\n  );\n\n  if (ownedIds.includes("S15")) {\n''',
)
replace_once(
    "src/lib/game/engine.ts",
    '''    const candidates = candidateGroupsAtNodes(engine, userId, movingGroupId, neighborNodes, true);\n    if (candidates.length) opportunities.push({ kind: "FRIEND", candidateGroupIds: candidates });\n''',
    '''    const candidates = candidateGroupsAtNodes(engine, userId, movingGroupId, neighborNodes, true)\n      .filter((groupId) => fitsStackLimit(groupId, 2));\n    if (candidates.length) opportunities.push({ kind: "FRIEND", candidateGroupIds: candidates });\n''',
)
replace_once(
    "src/lib/game/engine.ts",
    '''    const candidates = candidateGroupsAtNodes(engine, userId, movingGroupId, passedNodes, false);\n    if (candidates.length) opportunities.push({ kind: "HITCHHIKER", candidateGroupIds: candidates });\n''',
    '''    const candidates = candidateGroupsAtNodes(engine, userId, movingGroupId, passedNodes, false)\n      .filter((groupId) => fitsStackLimit(groupId, 3));\n    if (candidates.length) opportunities.push({ kind: "HITCHHIKER", candidateGroupIds: candidates });\n''',
)

# G10: using CHASE to capture suppresses capture-generated extra rolls for that move.
replace_once(
    "src/lib/game/engine.ts",
    '  let selectedInterruption: PathInterruption | null = null;\n',
    '  let selectedInterruption: PathInterruption | null = null;\n  let usedChaseAbility = false;\n',
)
replace_all(
    "src/lib/game/engine.ts",
    '    selectedInterruption = selected.interruption;\n',
    '    selectedInterruption = selected.interruption;\n    if (selected.target.kind === "CHASE") usedChaseAbility = true;\n',
    expected=3,
)
replace_once(
    "src/lib/game/engine.ts",
    '  const captures = captureAlongPath(engine, args.groupId, captureNodes, ownedByUser);\n  recordEnemyCaptures(engine, mover.userId, captures.captureCount, ownedIds);\n',
    '  const captures = captureAlongPath(engine, args.groupId, captureNodes, ownedByUser);\n  if (usedChaseAbility) captures.captureExtraRollCount = 0;\n  recordEnemyCaptures(engine, mover.userId, captures.captureCount, ownedIds);\n',
)

# G13: the saved result gains one extra cell in the same movement direction.
replace_once(
    "src/lib/game/tomorrow.ts",
    '    finalSteps: result.finalSteps,\n',
    '    finalSteps: result.finalSteps + (result.finalSteps > 0 ? 1 : result.finalSteps < 0 ? -1 : 0),\n',
)

# P13: keep capture immunity while parked, but passage blocking is consumed after one use.
replace_once(
    "src/lib/game/types.ts",
    '  sanctuaryGroups?: Record<string, number>;\n',
    '  sanctuaryGroups?: Record<string, number>;\n  sanctuaryPassBlocks?: Record<string, boolean>;\n',
)
replace_once(
    "src/lib/augments/effects.ts",
    '  if (runtime?.sanctuaryGroups?.[groupId] != null) delete runtime.sanctuaryGroups[groupId];\n',
    '  if (runtime?.sanctuaryGroups?.[groupId] != null) delete runtime.sanctuaryGroups[groupId];\n  if (runtime?.sanctuaryPassBlocks?.[groupId]) delete runtime.sanctuaryPassBlocks[groupId];\n',
)
replace_once(
    "src/lib/augments/effects.ts",
    '''  if (has(ownedIds, "P13")) {\n    runtime.sanctuaryGroups ??= {};\n    runtime.sanctuaryGroups[groupId] = destination;\n  }\n''',
    '''  if (has(ownedIds, "P13")) {\n    runtime.sanctuaryGroups ??= {};\n    runtime.sanctuaryGroups[groupId] = destination;\n    runtime.sanctuaryPassBlocks ??= {};\n    runtime.sanctuaryPassBlocks[groupId] = true;\n  }\n''',
)
replace_once(
    "src/lib/augments/effects.ts",
    '''  const sanctuaryCarry = mergedGroupIds.some((id) => runtime.sanctuaryGroups?.[id] === destination);\n  const blockadeCarry = mergedGroupIds.some((id) => runtime.alleyBlockades?.[id] === destination);\n''',
    '''  const sanctuaryCarry = mergedGroupIds.some((id) => runtime.sanctuaryGroups?.[id] === destination);\n  const sanctuaryPassCarry = mergedGroupIds.some((id) => Boolean(runtime.sanctuaryPassBlocks?.[id]));\n  const blockadeCarry = mergedGroupIds.some((id) => runtime.alleyBlockades?.[id] === destination);\n''',
)
replace_once(
    "src/lib/augments/effects.ts",
    '''    if (runtime.sanctuaryGroups?.[id] != null) delete runtime.sanctuaryGroups[id];\n    if (runtime.alleyBlockades?.[id] != null) delete runtime.alleyBlockades[id];\n''',
    '''    if (runtime.sanctuaryGroups?.[id] != null) delete runtime.sanctuaryGroups[id];\n    if (runtime.sanctuaryPassBlocks?.[id]) delete runtime.sanctuaryPassBlocks[id];\n    if (runtime.alleyBlockades?.[id] != null) delete runtime.alleyBlockades[id];\n''',
)
replace_once(
    "src/lib/augments/effects.ts",
    '''  if (sanctuaryCarry) {\n    runtime.sanctuaryGroups ??= {};\n    runtime.sanctuaryGroups[resultGroupId] = destination;\n  }\n''',
    '''  if (sanctuaryCarry) {\n    runtime.sanctuaryGroups ??= {};\n    runtime.sanctuaryGroups[resultGroupId] = destination;\n  }\n  if (sanctuaryPassCarry) {\n    runtime.sanctuaryPassBlocks ??= {};\n    runtime.sanctuaryPassBlocks[resultGroupId] = true;\n  }\n''',
)
replace_once(
    "src/lib/augments/effects.ts",
    '''      if (savedNode !== node) continue;\n      const active = player.pieces.some((piece) => piece.groupId === groupId && piece.status === "ON_BOARD" && piece.node === node);\n''',
    '''      if (savedNode !== node) continue;\n      if (kind === "SANCTUARY" && !engine.augmentRuntime?.[player.userId]?.sanctuaryPassBlocks?.[groupId]) continue;\n      const active = player.pieces.some((piece) => piece.groupId === groupId && piece.status === "ON_BOARD" && piece.node === node);\n''',
)
replace_once(
    "src/lib/augments/effects.ts",
    '''export function consumeAlleyBlockade(engine: GameEngineState, defenderUserId: string, defenderGroupId: string) {\n''',
    '''export function consumeSanctuaryPassBlock(engine: GameEngineState, defenderUserId: string, defenderGroupId: string) {\n  const blocks = engine.augmentRuntime?.[defenderUserId]?.sanctuaryPassBlocks;\n  if (blocks?.[defenderGroupId]) delete blocks[defenderGroupId];\n}\n\nexport function consumeAlleyBlockade(engine: GameEngineState, defenderUserId: string, defenderGroupId: string) {\n''',
)
replace_once(
    "src/lib/game/engine.ts",
    '  consumeAlleyBlockade,\n',
    '  consumeAlleyBlockade,\n  consumeSanctuaryPassBlock,\n',
)
replace_all(
    "src/lib/game/engine.ts",
    '''      } else {\n        pathMessage += ` · 성역 통과 차단(${selectedInterruption.blockerNode}번)`;\n      }\n''',
    '''      } else {\n        consumeSanctuaryPassBlock(engine, selectedInterruption.defenderUserId, selectedInterruption.defenderGroupId);\n        pathMessage += ` · 성역 통과 1회 차단(${selectedInterruption.blockerNode}번)`;\n      }\n''',
    expected=3,
)

print("Applied balance v7: S04 Gold; S15 max 2-piece result; G06 Silver; G10 chase capture no extra roll; G13 stored distance +1; G14 removed; P09 Gold; P13 one passage block; P18 max 3-piece result.")
