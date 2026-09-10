from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:220]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# Regression fix uncovered while validating A01: A13 + G13 could strand a mandatory stored result
# after the only movable group entered the wormhole. Do not change A01 behavior; only reject that
# impossible wormhole choice and teach the simulation bot not to choose it.
replace_once(
    "src/lib/game/engine.ts",
    '''  const originNode = group[0].node;\n  if (originNode == null || group.some((piece) => piece.node !== originNode)) throw new Error("웜홀 묶음 위치가 일치하지 않습니다.");\n\n  clearJunctionBoostForGroup(engine, userId, groupId);\n''',
    '''  const originNode = group[0].node;\n  if (originNode == null || group.some((piece) => piece.node !== originNode)) throw new Error("웜홀 묶음 위치가 일치하지 않습니다.");\n\n  if (engine.results.length > 0) {\n    const hasOtherMovablePiece = player.pieces.some((piece) => (\n      piece.groupId !== groupId && (piece.status === "WAITING" || piece.status === "ON_BOARD")\n    ));\n    const hasMarginReturn = ownedIds.includes("A16")\n      && player.pieces.some((piece) => piece.status === "MARGIN")\n      && engine.results.some((result) => !result.numericPool && ["DO", "GAE", "GEOL", "YUT", "MO"].includes(result.face));\n    if (!hasOtherMovablePiece && !hasMarginReturn) {\n      throw new Error("남아 있는 이동 결과를 사용할 말이 없어 웜홀에 보낼 수 없습니다.");\n    }\n  }\n\n  clearJunctionBoostForGroup(engine, userId, groupId);\n''',
)

replace_once(
    "src/lib/simulation/game.ts",
    '''  if (!groups.size) {\n    context.engine = expireWormholeForCurrentRound(engine, actor.userId, owned);\n    return false;\n  }\n\n  const selected = [...groups.entries()].sort((left, right) => {\n''',
    '''  if (!groups.size) {\n    context.engine = expireWormholeForCurrentRound(engine, actor.userId, owned);\n    return false;\n  }\n\n  if (engine.results.length > 0 && groups.size === 1) {\n    const onlyGroupId = groups.keys().next().value as string | undefined;\n    const hasWaitingPiece = actor.pieces.some((piece) => piece.status === "WAITING");\n    const hasMarginReturn = owned.includes("A16")\n      && actor.pieces.some((piece) => piece.status === "MARGIN")\n      && engine.results.some((result) => !result.numericPool && ["DO", "GAE", "GEOL", "YUT", "MO"].includes(result.face));\n    if (onlyGroupId && !hasWaitingPiece && !hasMarginReturn) {\n      context.engine = expireWormholeForCurrentRound(engine, actor.userId, owned);\n      return false;\n    }\n  }\n\n  const selected = [...groups.entries()].sort((left, right) => {\n''',
)

print("Applied A13/G13 regression fix: wormhole cannot strand an existing movement result.")
