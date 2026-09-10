from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:140]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# G01 v6: Prism, at most two pieces per stack, and up to three GAE-generated extra rolls per turn.
replace_once(
    "src/lib/augments/catalog.ts",
    '{ id: "G01", name: "개판", tier: "prism", description: "개가 추가 던지기를 만들고, 윷과 모는 더 이상 추가 던지기를 만들지 않습니다. 개로 얻는 추가 던지기는 한 턴 최대 2회입니다." },',
    '{ id: "G01", name: "개판", tier: "prism", description: "개가 추가 던지기를 만들고, 윷과 모는 더 이상 추가 던지기를 만들지 않습니다. 자신의 말은 한 묶음에 최대 2개까지만 업을 수 있으며, 개로 얻는 추가 던지기는 한 턴 최대 3회입니다." },',
)

replace_once(
    "src/lib/augments/effects.ts",
    '  return (runtime.g01ExtraRollsGranted ?? 0) < 2;\n',
    '  return (runtime.g01ExtraRollsGranted ?? 0) < 3;\n',
)

# G15 v6: same consecutive-move design, lower max acceleration from +3 to +2.
replace_once(
    "src/lib/augments/catalog.ts",
    '{ id: "G15", name: "육상선수", tier: "gold", description: "같은 자신의 말을 연속해서 이동시킬 때마다 해당 말의 전진 이동량이 +1칸 증가합니다. 가속은 최대 +3칸까지 증가하며, 다른 자신의 말을 이동시키거나 해당 말이 잡히면 초기화됩니다." },',
    '{ id: "G15", name: "육상선수", tier: "gold", description: "같은 자신의 말을 연속해서 이동시킬 때마다 해당 말의 전진 이동량이 +1칸 증가합니다. 가속은 최대 +2칸까지 증가하며, 다른 자신의 말을 이동시키거나 해당 말이 잡히면 초기화됩니다." },',
)
replace_once(
    "src/lib/augments/effects.ts",
    '      bonus += Math.min(3, runtime.athleteConsecutiveMoves ?? 0);\n',
    '      bonus += Math.min(2, runtime.athleteConsecutiveMoves ?? 0);\n',
)

# G01 stack-size cap: normal stack choice.
replace_once(
    "src/lib/game/engine.ts",
    '''  if (stack) {\n    const mergeIds = new Set([pending.movingGroupId, ...pending.alliedGroupIds]);\n    transferFixedOneOnStack(engine, player.userId, [...mergeIds], pending.movingGroupId);\n''',
    '''  if (stack) {\n    const mergeIds = new Set([pending.movingGroupId, ...pending.alliedGroupIds]);\n    if (ownedIds.includes("G01")) {\n      const mergedPieceCount = player.pieces.filter((piece) => (\n        piece.status === "ON_BOARD"\n        && piece.node === pending.destination\n        && mergeIds.has(piece.groupId)\n      )).length;\n      if (mergedPieceCount > 2) throw new Error("개판은 한 묶음에 최대 2개의 말만 업을 수 있습니다.");\n    }\n    transferFixedOneOnStack(engine, player.userId, [...mergeIds], pending.movingGroupId);\n''',
)

# G01 stack-size cap: relocation stacking (친구와 함께 / 무임승차).
replace_once(
    "src/lib/game/engine.ts",
    '''  if (sourceGroupId != null) {\n    const valid = liveRelocationCandidates(engine, pending, current.candidateGroupIds);\n    if (!valid.includes(sourceGroupId)) throw new Error("선택할 수 없는 재배치 대상입니다.");\n    relocateOwnGroupIntoMovingGroup(engine, player.userId, sourceGroupId, pending.movingGroupId, pending.destination);\n''',
    '''  if (sourceGroupId != null) {\n    const valid = liveRelocationCandidates(engine, pending, current.candidateGroupIds);\n    if (!valid.includes(sourceGroupId)) throw new Error("선택할 수 없는 재배치 대상입니다.");\n    if (ownedIds.includes("G01")) {\n      const sourceCount = player.pieces.filter((piece) => piece.status === "ON_BOARD" && piece.groupId === sourceGroupId).length;\n      const movingCount = player.pieces.filter((piece) => piece.status === "ON_BOARD" && piece.groupId === pending.movingGroupId).length;\n      if (sourceCount + movingCount > 2) throw new Error("개판은 한 묶음에 최대 2개의 말만 업을 수 있습니다.");\n    }\n    relocateOwnGroupIntoMovingGroup(engine, player.userId, sourceGroupId, pending.movingGroupId, pending.destination);\n''',
)

# G01 stack-size cap: Grand Unity cannot create a stack larger than two.
replace_once(
    "src/lib/game/engine.ts",
    '''  const mergeIds = [...groups.keys()];\n  transferFixedOneOnStack(engine, player.userId, mergeIds, anchorGroupId);\n''',
    '''  const mergeIds = [...groups.keys()];\n  if (ownedIds.includes("G01")) {\n    const mergedPieceCount = [...groups.values()].reduce((sum, pieces) => sum + pieces.length, 0);\n    if (mergedPieceCount > 2) throw new Error("개판은 한 묶음에 최대 2개의 말만 업을 수 있습니다.");\n  }\n  transferFixedOneOnStack(engine, player.userId, mergeIds, anchorGroupId);\n''',
)

print("Applied balance v6: G01 max 2-piece stacks + max three GAE extra rolls/turn; G15 max acceleration +2.")
