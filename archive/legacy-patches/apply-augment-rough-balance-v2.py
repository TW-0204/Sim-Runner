from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:240]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# A16 여백의 미 rough balance v2
# Only one physical piece per player may be in MARGIN at any time.
replace_once(
    "src/lib/augments/catalog.ts",
    '''  { id: "A16", name: "여백의 미", tier: "gold", description: "자신의 턴에 판 위의 말 1기를 여백으로 피신시킬 수 있습니다. 이동 결과 하나를 소모하면 들어가기 직전 칸으로 돌아오며, 복귀 시 잡기와 업기가 가능합니다." },\n''',
    '''  { id: "A16", name: "여백의 미", tier: "gold", description: "자신의 턴에 판 위의 말 1기를 여백으로 피신시킬 수 있습니다. 여백에는 자신의 말 1기만 들어갈 수 있습니다. 이동 결과 하나를 소모하면 들어가기 직전 칸으로 돌아오며, 복귀 시 잡기와 업기가 가능합니다." },\n''',
)

replace_once(
    "src/lib/game/engine.ts",
    '''  const player = currentPlayer(engine);\n  const runtime = runtimeForWormhole(engine, userId);\n  if (runtime.marginSentTurnNumber === engine.turnNumber) throw new Error("한 턴에는 말 1기만 여백으로 보낼 수 있습니다.");\n  const piece = player.pieces.find((candidate) => candidate.id === pieceId);\n''',
    '''  const player = currentPlayer(engine);\n  const runtime = runtimeForWormhole(engine, userId);\n  if (player.pieces.some((candidate) => candidate.status === "MARGIN")) {\n    throw new Error("여백에는 자신의 말 1기만 들어갈 수 있습니다.");\n  }\n  if (runtime.marginSentTurnNumber === engine.turnNumber) throw new Error("한 턴에는 말 1기만 여백으로 보낼 수 있습니다.");\n  const piece = player.pieces.find((candidate) => candidate.id === pieceId);\n''',
)

print("Applied augment rough balance v2: A16 single-piece margin limit.")
