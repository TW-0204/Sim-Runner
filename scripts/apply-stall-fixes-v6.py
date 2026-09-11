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


# A13 can return the designated P14 runner directly to FINISHED. That must pass
# through the same lap-resolution path as an ordinary move finish, otherwise the
# runner remains FINISHED and P14 has no usable group on the next result.
replace_once(
    "src/lib/game/engine.ts",
    '''export function resolveDueWormholeReturns(\n  engineInput: GameEngineState,\n  userId: string,\n  ownedIds: string[],\n  random: () => number = Math.random,\n): GameEngineState {\n''',
    '''export function resolveDueWormholeReturns(\n  engineInput: GameEngineState,\n  userId: string,\n  ownedIds: string[],\n  setups: PlayerAugmentSetups = {},\n  random: () => number = Math.random,\n): GameEngineState {\n''',
)

replace_once(
    "src/lib/game/engine.ts",
    '''    } else if (selected.finished) {\n      for (const piece of pieces) {\n        piece.status = "FINISHED";\n        piece.node = null;\n        piece.hasEntered = true;\n      }\n      recordEchoFinish(engine, userId, groupId, true, ownedIds);\n      messages.push(`${pieces.length}개 말이 완주`);\n''',
    '''    } else if (selected.finished) {\n      for (const piece of pieces) {\n        piece.status = "FINISHED";\n        piece.node = null;\n        piece.hasEntered = true;\n      }\n      const soloLap = resolveSoloLap(engine, pieces, ownedIds, setups);\n      if (!soloLap) recordEchoFinish(engine, userId, groupId, true, ownedIds);\n      messages.push(soloLap === "LAP"\n        ? `${pieces.length}개 말이 웜홀 복귀로 독주 한 바퀴를 완주`\n        : `${pieces.length}개 말이 완주`);\n''',
)

replace_once(
    "src/lib/simulation/game.ts",
    '''  context.engine = resolveDueWormholeReturns(\n    context.engine,\n    returnActor.userId,\n    actorOwned(context, returnActor.userId),\n    context.rng.effect.next,\n  );\n''',
    '''  context.engine = resolveDueWormholeReturns(\n    context.engine,\n    returnActor.userId,\n    actorOwned(context, returnActor.userId),\n    actorSetups(context, returnActor.userId),\n    context.rng.effect.next,\n  );\n''',
)

print("Applied stall fixes v6: P14 wormhole finishes now resolve as solo laps.")
