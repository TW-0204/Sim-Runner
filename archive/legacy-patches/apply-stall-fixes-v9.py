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


# The normal engine already discards BACKDO when the current player has no
# usable on-board group. S16's simulation-only NAK path bypassed that normal
# roll settlement and could therefore strand a restored G13 BACKDO after NAK.
# Export the existing cleanup helper and invoke it only when a non-S16 owner
# finishes the NAK roll queue, preserving the normal owner compensation flow.
replace_once(
    "src/lib/game/engine.ts",
    '''function discardUnusableResults(\n  engine: GameEngineState,\n  ownedIds: string[] = [],\n  setups: PlayerAugmentSetups = {},\n) {\n''',
    '''export function discardUnusableResults(\n  engine: GameEngineState,\n  ownedIds: string[] = [],\n  setups: PlayerAugmentSetups = {},\n) {\n''',
)

replace_once(
    "src/lib/simulation/game.ts",
    '''import type { EngineMoveTarget } from "@/lib/game/engine";\n''',
    '''import type { EngineMoveTarget } from "@/lib/game/engine";\nimport { discardUnusableResults } from "@/lib/game/engine";\n''',
)

replace_once(
    "src/lib/simulation/game.ts",
    '''    if (owned.includes("S16")) {\n''',
    '''    if (!owned.includes("S16") && next.pendingRolls.length === 0) {\n      discardUnusableResults(next, owned, actorSetups(context, userId));\n    }\n    if (owned.includes("S16")) {\n''',
)

print("Applied stall fixes v9: S16 NAK now reuses normal unusable-BACKDO cleanup.")
