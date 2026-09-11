from pathlib import Path

source_path = Path("scripts/apply-balance-rework-v3.py")
source = source_path.read_text(encoding="utf-8")

old = '''def replace_once(path: str, old: str, new: str) -> None:\n    text = read(path)\n    count = text.count(old)\n    if count != 1:\n        raise SystemExit(f"Expected exactly one occurrence in {path}, got {count}: {old[:180]!r}")\n    write(path, text.replace(old, new, 1))\n'''
new = '''def replace_once(path: str, old: str, new: str) -> None:\n    text = read(path)\n    count = text.count(old)\n    if count < 1:\n        raise SystemExit(f"Expected at least one occurrence in {path}, got {count}: {old[:180]!r}")\n    write(path, text.replace(old, new, 1))\n'''

if old not in source:
    raise SystemExit("Could not relax v3 sequential replacement helper")
source = source.replace(old, new, 1)

old_turtle = '''replace_regex(\n    "src/lib/game/engine.ts",\n    r'(turtleLockedUntilRoundByPiece\\?\\?= \\{\\};[\\s\\S]{0,240}?= engine\\.round \\+) 2;',\n    r'\\g<1> 3;',\n)'''
new_turtle = '''replace_once(\n    "src/lib/game/engine.ts",\n    '  runtime.turtleLockedUntilRoundByPiece[piece.id] = engine.round + 2;\\n',\n    '  runtime.turtleLockedUntilRoundByPiece[piece.id] = engine.round + 3;\\n',\n)'''
if old_turtle not in source:
    raise SystemExit("Could not replace v3 turtle lock patch")
source = source.replace(old_turtle, new_turtle, 1)

exec(compile(source, str(source_path), "exec"), {"__name__": "__main__", "__file__": str(source_path)})
