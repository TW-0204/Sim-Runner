from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:180]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")

# Catalog wording: infection lasts only the victim's next own turn.
replace_once(
    "src/lib/augments/catalog.ts",
    '  { id: "A14", name: "역병", tier: "gold", description: "상대를 잡으면 그 말을 감염 상태로 만듭니다. 감염된 말은 대기에서 출발할 때 걸, 윷, 모가 나와야 출발할 수 있으며, 출발에 성공하면 감염이 해제됩니다." },\n',
    '  { id: "A14", name: "역병", tier: "gold", description: "상대를 잡으면 그 말을 감염 상태로 만듭니다. 감염은 그 플레이어의 다음 한 턴 동안만 지속되며, 감염된 말은 대기에서 출발할 때 걸, 윷, 모가 나와야 출발할 수 있습니다." },\n',
)

# Simulation tracks whether the current own turn began while infected.
replace_once(
    "src/lib/game/types.ts",
    '  plaguePieceIds?: Record<string, boolean>;\n',
    '  plaguePieceIds?: Record<string, boolean>;\n  plagueTurnActive?: boolean;\n',
)

# Arm the one-turn duration at the start of an infected player's own turn.
replace_once(
    "src/lib/simulation/game.ts",
    'function stepGame(context: SimulationContext) {\n  if (applyDueAugmentEvents(context)) return;\n  if (context.engine.winnerUserId) return;\n',
    '''function stepGame(context: SimulationContext) {\n  if (applyDueAugmentEvents(context)) return;\n  if (context.engine.winnerUserId) return;\n  const turnOwner = currentPlayer(context.engine);\n  const turnRuntime = context.engine.augmentRuntime?.[turnOwner.userId];\n  if (turnRuntime && Object.keys(turnRuntime.plaguePieceIds ?? {}).length > 0 && turnRuntime.plagueTurnActive !== true) {\n    turnRuntime.plagueTurnActive = true;\n  }\n''',
)

# When that player's turn actually ends, clear any infection that remains.
replace_once(
    "src/lib/simulation/game.ts",
    '  context.engine = after;\n}\n\nfunction applyDueAugmentEvents',
    '''  const beforeActor = currentPlayer(before).userId;\n  const afterActor = currentPlayer(after).userId;\n  if (beforeActor !== afterActor) {\n    const runtime = after.augmentRuntime?.[beforeActor];\n    if (runtime?.plagueTurnActive) {\n      runtime.plaguePieceIds = {};\n      runtime.plagueTurnActive = false;\n    }\n  }\n  context.engine = after;\n}\n\nfunction applyDueAugmentEvents''',
)

print("Applied v3 plague duration: infection lasts through only the victim's next own turn.")
