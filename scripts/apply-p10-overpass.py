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


# ---------------------------------------------------------------------------
# P10 고가도로: first-only outer-route movement, no +2 movement bonus,
# and immunity to augment-driven forced relocation.
# ---------------------------------------------------------------------------
replace_once(
    "src/lib/augments/catalog.ts",
    '  { id: "P02", name: "문워크", tier: "prism", timing: "last", special: true, uniquePerGame: true, description: "획득 즉시 대기 중인 모든 말을 윷판의 무작위 위치로 강제 이동시킵니다. 이후 양수 이동은 말판 전체를 역방향으로 진행하고 백도는 정방향으로 진행합니다. 자신의 네 말을 모두 대기로 되돌리면 즉시 승리합니다." },\n',
    '  { id: "P02", name: "문워크", tier: "prism", timing: "last", special: true, uniquePerGame: true, conflicts: ["P10"], description: "획득 즉시 대기 중인 모든 말을 윷판의 무작위 위치로 강제 이동시킵니다. 이후 양수 이동은 말판 전체를 역방향으로 진행하고 백도는 정방향으로 진행합니다. 자신의 네 말을 모두 대기로 되돌리면 즉시 승리합니다." },\n',
)
replace_once(
    "src/lib/augments/catalog.ts",
    '  { id: "P10", name: "고속 질주", tier: "prism", conflicts: ["P04"], description: "모든 전진 이동량이 +2칸 증가하지만 지름길을 사용할 수 없습니다." },\n',
    '  { id: "P10", name: "고가도로", tier: "prism", timing: "first", conflicts: ["P02", "P04"], description: "자신의 말은 바깥길로만 이동하며 다른 증강 효과에 의한 강제 이동 및 강제 재배치에 면역입니다. 말을 대기 상태로 되돌리는 효과는 정상 적용됩니다." },\n',
)

# Existing P10 movement routing already sets forbidShortcuts on every adjusted result.
# Remove only the retired +2 movement bonus and keep that outer-route behavior intact.
replace_once(
    "src/lib/augments/effects.ts",
    '  if (has(ownedIds, "P10")) bonus += 2;\n',
    '',
)

# Central predicate for all augment-driven forced relocation immunity.
replace_once(
    "src/lib/game/engine.ts",
    'const GRAVITY_INTERNAL_NODES = [11, 12, 13, 14, 15, 16, 17, 23, 24] as const;\n',
    '''export function isForcedRelocationImmune(ownedIds: string[]) {\n  return ownedIds.includes("P10");\n}\n\nconst GRAVITY_INTERNAL_NODES = [11, 12, 13, 14, 15, 16, 17, 23, 24] as const;\n''',
)

# A01 중력 폭발: use the common predicate instead of a one-off P10 check.
replace_once(
    "src/lib/game/engine.ts",
    '''    // P10 forces that player's movement to the outer route, so those pieces are explicitly exempt.\n    if ((ownedByUser[player.userId] ?? []).includes("P10")) continue;\n''',
    '''    if (isForcedRelocationImmune(ownedByUser[player.userId] ?? [])) continue;\n''',
)

# A08 대격변: an immune player's state, position, stacks, and relocation-related runtime are untouched.
replace_once(
    "src/lib/game/engine.ts",
    '''  for (const player of engine.players) {\n    const oldGroupIds = new Set(player.pieces.map((piece) => piece.groupId));\n''',
    '''  for (const player of engine.players) {\n    if (isForcedRelocationImmune(ownedByUser[player.userId] ?? [])) continue;\n    const oldGroupIds = new Set(player.pieces.map((piece) => piece.groupId));\n''',
)

# A02 뽑기 기계: immune pieces are not legal relocation targets at the engine boundary.
replace_once(
    "src/lib/game/engine.ts",
    '''  if (!targetPlayer || !piece || piece.status !== "ON_BOARD" || piece.node == null) {\n    throw new Error("뽑기 기계로 이동할 판 위의 말을 찾지 못했습니다.");\n  }\n\n  const oldGroupId = piece.groupId;\n''',
    '''  if (!targetPlayer || !piece || piece.status !== "ON_BOARD" || piece.node == null) {\n    throw new Error("뽑기 기계로 이동할 판 위의 말을 찾지 못했습니다.");\n  }\n  if (isForcedRelocationImmune(ownedByUser[targetUserId] ?? [])) {\n    throw new Error("고가도로 효과로 강제 이동할 수 없는 말입니다.");\n  }\n\n  const oldGroupId = piece.groupId;\n''',
)

# Simulation bot must never choose an immune A02 target, otherwise the engine guard above
# would correctly reject it but the simulation would treat that legal immunity as a stall.
replace_once(
    "src/lib/simulation/game.ts",
    '''  gachaMachineIsReady,\n  resolveDueWormholeReturns,\n''',
    '''  gachaMachineIsReady,\n  isForcedRelocationImmune,\n  resolveDueWormholeReturns,\n''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''  const ownCandidates = actor.pieces\n    .filter((piece) => piece.status === "ON_BOARD" && piece.node != null && piece.node !== 29)\n    .sort((left, right) => left.pathHistory.length - right.pathHistory.length);\n  const opponentCandidates = engine.players\n    .filter((player) => player.userId !== actor.userId)\n    .flatMap((player) => player.pieces.map((piece) => ({ player, piece })))\n''',
    '''  const ownCandidates = isForcedRelocationImmune(owned)\n    ? []\n    : actor.pieces\n      .filter((piece) => piece.status === "ON_BOARD" && piece.node != null && piece.node !== 29)\n      .sort((left, right) => left.pathHistory.length - right.pathHistory.length);\n  const opponentCandidates = engine.players\n    .filter((player) => (\n      player.userId !== actor.userId\n      && !isForcedRelocationImmune(actorOwned(context, player.userId))\n    ))\n    .flatMap((player) => player.pieces.map((piece) => ({ player, piece })))\n''',
)

print("Applied P10 Overpass rework: first-only outer route, no +2, and forced-relocation immunity.")
