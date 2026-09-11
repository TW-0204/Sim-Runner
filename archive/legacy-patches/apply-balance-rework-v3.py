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


def replace_catalog_line(augment_id: str, line: str) -> None:
    path = "src/lib/augments/catalog.ts"
    text = read(path)
    pattern = rf'^  \{{ id: "{re.escape(augment_id)}"[^\n]*\}},$'
    next_text, n = re.subn(pattern, line, text, count=1, flags=re.M)
    if n != 1:
        raise SystemExit(f"Could not replace catalog line for {augment_id}")
    write(path, next_text)


def remove_catalog_line(augment_id: str) -> None:
    path = "src/lib/augments/catalog.ts"
    text = read(path)
    pattern = rf'^  \{{ id: "{re.escape(augment_id)}"[^\n]*\}},\n'
    next_text, n = re.subn(pattern, "", text, count=1, flags=re.M)
    if n != 1:
        raise SystemExit(f"Could not remove catalog line for {augment_id}")
    write(path, next_text)


# ---------------------------------------------------------------------------
# Catalog: user-approved balance rework v3
# ---------------------------------------------------------------------------
replace_catalog_line(
    "A10",
    '  { id: "A10", name: "배반", tier: "gold", description: "자신의 대기 중인 말 1기를 무작위 상대 플레이어의 소유로 변경합니다. 배반한 말로 원래 주인의 말을 잡으면 추가 던지기 1회를 더 얻습니다. 배반한 말이 완주하면 원래 주인의 대기 상태로 돌아갑니다." },',
)
replace_catalog_line(
    "S15",
    '  { id: "S15", name: "무임승차", tier: "prism", description: "이동을 마친 뒤 경로 기준 앞뒤 1칸의 아군 한 묶음을 불러와 업을 수 있습니다. 이 효과로 합친 묶음은 최대 2개의 말까지만 가능합니다." },',
)
replace_catalog_line(
    "G01",
    '  { id: "G01", name: "개판", tier: "prism", description: "개가 추가 던지기를 만들고, 윷과 모는 더 이상 추가 던지기를 만들지 않습니다. 자신의 말은 한 묶음에 최대 2개까지만 업을 수 있으며, 개로 얻는 추가 던지기는 한 턴 최대 2회입니다." },',
)
replace_catalog_line(
    "P02",
    '  { id: "P02", name: "문워크", tier: "prism", timing: "last", special: true, uniquePerGame: true, description: "획득 즉시 대기 중인 모든 말을 윷판의 무작위 위치로 강제 이동시킵니다. 이후 양수 이동은 말판 전체를 역방향으로 진행하고 백도는 정방향으로 진행합니다. 자신의 네 말을 모두 대기로 되돌리면 즉시 승리합니다." },',
)
replace_catalog_line(
    "P14",
    '  { id: "P14", name: "독주", tier: "prism", timing: "first", special: true, description: "대표 말 하나만 사용할 수 있으며 그 말로 말판을 세 바퀴 완주하면 승리합니다." },',
)
replace_catalog_line(
    "P19",
    '  { id: "P19", name: "신의 손", tier: "prism", timing: "not-last", conflicts: fixedRollConflicts.filter((id) => id !== "P19"), description: "기본 던지기 2회마다 1회 충전되며, 충전을 소모해 다음 기본 결과를 원하는 도, 개, 걸, 윷, 모로 바꿀 수 있습니다." },',
)
replace_catalog_line(
    "G11",
    '  { id: "G11", name: "보험 들었습니다", tier: "gold", description: "2개 이상 업힌 자신의 말 묶음이 잡힐 때 말 1개만 그 칸에 남고 나머지는 대기로 돌아갑니다." },',
)
replace_catalog_line(
    "S02",
    '  { id: "S02", name: "어부바", tier: "silver", description: "자신의 말을 새로 업한 횟수가 누적 4회가 될 때마다 추가 던지기 1회를 얻습니다." },',
)
replace_catalog_line(
    "P09",
    '  { id: "P09", name: "길은 내가 만든다", tier: "prism", description: "갈림길에 정확히 멈추지 않아도 지나가는 순간 원하는 지름길로 진입할 수 있습니다." },',
)
replace_catalog_line(
    "A15",
    '  { id: "A15", name: "토끼와 거북이", tier: "gold", timing: "first", description: "대기 중인 자신의 말 1기를 완주 바로 앞 칸으로 보냅니다. 그 말은 3라운드 동안 이동하거나 업을 수 없지만 상대에게 잡힐 수 있습니다." },',
)
replace_catalog_line(
    "P16",
    '  { id: "P16", name: "추노", tier: "prism", timing: "first", special: true, conflicts: ["G15"], description: "기본 승리 조건 대신 상대 말 잡기를 2인 7회, 3인 19회, 4인 30회 달성하면 즉시 승리합니다." },',
)
replace_catalog_line(
    "A02",
    '  { id: "A02", name: "뽑기 기계", tier: "prism", description: "획득 1라운드 후부터 2라운드마다 판 위의 내 말 또는 상대 말 1기를 골라 원하는 칸으로 이동을 시도합니다. 20%는 지정 칸, 80%는 다른 무작위 칸으로 이동하며 강제 이동 순간 잡기는 발생하지 않습니다." },',
)
replace_catalog_line(
    "S05",
    '  { id: "S05", name: "안전벨트", tier: "gold", description: "2개 이상 업힌 말이 잡혀도 상대는 그 잡기로 추가 던지기를 얻지 못합니다." },',
)
replace_catalog_line(
    "G10",
    '  { id: "G10", name: "추격자", tier: "silver", description: "이동 경로 위 상대에게 일찍 멈춰 그 말을 잡을 수 있습니다. 이 효과로 잡을 때는 추가 던지기를 얻지 않습니다." },',
)
replace_catalog_line(
    "A14",
    '  { id: "A14", name: "역병", tier: "gold", description: "상대를 잡으면 그 말을 감염 상태로 만듭니다. 감염된 말은 대기에서 출발할 때 걸, 윷, 모가 나와야 출발할 수 있으며, 출발에 성공하면 감염이 해제됩니다." },',
)
replace_catalog_line(
    "A07",
    '  { id: "A07", name: "폭탄!", tier: "prism", timing: "first", description: "5라운드 종료 시 판 위의 모든 말을 대기로 돌려보냅니다. 상대 묶음 수에 따라 인원별 기준으로 추가 던지기를 얻습니다." },',
)
replace_catalog_line(
    "A09",
    '  { id: "A09", name: "메아리", tier: "silver", timing: "first", description: "가장 먼저 완주한 자신의 말의 실제 경로를 저장합니다. 이후 새로 출발하는 자신의 말 2기가 차례로 같은 갈림길 경로를 따라갑니다." },',
)
replace_catalog_line(
    "S13",
    '  { id: "S13", name: "자리비움", tier: "silver", timing: "first", description: "2라운드 동안 턴을 쉽니다. 자리비움이 끝난 뒤 돌아오는 턴에 추가 던지기 1회를 얻고, 이후 게임이 끝날 때까지 자신의 전진 이동량이 +1칸 증가합니다." },',
)
replace_catalog_line(
    "P06",
    '  { id: "P06", name: "청소부", tier: "prism", description: "다음 4번의 이동은 지나가는 모든 칸과 도착 칸의 상대를 전부 잡습니다." },',
)
replace_catalog_line(
    "S06",
    '  { id: "S06", name: "출발이 반", tier: "silver", description: "말이 대기 상태에서 말판으로 출발할 때마다 그 이동량이 +2칸 증가합니다." },',
)
replace_catalog_line(
    "A16",
    '  { id: "A16", name: "여백의 미", tier: "prism", timing: "first", description: "말이 완주할 때마다 이후 자신의 말이 완주에 필요한 바깥 변이 하나씩 줄어듭니다. 사라진 변으로 향하는 경로는 이용할 수 없습니다." },',
)
replace_catalog_line(
    "P04",
    '  { id: "P04", name: "우주의 중심", tier: "prism", timing: "first", special: true, uniquePerGame: true, conflicts: ["P10"], description: "네 말을 중앙에 하나의 묶음으로 모으면 즉시 승리합니다. 중앙에 도착한 자신의 말 수가 1개면 추가 던지기 1회, 2개면 추가 던지기 1회와 모든 상대의 다음 1턴 이동 정지, 3개면 남은 말 1개를 가장 가까운 모퉁이로 강제 이동시킵니다. 이 강제 이동은 잡기를 일으키지 않습니다." },',
)
replace_catalog_line(
    "A01",
    '  { id: "A01", name: "중력 폭발", tier: "prism", description: "획득 즉시 판 위의 모든 말을 내부 경로의 무작위 칸으로 강제 이동시키며, 이후 3라운드마다 반복합니다." },',
)

# Old P18 conflicts with the renamed S15, and low-sample upgrade chains are removed from the pool.
for obsolete_id in ["P18", "G02", "P01", "P05", "P07", "P15"]:
    remove_catalog_line(obsolete_id)


# ---------------------------------------------------------------------------
# Simple numeric/mechanical tuning
# ---------------------------------------------------------------------------
# G01: max two GAE-generated extra rolls per turn.
replace_once(
    "src/lib/augments/effects.ts",
    '  return (runtime.g01ExtraRollsGranted ?? 0) < 3;\n',
    '  return (runtime.g01ExtraRollsGranted ?? 0) < 2;\n',
)

# S02: every four successful stack events.
replace_once(
    "src/lib/augments/effects.ts",
    '  return runtime.piggybackStackCount % 3 === 0 ? 1 : 0;\n',
    '  return runtime.piggybackStackCount % 4 === 0 ? 1 : 0;\n',
)

# S06: +2 on departure.
replace_once(
    "src/lib/augments/effects.ts",
    '  if (has(ownedIds, "S06") && representative.status === "WAITING") bonus += 1;\n',
    '  if (has(ownedIds, "S06") && representative.status === "WAITING") bonus += 2;\n',
)

# P06: four cleaner movements.
replace_once(
    "src/lib/augments/effects.ts",
    '  return Math.max(0, 3 - (engine.augmentRuntime?.[userId]?.cleanerMovesUsed ?? 0));\n',
    '  return Math.max(0, 4 - (engine.augmentRuntime?.[userId]?.cleanerMovesUsed ?? 0));\n',
)

# P16: 7 / 19 / 30.
replace_regex(
    "src/lib/augments/effects.ts",
    r'export function huntCaptureTarget\(playerCount: number\) \{\n  if \(playerCount === 2\) return 7;\n  if \(playerCount === 3\) return \d+;\n  if \(playerCount === 4\) return \d+;\n  return \d+;\n\}',
    'export function huntCaptureTarget(playerCount: number) {\n  if (playerCount === 2) return 7;\n  if (playerCount === 3) return 19;\n  if (playerCount === 4) return 30;\n  return 30;\n}',
)

# P14: three laps.
replace_regex(
    "src/lib/game/engine.ts",
    r'  runtime\.soloLaps = \(runtime\.soloLaps \?\? 0\) \+ 1;\n  if \(runtime\.soloLaps >= 2\) \{\n    declareWinner\(engine, player\.userId, "SOLO_RUN", `\$\{player\.displayName\}: 독주 2바퀴 완주!`\);\n    return "WIN" as const;\n  \}\n([\s\S]*?)  engine\.lastAction = `\$\{player\.displayName\}: 독주 1바퀴 완주 · 마지막 한 바퀴!`;\n  return "LAP" as const;',
    '  runtime.soloLaps = (runtime.soloLaps ?? 0) + 1;\n  if (runtime.soloLaps >= 3) {\n    declareWinner(engine, player.userId, "SOLO_RUN", `${player.displayName}: 독주 3바퀴 완주!`);\n    return "WIN" as const;\n  }\n\\1  engine.lastAction = `${player.displayName}: 독주 ${runtime.soloLaps}바퀴 완주 · ${3 - runtime.soloLaps}바퀴 남음`;\n  return "LAP" as const;',
    flags=re.M,
)

# P19: no initial charge, charge every two BASIC rolls.
replace_once(
    "src/lib/game/roll-flow.ts",
    '  return engine.augmentRuntime?.[userId]?.godHandCharges ?? 1;\n',
    '  return engine.augmentRuntime?.[userId]?.godHandCharges ?? 0;\n',
)
replace_once(
    "src/lib/game/roll-flow.ts",
    '  runtime.godHandCharges ??= 1;\n',
    '  runtime.godHandCharges ??= 0;\n',
)
replace_once(
    "src/lib/game/roll-flow.ts",
    '  if (runtime.godHandBasicProgress >= 3) {\n',
    '  if (runtime.godHandBasicProgress >= 2) {\n',
)
# applyGodHandRoll contains its own default initializer too.
replace_once(
    "src/lib/game/roll-flow.ts",
    '  runtime.godHandCharges ??= 1;\n',
    '  runtime.godHandCharges ??= 0;\n',
)

# A15: lock for three rounds.
replace_regex(
    "src/lib/game/engine.ts",
    r'(turtleLockedUntilRoundByPiece\?\?= \{\};[\s\S]{0,240}?= engine\.round \+) 2;',
    r'\g<1> 3;',
)

# A02: acquisition delay one round, success 20%, cooldown after use remains two rounds.
replace_once(
    "src/lib/game/engine.ts",
    '  runtime.gachaNextUseRound = engine.round + 2;\n',
    '  runtime.gachaNextUseRound = engine.round + 1;\n',
)
replace_once(
    "src/lib/game/engine.ts",
    '  const success = random() < 0.4;\n',
    '  const success = random() < 0.2;\n',
)

# A07: trigger after Round 5 (engine enters Round 6).
replace_once(
    "src/lib/simulation/game.ts",
    '  if (context.engine.round < 8) return false;\n',
    '  if (context.engine.round < 6) return false;\n',
)


# ---------------------------------------------------------------------------
# G15: stacking onto an accelerated piece must not carry/restart acceleration.
# ---------------------------------------------------------------------------
replace_regex(
    "src/lib/game/engine.ts",
    r'(export function applyStackChoice\([\s\S]*?if \(stack\) \{[\s\S]*?for \(const piece of player\.pieces\) \{[\s\S]*?\n    \}\n)(    engine\.lastAction = `\$\{player\.displayName\}: \$\{pending\.destination\}번에서 업었습니다\.`;)',
    r'\1    resetAthleteAccelerationForGroup(engine, player.userId, pending.movingGroupId, ownedIds);\n\2',
    flags=re.M,
)


# ---------------------------------------------------------------------------
# A10: betrayal bonus roll when the betrayed group captures its original owner.
# ---------------------------------------------------------------------------
replace_once(
    "src/lib/augments/effects.ts",
    'export function grantsBackdoMoveToken(ownedIds: string[]) {\n',
    '''export function betrayalCaptureBonusRoll(\n  engine: GameEngineState,\n  attackerUserId: string,\n  attackerGroupId: string,\n  victimUserId: string,\n) {\n  const attacker = engine.players.find((player) => player.userId === attackerUserId);\n  if (!attacker) return 0;\n  return attacker.pieces.some((piece) => (\n    piece.groupId === attackerGroupId\n    && piece.status === "ON_BOARD"\n    && piece.betrayalOriginalOwnerUserId === victimUserId\n  )) ? 1 : 0;\n}\n\nexport function grantsBackdoMoveToken(ownedIds: string[]) {\n''',
)
replace_once(
    "src/lib/game/engine.ts",
    '  blocksCaptureExtraRoll,\n',
    '  betrayalCaptureBonusRoll,\n  blocksCaptureExtraRoll,\n',
)
replace_once(
    "src/lib/game/engine.ts",
    '    if (!blocksCaptureExtraRoll(capturedGroup.length, victimOwned)) captureExtraRollCount += 1;\n',
    '    if (!blocksCaptureExtraRoll(capturedGroup.length, victimOwned)) captureExtraRollCount += 1;\n    captureExtraRollCount += betrayalCaptureBonusRoll(engine, mover.userId, movingGroupId, victim.ownerUserId);\n',
)
replace_once(
    "src/lib/game/capture-choice.ts",
    '  blocksCaptureExtraRoll,\n',
    '  betrayalCaptureBonusRoll,\n  blocksCaptureExtraRoll,\n',
)
replace_once(
    "src/lib/game/capture-choice.ts",
    '  if (!blocksCaptureExtraRoll(pieces.length, victimOwned)) pending.resumePendingRolls.push("CAPTURE");\n',
    '  if (!blocksCaptureExtraRoll(pieces.length, victimOwned)) pending.resumePendingRolls.push("CAPTURE");\n  if (betrayalCaptureBonusRoll(engine, decision.attackerUserId, decision.attackerGroupId, target.victimUserId) > 0) pending.resumePendingRolls.push("AUGMENT");\n',
)


# ---------------------------------------------------------------------------
# P02: on acquisition scatter every WAITING piece to a random valid board node.
# ---------------------------------------------------------------------------
replace_once(
    "src/lib/game/engine.ts",
    'export function isActorsTurn(engine: GameEngineState, userId: string) {\n',
    '''export function applyMoonwalkAcquisitionScatter(\n  engineInput: GameEngineState,\n  userId: string,\n  random: () => number = Math.random,\n) {\n  const engine = clone(engineInput);\n  const player = engine.players.find((candidate) => candidate.userId === userId);\n  if (!player) throw new Error("문워크 소유자를 찾지 못했습니다.");\n  const nodes = Array.from({ length: 29 }, (_, index) => index + 1);\n  for (const piece of player.pieces) {\n    if (piece.status !== "WAITING") continue;\n    const index = Math.min(nodes.length - 1, Math.floor(random() * nodes.length));\n    piece.status = "ON_BOARD";\n    piece.node = nodes[index] ?? 1;\n    piece.groupId = piece.id;\n    piece.hasEntered = true;\n  }\n  engine.lastAction = `${player.displayName}: 문워크 · 대기 중인 말을 무작위 위치로 강제 배치`;\n  return engine;\n}\n\nexport function isActorsTurn(engine: GameEngineState, userId: string) {\n''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '  applyMarginReturn,\n',
    '  applyMarginReturn,\n  applyMoonwalkAcquisitionScatter,\n',
)
replace_once(
    "src/lib/simulation/game.ts",
    '      context.ownedByUser[offer.userId] = upgradeOwnedList(context.ownedByUser[offer.userId] ?? [], acquiredId);\n',
    '      context.ownedByUser[offer.userId] = upgradeOwnedList(context.ownedByUser[offer.userId] ?? [], acquiredId);\n      if (acquiredId === "P02") context.engine = applyMoonwalkAcquisitionScatter(context.engine, offer.userId, context.rng.effect.next);\n',
)


# ---------------------------------------------------------------------------
# G11: no choice. Exactly one physical piece survives on the captured cell.
# ---------------------------------------------------------------------------
replace_once(
    "src/lib/game/capture-choice.ts",
    '''function restoreInsuredGroup(after: GameEngineState, beforePieces: PieceState[]) {\n  const player = playerFor(after, beforePieces[0]?.ownerUserId ?? "");\n  if (!player) return;\n  for (const original of beforePieces) {\n    const piece = player.pieces.find((candidate) => candidate.id === original.id);\n    if (!piece) continue;\n    piece.status = "ON_BOARD";\n    piece.node = original.node;\n    piece.groupId = original.groupId;\n    piece.hasEntered = original.hasEntered;\n  }\n}\n''',
    '''function restoreOneInsuredPiece(after: GameEngineState, beforePieces: PieceState[]) {\n  const original = [...beforePieces].sort((left, right) => left.id.localeCompare(right.id))[0];\n  if (!original) return null;\n  const player = playerFor(after, original.ownerUserId);\n  const piece = player?.pieces.find((candidate) => candidate.id === original.id);\n  if (!piece) return null;\n  piece.status = "ON_BOARD";\n  piece.node = original.node;\n  piece.groupId = piece.id;\n  piece.hasEntered = original.hasEntered;\n  return piece.id;\n}\n''',
)
replace_regex(
    "src/lib/game/capture-choice.ts",
    r'  for \(const \{ node, pieces: beforePieces \} of captured\) \{\n    const victim = beforePieces\[0\];\n    if \(!victim \|\| beforePieces\.length < 2\) continue;\n    const victimOwned = args\.ownedByUser\[victim\.ownerUserId\] \?\? \[\];\n    if \(!victimOwned\.includes\("G11"\)\) continue;\n    restoreInsuredGroup\(after, beforePieces\);\n    decisions\.push\(\{[\s\S]*?    \}\);\n  \}\n',
    '  for (const { pieces: beforePieces } of captured) {\n    const victim = beforePieces[0];\n    if (!victim || beforePieces.length < 2) continue;\n    const victimOwned = args.ownedByUser[victim.ownerUserId] ?? [];\n    if (!victimOwned.includes("G11")) continue;\n    restoreOneInsuredPiece(after, beforePieces);\n  }\n',
    flags=re.M,
)
replace_regex(
    "src/lib/game/capture-choice.ts",
    r'  if \(insuredOriginals\?\.length\) \{\n    restoreInsuredGroup\(engine, insuredOriginals\);[\s\S]*?  \}\n  return false;',
    '  if (insuredOriginals?.length) restoreOneInsuredPiece(engine, insuredOriginals);\n  return false;',
    flags=re.M,
)


# ---------------------------------------------------------------------------
# A14 Plague rework.
# ---------------------------------------------------------------------------
replace_once(
    "src/lib/augments/effects.ts",
    'export function adjustedResultForGroup(\n',
    '''export function infectPlaguePieceIds(engine: GameEngineState, userId: string, pieceIds: string[]) {\n  const runtime = runtimeForPlayer(engine, userId);\n  runtime.plaguePieceIds ??= {};\n  for (const pieceId of pieceIds) runtime.plaguePieceIds[pieceId] = true;\n}\n\nexport function adjustedResultForGroup(\n''',
)
replace_regex(
    "src/lib/augments/effects.ts",
    r'  const plaguePenalty = result\.face === "BACKDO" \|\| !isPlagueGroup\(engine, userId, groupId\) \? 0 : 3;',
    '  const plaguePenalty = 0;',
)
replace_once(
    "src/lib/game/engine.ts",
    '): EngineMoveTarget[] {\n  if (result.face !== "BACKDO" && result.finalSteps <= 0 && isPlagueGroup(engine, userId, piece.groupId)) {\n',
    '): EngineMoveTarget[] {\n  if (piece.status === "WAITING" && isPlagueGroup(engine, userId, piece.groupId) && !["GEOL", "YUT", "MO"].includes(result.face)) return [];\n  if (result.face !== "BACKDO" && result.finalSteps <= 0 && isPlagueGroup(engine, userId, piece.groupId)) {\n',
)
replace_regex(
    "src/lib/game/engine.ts",
    r'    const victimOwned = ownedByUser\[victim\.ownerUserId\] \?\? \[\];\n    if \(moverOwned\.includes\("A14"\)\) \{\n      infectPlagueGroup\(engine, victim\.ownerUserId, victim\.groupId\);\n      continue;\n    \}\n',
    '    const victimOwned = ownedByUser[victim.ownerUserId] ?? [];\n',
)
replace_regex(
    "src/lib/game/engine.ts",
    r'    if \(isPlagueGroup\(engine, victim\.ownerUserId, victim\.groupId\)\) \{\n      infectPlagueGroup\(engine, mover\.userId, movingGroupId\);\n    \}\n    clearPlagueForGroup\(engine, victim\.ownerUserId, victim\.groupId\);\n    returnPiecesAfterEnemyCapture\(capturedGroup, victimOwned\);',
    '    const capturedPieceIds = capturedGroup.map((piece) => piece.id);\n    clearPlagueForGroup(engine, victim.ownerUserId, victim.groupId);\n    returnPiecesAfterEnemyCapture(capturedGroup, victimOwned);\n    if (moverOwned.includes("A14")) infectPlaguePieceIds(engine, victim.ownerUserId, capturedPieceIds);',
)
replace_once(
    "src/lib/game/engine.ts",
    '  infectPlagueGroup,\n',
    '  infectPlagueGroup,\n  infectPlaguePieceIds,\n',
)
replace_once(
    "src/lib/game/engine.ts",
    '  const effectiveResult = adjustedMoonwalkResult(engine, mover.userId, args.groupId, result, ownedIds, setups);\n',
    '  const wasPlagueDeparture = startedWaiting && isPlagueGroup(engine, mover.userId, args.groupId);\n  const effectiveResult = adjustedMoonwalkResult(engine, mover.userId, args.groupId, result, ownedIds, setups);\n',
)
replace_once(
    "src/lib/game/engine.ts",
    '  if (!moonwalk) recordEchoFinish(engine, mover.userId, args.groupId, finished, ownedIds);\n',
    '  if (wasPlagueDeparture && result.face !== "BACKDO") clearPlagueForGroup(engine, mover.userId, args.groupId);\n  if (!moonwalk) recordEchoFinish(engine, mover.userId, args.groupId, finished, ownedIds);\n',
)
replace_once(
    "src/lib/game/capture-choice.ts",
    '  infectPlagueGroup,\n',
    '  infectPlagueGroup,\n  infectPlaguePieceIds,\n',
)
replace_regex(
    "src/lib/game/capture-choice.ts",
    r'  if \(isPlagueGroup\(engine, target\.victimUserId, target\.victimGroupId\)\) \{\n    infectPlagueGroup\(engine, decision\.attackerUserId, decision\.attackerGroupId\);\n  \}\n  clearPlagueForGroup\(engine, target\.victimUserId, target\.victimGroupId\);\n  returnPiecesAfterEnemyCapture\(pieces, victimOwned\);\n  const attackerOwned = ownedByUser\[decision\.attackerUserId\] \?\? \[\];',
    '  const capturedPieceIds = pieces.map((piece) => piece.id);\n  clearPlagueForGroup(engine, target.victimUserId, target.victimGroupId);\n  returnPiecesAfterEnemyCapture(pieces, victimOwned);\n  const attackerOwned = ownedByUser[decision.attackerUserId] ?? [];\n  if (attackerOwned.includes("A14")) infectPlaguePieceIds(engine, target.victimUserId, capturedPieceIds);',
)


# ---------------------------------------------------------------------------
# A09 Echo: two sequential followers.
# ---------------------------------------------------------------------------
replace_once(
    "src/lib/game/types.ts",
    '  echoCompleted?: boolean;\n',
    '  echoCompleted?: boolean;\n  echoFollowersRemaining?: number;\n',
)
replace_regex(
    "src/lib/augments/effects.ts",
    r'  if \(!runtime\.echoRouteCaptured \|\| runtime\.echoCompleted \|\| runtime\.echoFollowerPieceId\) return;\n',
    '  if (!runtime.echoRouteCaptured || runtime.echoCompleted || runtime.echoFollowerPieceId || (runtime.echoFollowersRemaining ?? 0) <= 0) return;\n',
)
replace_once(
    "src/lib/augments/effects.ts",
    '    runtime.echoBranchChoices = echoBranchChoicesFromHistory(source.pathHistory);\n    return;\n',
    '    runtime.echoBranchChoices = echoBranchChoicesFromHistory(source.pathHistory);\n    runtime.echoFollowersRemaining = 2;\n    return;\n',
)
replace_once(
    "src/lib/augments/effects.ts",
    '  if (followerId && group.some((piece) => piece.id === followerId)) runtime.echoCompleted = true;\n',
    '''  if (followerId && group.some((piece) => piece.id === followerId)) {\n    runtime.echoFollowersRemaining = Math.max(0, (runtime.echoFollowersRemaining ?? 1) - 1);\n    delete runtime.echoFollowerPieceId;\n    if ((runtime.echoFollowersRemaining ?? 0) <= 0) runtime.echoCompleted = true;\n  }\n''',
)


# ---------------------------------------------------------------------------
# S13 Vacancy: permanent +1 and one return bonus roll.
# ---------------------------------------------------------------------------
replace_once(
    "src/lib/game/types.ts",
    '  vacancySkipsRemaining?: number;\n',
    '  vacancySkipsRemaining?: number;\n  vacancyReturnBonusPending?: boolean;\n  vacancyReturnBonusGranted?: boolean;\n',
)
replace_regex(
    "src/lib/game/roll-flow.ts",
    r'function applyVacancyBasicBonus\([\s\S]*?\n\}\n\nfunction applyBasicMovementBonuses\([\s\S]*?\n\}',
    '''function applyBasicMovementBonuses(engine: GameEngineState, userId: string, ownedIds: string[], token: RollToken) {\n  return applyRevengeBasicBonus(engine, userId, ownedIds, token);\n}''',
    flags=re.M,
)
replace_once(
    "src/lib/augments/effects.ts",
    '  let bonus = 0;\n',
    '  let bonus = 0;\n  if (has(ownedIds, "S13") && engine.augmentRuntime?.[userId]?.vacancyInitialized && (engine.augmentRuntime?.[userId]?.vacancySkipsRemaining ?? 2) <= 0) bonus += 1;\n',
)
replace_once(
    "src/lib/simulation/game.ts",
    '  runtime.vacancySkipsRemaining = remaining - 1;\n  const remainingAfter = runtime.vacancySkipsRemaining;\n',
    '  runtime.vacancySkipsRemaining = remaining - 1;\n  const remainingAfter = runtime.vacancySkipsRemaining;\n  if (remainingAfter <= 0) runtime.vacancyReturnBonusPending = true;\n',
)
replace_once(
    "src/lib/simulation/game.ts",
    '    : `${player.displayName}: 자리비움 종료 · Round 9까지 기본 양수 이동 +1 · ${following.displayName}의 턴`;\n',
    '    : `${player.displayName}: 자리비움 종료 · 다음 자기 턴 추가 던지기 1회 · 이후 전진 이동 +1 · ${following.displayName}의 턴`;\n',
)
replace_once(
    "src/lib/simulation/game.ts",
    '  const remaining = runtime.vacancySkipsRemaining ?? 0;\n  if (remaining <= 0) return false;\n',
    '''  const remaining = runtime.vacancySkipsRemaining ?? 0;\n  if (remaining <= 0) {\n    if (runtime.vacancyReturnBonusPending && !runtime.vacancyReturnBonusGranted) {\n      runtime.vacancyReturnBonusPending = false;\n      runtime.vacancyReturnBonusGranted = true;\n      next.pendingRolls.push("AUGMENT");\n      next.lastAction = `${player.displayName}: 자리비움 복귀 · 추가 던지기 1회`;\n      context.engine = next;\n      return true;\n    }\n    return false;\n  }\n''',
)


# ---------------------------------------------------------------------------
# A01 Gravity Explosion: immediate, then every three rounds.
# ---------------------------------------------------------------------------
replace_once(
    "src/lib/game/engine.ts",
    '  engine.augmentRuntime[sourceUserId].gravityExplosionResolved = true;\n',
    '  engine.augmentRuntime[sourceUserId].gravityExplosionResolved = false;\n  engine.augmentRuntime[sourceUserId].gravityExplosionRound = engine.round + 3;\n',
)
replace_regex(
    "src/lib/simulation/game.ts",
    r'      if \(acquiredId === "A01"\) \{\n        ideaRuntime\.gravityExplosionRound = context\.engine\.round \+ \(eventIndex === 0 \? 8 : 4\);\n        ideaRuntime\.gravityExplosionResolved = false;\n      \}',
    '      if (acquiredId === "A01") {\n        ideaRuntime.gravityExplosionRound = context.engine.round;\n        ideaRuntime.gravityExplosionResolved = false;\n      }',
)
replace_once(
    "src/lib/simulation/game.ts",
    '    if (runtime?.gravityExplosionResolved || runtime?.gravityExplosionRound == null) continue;\n',
    '    if (runtime?.gravityExplosionRound == null) continue;\n',
)


# ---------------------------------------------------------------------------
# A16 Margin rework: disable old margin actions, shrink finish boundary.
# ---------------------------------------------------------------------------
replace_regex(
    "src/lib/simulation/game.ts",
    r'function maybeUseMarginExit\(context: SimulationContext\) \{[\s\S]*?\n\}\n\nfunction maybeReturnMargin',
    'function maybeUseMarginExit(_context: SimulationContext) {\n  return false;\n}\n\nfunction maybeReturnMargin',
    flags=re.M,
)
replace_regex(
    "src/lib/simulation/game.ts",
    r'function maybeReturnMargin\(context: SimulationContext, engine: GameEngineState, userId: string\) \{[\s\S]*?\n\}\n\nfunction maybeUseWormhole',
    'function maybeReturnMargin(_context: SimulationContext, _engine: GameEngineState, _userId: string) {\n  return null;\n}\n\nfunction maybeUseWormhole',
    flags=re.M,
)
replace_once(
    "src/lib/game/engine.ts",
    'function buildForwardTargetPlans(\n',
    '''function marginShrinkState(engine: GameEngineState, userId: string, ownedIds: string[]) {\n  if (!ownedIds.includes("A16")) return null;\n  const player = engine.players.find((candidate) => candidate.userId === userId);\n  const finishedCount = Math.min(3, player?.pieces.filter((piece) => piece.status === "FINISHED").length ?? 0);\n  if (finishedCount <= 0) return null;\n  if (finishedCount === 1) return { finishNode: 22, allowed: new Set([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]) };\n  if (finishedCount === 2) return { finishNode: 10, allowed: new Set([1,2,3,4,5,6,7,8,9,10]) };\n  return { finishNode: 5, allowed: new Set([1,2,3,4,5]) };\n}\n\nfunction applyMarginShrinkToForwardMove(\n  movement: ReturnType<typeof forwardMoveOptions>[number],\n  shrink: ReturnType<typeof marginShrinkState>,\n) {\n  if (!shrink) return movement;\n  const finishIndex = movement.traversed.indexOf(shrink.finishNode);\n  if (finishIndex >= 0) {\n    return { ...movement, finished: true, node: null, traversed: movement.traversed.slice(0, finishIndex + 1) };\n  }\n  if (movement.traversed.some((node) => !shrink.allowed.has(node))) return null;\n  return movement;\n}\n\nfunction buildForwardTargetPlans(\n''',
)
replace_once(
    "src/lib/game/engine.ts",
    '''  const movements = forwardMoveOptions(start, result.finalSteps, {\n    forbidShortcutEntry: result.forbidShortcuts,\n    allowPassingShortcutEntry: ownedIds.includes("P09"),\n    allowUniversalCenterChoice: ownedIds.includes("P04"),\n  });\n  const echoMovements = movements.filter((movement) => (\n''',
    '''  const rawMovements = forwardMoveOptions(start, result.finalSteps, {\n    forbidShortcutEntry: result.forbidShortcuts,\n    allowPassingShortcutEntry: ownedIds.includes("P09"),\n    allowUniversalCenterChoice: ownedIds.includes("P04"),\n  });\n  const shrink = marginShrinkState(engine, userId, ownedIds);\n  const movements = rawMovements\n    .map((movement) => applyMarginShrinkToForwardMove(movement, shrink))\n    .filter((movement): movement is NonNullable<typeof movement> => movement != null);\n  const echoMovements = movements.filter((movement) => (\n''',
)
replace_once(
    "src/lib/game/engine.ts",
    '  const start = piece.status === "WAITING" ? 0 : piece.node;\n  if (start == null) return [];\n',
    '''  const start = piece.status === "WAITING" ? 0 : piece.node;\n  if (start == null) return [];\n  const shrinkAtStart = marginShrinkState(engine, userId, ownedIds);\n  if (shrinkAtStart && start > 0 && !shrinkAtStart.allowed.has(start)) {\n    return [{ target: { node: null, finished: true, kind: "FORCED", path: [] }, interruption: null }];\n  }\n''',
)


# ---------------------------------------------------------------------------
# P04 Universe Center rewards. Existing 4-piece CENTER_STACK victory remains.
# ---------------------------------------------------------------------------
replace_once(
    "src/lib/game/types.ts",
    '  universeCenterGroups?: Record<string, boolean>;\n',
    '  universeCenterGroups?: Record<string, boolean>;\n  universeCenterRewardLevel?: number;\n  universeFreezeTurnsRemaining?: number;\n',
)
replace_once(
    "src/lib/game/engine.ts",
    '  FINISH_NODE,\n',
    '  BOARD_POSITIONS,\n  FINISH_NODE,\n',
)
replace_once(
    "src/lib/game/engine.ts",
    'function finishResolvedMove(engine: GameEngineState, captureExtraRollCount: number, augmentExtraRolls = 0, ownedIds: string[] = []) {\n',
    '''function nearestOuterCorner(node: number) {\n  const source = BOARD_POSITIONS[node];\n  const corners = [5, 10, 22, 29];\n  if (!source) return 29;\n  return corners\n    .map((corner) => {\n      const point = BOARD_POSITIONS[corner];\n      const distance = point ? Math.abs(source.x - point.x) + Math.abs(source.y - point.y) : Number.POSITIVE_INFINITY;\n      return { corner, distance };\n    })\n    .sort((left, right) => left.distance - right.distance || left.corner - right.corner)[0]?.corner ?? 29;\n}\n\nfunction applyUniverseCenterRewards(engine: GameEngineState, userId: string, ownedIds: string[]) {\n  if (!ownedIds.includes("P04")) return 0;\n  const player = engine.players.find((candidate) => candidate.userId === userId);\n  if (!player) return 0;\n  const centerCount = player.pieces.filter((piece) => piece.status === "ON_BOARD" && piece.node === 15).length;\n  const runtime = runtimeForWormhole(engine, userId);\n  const previousLevel = runtime.universeCenterRewardLevel ?? 0;\n  const nextLevel = Math.max(previousLevel, Math.min(3, centerCount));\n  if (nextLevel <= previousLevel) return 0;\n  let bonusRolls = 0;\n  for (let level = previousLevel + 1; level <= nextLevel; level += 1) {\n    if (level === 1) bonusRolls += 1;\n    if (level === 2) {\n      bonusRolls += 1;\n      for (const opponent of engine.players) {\n        if (opponent.userId === userId) continue;\n        const opponentRuntime = runtimeForWormhole(engine, opponent.userId);\n        opponentRuntime.universeFreezeTurnsRemaining = Math.max(1, opponentRuntime.universeFreezeTurnsRemaining ?? 0);\n      }\n    }\n    if (level === 3) {\n      const remaining = player.pieces.find((piece) => !(piece.status === "ON_BOARD" && piece.node === 15));\n      if (remaining) {\n        const oldGroupId = remaining.groupId;\n        if (remaining.status === "ON_BOARD") {\n          clearGroupMoveFixedToOne(engine, userId, oldGroupId);\n          clearJunctionBoostForGroup(engine, userId, oldGroupId);\n          clearPathControlForGroup(engine, userId, oldGroupId);\n          resetAthleteAccelerationForGroup(engine, userId, oldGroupId, ownedIds);\n        }\n        const destination = remaining.status === "WAITING" || remaining.node == null ? 29 : nearestOuterCorner(remaining.node);\n        remaining.status = "ON_BOARD";\n        remaining.node = destination;\n        remaining.groupId = remaining.id;\n        remaining.hasEntered = true;\n        remaining.pathHistory.push(destination);\n      }\n    }\n  }\n  runtime.universeCenterRewardLevel = nextLevel;\n  return bonusRolls;\n}\n\nfunction finishResolvedMove(engine: GameEngineState, captureExtraRollCount: number, augmentExtraRolls = 0, ownedIds: string[] = []) {\n''',
)
replace_once(
    "src/lib/game/engine.ts",
    '  engine.lastAction = `${mover.displayName} → ${destination}번${pathMessage}${cleanerText}${captureText}${rewardText}${waterGhostText}`;\n  if (checkSpecialWinner(engine, ownedIds)) return engine;\n\n  const relocationOpportunities = relocationOpportunitiesAfterMove(\n',
    '  const universeRewardRolls = applyUniverseCenterRewards(engine, mover.userId, ownedIds);\n  engine.lastAction = `${mover.displayName} → ${destination}번${pathMessage}${cleanerText}${captureText}${rewardText}${waterGhostText}`;\n  if (checkSpecialWinner(engine, ownedIds)) return engine;\n\n  const relocationOpportunities = relocationOpportunitiesAfterMove(\n',
)
replace_once(
    "src/lib/game/engine.ts",
    '      augmentExtraRolls: 0,\n',
    '      augmentExtraRolls: universeRewardRolls,\n',
)
replace_once(
    "src/lib/game/engine.ts",
    '      augmentExtraRolls: 0,\n',
    '      augmentExtraRolls: universeRewardRolls,\n',
)
replace_once(
    "src/lib/game/engine.ts",
    '  finishResolvedMove(engine, captures.captureExtraRollCount, 0, ownedIds);\n  return engine;\n}\n\nexport function applyRelocationChoice',
    '  finishResolvedMove(engine, captures.captureExtraRollCount, universeRewardRolls, ownedIds);\n  return engine;\n}\n\nexport function applyRelocationChoice',
)
replace_once(
    "src/lib/simulation/game.ts",
    'function maybeApplyVacancySkip(context: SimulationContext) {\n',
    '''function maybeApplyUniverseFreeze(context: SimulationContext) {\n  const engine = context.engine;\n  if (engine.stage !== "AWAITING_ROLL" || engine.pendingRolls[0] !== "BASIC") return false;\n  const player = currentPlayer(engine);\n  const remaining = engine.augmentRuntime?.[player.userId]?.universeFreezeTurnsRemaining ?? 0;\n  if (remaining <= 0) return false;\n  const next = structuredClone(engine);\n  next.augmentRuntime ??= {};\n  next.augmentRuntime[player.userId] ??= {};\n  next.augmentRuntime[player.userId].universeFreezeTurnsRemaining = remaining - 1;\n  advanceTurnForVacancy(next);\n  next.lastAction = `${player.displayName}: 우주의 중심 · 이동 정지`;\n  context.engine = next;\n  return true;\n}\n\nfunction maybeApplyVacancySkip(context: SimulationContext) {\n''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '  if (maybeApplyVacancySkip(context)) return;\n',
    '  if (maybeApplyUniverseFreeze(context)) return;\n  if (maybeApplyVacancySkip(context)) return;\n',
)


print("Applied balance rework v3: user-approved tier, timing, deletion, and mechanics changes.")
