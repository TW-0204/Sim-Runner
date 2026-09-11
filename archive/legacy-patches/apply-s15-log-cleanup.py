from pathlib import Path


def replace_count(path: str, old: str, new: str, expected: int) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"Expected {expected} occurrences in {path}, got {count}: {old[:220]!r}")
    p.write_text(text.replace(old, new), encoding="utf-8")


replace_count(
    "src/lib/game/engine.ts",
    '    const name = current.kind === "FRIEND" ? "친구와 함께" : "무임승차";\n',
    '    const name = "무임승차";\n',
    2,
)

print("Applied S15 naming cleanup: relocation logs now consistently use 무임승차.")
