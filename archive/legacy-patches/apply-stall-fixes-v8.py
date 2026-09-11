from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one occurrence in {path}, got {count}: {old[:220]!r}")
    write(path, text.replace(old, new, 1))


# resolveSoloLap was written for ordinary self-movement and therefore used
# currentPlayer(engine). Global effects such as A08 can finish another player's
# P14 representative during the current actor's augment resolution. Resolve the
# lap against the actual representative owner instead.
replace_once(
    "src/lib/game/engine.ts",
    '''function resolveSoloLap(engine: GameEngineState, group: PieceState[], ownedIds: string[], setups: PlayerAugmentSetups) {\n  if (!ownedIds.includes("P14")) return null;\n  const representativeId = setups.P14?.pieceId;\n  if (!representativeId || !group.some((piece) => piece.id === representativeId)) return null;\n  const player = currentPlayer(engine);\n''',
    '''function resolveSoloLap(engine: GameEngineState, group: PieceState[], ownedIds: string[], setups: PlayerAugmentSetups) {\n  if (!ownedIds.includes("P14")) return null;\n  const representativeId = setups.P14?.pieceId;\n  if (!representativeId || !group.some((piece) => piece.id === representativeId)) return null;\n  const player = engine.players.find((candidate) => (\n    candidate.pieces.some((piece) => piece.id === representativeId)\n  ));\n  if (!player) return null;\n''',
)

print("Applied stall fixes v8: solo laps resolve for the actual P14 representative owner.")
