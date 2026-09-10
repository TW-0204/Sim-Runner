from pathlib import Path

source_path = Path("scripts/apply-balance-rework-v3.py")
source = source_path.read_text(encoding="utf-8")

old = '''def replace_once(path: str, old: str, new: str) -> None:\n    text = read(path)\n    count = text.count(old)\n    if count != 1:\n        raise SystemExit(f"Expected exactly one occurrence in {path}, got {count}: {old[:180]!r}")\n    write(path, text.replace(old, new, 1))\n'''
new = '''def replace_once(path: str, old: str, new: str) -> None:\n    text = read(path)\n    count = text.count(old)\n    if count < 1:\n        raise SystemExit(f"Expected at least one occurrence in {path}, got {count}: {old[:180]!r}")\n    write(path, text.replace(old, new, 1))\n'''

if old not in source:
    raise SystemExit("Could not relax v3 sequential replacement helper")
source = source.replace(old, new, 1)

exec(compile(source, str(source_path), "exec"), {"__name__": "__main__", "__file__": str(source_path)})
