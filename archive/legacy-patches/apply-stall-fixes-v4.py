from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one occurrence in {path}, got {count}: {old[:180]!r}")
    write(path, text.replace(old, new, 1))


def replace_regex(path: str, pattern: str, repl: str, *, count: int = 1, flags: int = 0) -> None:
    text = read(path)
    next_text, n = re.subn(pattern, repl, text, count=count, flags=flags)
    if n != count:
        raise SystemExit(f"Regex replacement mismatch in {path}: got {n}, expected {count}: {pattern[:180]!r}")
    write(path, next_text)


# A16 여백의 미
# 1) 현재 축소된 완주 경계에 이미 서 있으면 다음 양수 이동으로 즉시 완주한다.
# 2) 기본 지름길이 사라진 변으로 들어가 모든 후보가 제거되면 외곽 경로로 재계산한다.
replace_once(
    "src/lib/game/engine.ts",
    '''  const start = piece.status === "WAITING" ? 0 : piece.node;\n  if (start == null) return [];\n  const shrinkAtStart = marginShrinkState(engine, userId, ownedIds);\n  if (shrinkAtStart && start > 0 && !shrinkAtStart.allowed.has(start)) {\n    return [{ target: { node: null, finished: true, kind: "FORCED", path: [] }, interruption: null }];\n  }\n  const rawMovements = forwardMoveOptions(start, result.finalSteps, {\n    forbidShortcutEntry: result.forbidShortcuts,\n    allowPassingShortcutEntry: ownedIds.includes("P09"),\n    allowUniversalCenterChoice: ownedIds.includes("P04"),\n  });\n  const shrink = marginShrinkState(engine, userId, ownedIds);\n  const movements = rawMovements\n    .map((movement) => applyMarginShrinkToForwardMove(movement, shrink))\n    .filter((movement): movement is NonNullable<typeof movement> => movement != null);\n''',
    '''  const start = piece.status === "WAITING" ? 0 : piece.node;\n  if (start == null) return [];\n  const shrink = marginShrinkState(engine, userId, ownedIds);\n  if (shrink && start === shrink.finishNode) {\n    return [{ target: { node: null, finished: true, kind: "FORCED", path: [] }, interruption: null }];\n  }\n  if (shrink && start > 0 && !shrink.allowed.has(start)) {\n    return [{ target: { node: null, finished: true, kind: "FORCED", path: [] }, interruption: null }];\n  }\n  const shrinkMovements = (forbidShortcutEntry: boolean) => forwardMoveOptions(start, result.finalSteps, {\n    forbidShortcutEntry,\n    allowPassingShortcutEntry: ownedIds.includes("P09"),\n    allowUniversalCenterChoice: ownedIds.includes("P04"),\n  })\n    .map((movement) => applyMarginShrinkToForwardMove(movement, shrink))\n    .filter((movement): movement is NonNullable<typeof movement> => movement != null);\n  let movements = shrinkMovements(Boolean(result.forbidShortcuts));\n  if (shrink && movements.length === 0 && !result.forbidShortcuts) {\n    movements = shrinkMovements(true);\n  }\n''',
)

# G01 개판과 P11 대동단결은 규칙상 동시에 정상 실행될 수 없다.
# 오퍼 단계에서 함께 나오지 않게 양쪽 모두 충돌로 선언한다.
replace_regex(
    "src/lib/augments/catalog.ts",
    r'^  \{ id: "G01", name: "개판", tier: "prism", (?!conflicts:)[^\n]*\},$',
    lambda match: match.group(0).replace('tier: "prism", ', 'tier: "prism", conflicts: ["P11"], ', 1),
    flags=re.M,
)
replace_regex(
    "src/lib/augments/catalog.ts",
    r'^  \{ id: "P11", name: "대동단결", tier: "prism", (?!conflicts:)[^\n]*\},$',
    lambda match: match.group(0).replace('tier: "prism", ', 'tier: "prism", conflicts: ["G01"], ', 1),
    flags=re.M,
)

# 강제 배정 테스트나 과거 저장 상태에서도 충돌 조합이 들어올 수 있으므로
# 시뮬레이션 봇은 G01 보유 중 P11을 자동 발동하지 않는다.
replace_once(
    "src/lib/simulation/game.ts",
    '  if (!owned.includes("P11") || engine.stage !== "AWAITING_ROLL") return null;\n',
    '  if (!owned.includes("P11") || owned.includes("G01") || engine.stage !== "AWAITING_ROLL") return null;\n',
)

print("Applied stall fixes v4: A16 shortened-route fallback and G01/P11 conflict guard.")
