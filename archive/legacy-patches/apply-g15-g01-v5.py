from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# G01: keep Prism, but cap GAE-generated extra rolls to two per turn.
replace_once(
    "src/lib/augments/catalog.ts",
    '{ id: "G01", name: "개판", tier: "prism", description: "개가 추가 던지기를 만들고, 윷과 모는 더 이상 추가 던지기를 만들지 않습니다." },',
    '{ id: "G01", name: "개판", tier: "prism", description: "개가 추가 던지기를 만들고, 윷과 모는 더 이상 추가 던지기를 만들지 않습니다. 개로 얻는 추가 던지기는 한 턴 최대 2회입니다." },',
)

# G15: redesigned as consecutive-move acceleration. Start at Gold for testing.
replace_once(
    "src/lib/augments/catalog.ts",
    '  { id: "G14", name: "각자도생", tier: "gold", description: "업힌 자신의 말이 갈림길에 정확히 도착하면 원하는 방식으로 분리할 수 있습니다." },\n',
    '  { id: "G14", name: "각자도생", tier: "gold", description: "업힌 자신의 말이 갈림길에 정확히 도착하면 원하는 방식으로 분리할 수 있습니다." },\n'
    '  { id: "G15", name: "육상선수", tier: "gold", description: "같은 자신의 말을 연속해서 이동시킬 때마다 해당 말의 전진 이동량이 +1칸 증가합니다. 가속은 최대 +3칸까지 증가하며, 다른 자신의 말을 이동시키거나 해당 말이 잡히면 초기화됩니다." },\n',
)

# Runtime for G01 per-turn cap and G15 acceleration.
replace_once(
    "src/lib/game/types.ts",
    '  g05StartRound?: number;\n',
    '  g05StartRound?: number;\n'
    '  g01ExtraTurnNumber?: number;\n'
    '  g01ExtraRollsGranted?: number;\n'
    '  athleteAcceleratingGroupId?: string;\n'
    '  athleteConsecutiveMoves?: number;\n',
)

# G01 grant helpers: pure eligibility + consuming capped grant.
replace_once(
    "src/lib/augments/effects.ts",
    '''export function grantsFaceExtraRoll(face: RollFace, ownedIds: string[]) {\n  if (has(ownedIds, "G01")) return face === "GAE";\n  return face === "YUT" || face === "MO";\n}\n''',
    '''export function grantsFaceExtraRoll(face: RollFace, ownedIds: string[]) {\n  if (has(ownedIds, "G01")) return face === "GAE";\n  return face === "YUT" || face === "MO";\n}\n\nexport function canGrantFaceExtraRoll(\n  engine: GameEngineState,\n  userId: string,\n  face: RollFace,\n  ownedIds: string[],\n) {\n  if (!grantsFaceExtraRoll(face, ownedIds)) return false;\n  if (!has(ownedIds, "G01")) return true;\n  const runtime = engine.augmentRuntime?.[userId];\n  if (runtime?.g01ExtraTurnNumber !== engine.turnNumber) return true;\n  return (runtime.g01ExtraRollsGranted ?? 0) < 2;\n}\n\nexport function consumeFaceExtraRollGrant(\n  engine: GameEngineState,\n  userId: string,\n  face: RollFace,\n  ownedIds: string[],\n) {\n  if (!canGrantFaceExtraRoll(engine, userId, face, ownedIds)) return false;\n  if (!has(ownedIds, "G01")) return true;\n  const runtime = runtimeForPlayer(engine, userId);\n  if (runtime.g01ExtraTurnNumber !== engine.turnNumber) {\n    runtime.g01ExtraTurnNumber = engine.turnNumber;\n    runtime.g01ExtraRollsGranted = 0;\n  }\n  runtime.g01ExtraRollsGranted = (runtime.g01ExtraRollsGranted ?? 0) + 1;\n  return true;\n}\n''',
)

# G15 bonus: first move has no bonus, then +1/+2/+3 on consecutive moves of the same group.
replace_once(
    "src/lib/augments/effects.ts",
    '  let bonus = 0;\n',
    '''  let bonus = 0;\n  if (has(ownedIds, "G15") && ["DO", "GAE", "GEOL", "YUT", "MO"].includes(result.face)) {\n    const runtime = engine.augmentRuntime?.[userId];\n    if (runtime?.athleteAcceleratingGroupId === groupId) {\n      bonus += Math.min(3, runtime.athleteConsecutiveMoves ?? 0);\n    }\n  }\n''',
)

replace_once(
    "src/lib/augments/effects.ts",
    'export function isGroupMoveFixedToOne(engine: GameEngineState, userId: string, groupId: string) {\n',
    '''export function recordAthleteAccelerationMove(\n  engine: GameEngineState,\n  userId: string,\n  groupId: string,\n  result: RollToken,\n  ownedIds: string[],\n) {\n  if (!has(ownedIds, "G15")) return;\n  if (!["DO", "GAE", "GEOL", "YUT", "MO", "BACKDO"].includes(result.face)) return;\n  const runtime = runtimeForPlayer(engine, userId);\n  if (runtime.athleteAcceleratingGroupId === groupId) {\n    runtime.athleteConsecutiveMoves = (runtime.athleteConsecutiveMoves ?? 0) + 1;\n  } else {\n    runtime.athleteAcceleratingGroupId = groupId;\n    runtime.athleteConsecutiveMoves = 1;\n  }\n}\n\nexport function resetAthleteAccelerationForGroup(\n  engine: GameEngineState,\n  userId: string,\n  groupId: string,\n  ownedIds: string[],\n) {\n  if (!has(ownedIds, "G15")) return;\n  const runtime = engine.augmentRuntime?.[userId];\n  if (runtime?.athleteAcceleratingGroupId !== groupId) return;\n  delete runtime.athleteAcceleratingGroupId;\n  delete runtime.athleteConsecutiveMoves;\n}\n\nexport function isGroupMoveFixedToOne(engine: GameEngineState, userId: string, groupId: string) {\n''',
)

# Engine: consume capped G01 grants, record G15 moves, reset G15 on captures.
replace_once(
    "src/lib/game/engine.ts",
    '  grantsFaceExtraRoll,\n',
    '  consumeFaceExtraRollGrant,\n  recordAthleteAccelerationMove,\n  resetAthleteAccelerationForGroup,\n',
)
replace_once(
    "src/lib/game/engine.ts",
    '  if (grantsFaceExtraRoll(face, ownedIds)) engine.pendingRolls.push("YUT_MO");\n',
    '  if (consumeFaceExtraRollGrant(engine, player.userId, face, ownedIds)) engine.pendingRolls.push("YUT_MO");\n',
)
replace_once(
    "src/lib/game/engine.ts",
    '    clearPathControlForGroup(engine, victim.ownerUserId, victim.groupId);\n\n    returnPiecesAfterEnemyCapture(capturedGroup, victimOwned);\n',
    '    clearPathControlForGroup(engine, victim.ownerUserId, victim.groupId);\n    resetAthleteAccelerationForGroup(engine, victim.ownerUserId, victim.groupId, victimOwned);\n\n    returnPiecesAfterEnemyCapture(capturedGroup, victimOwned);\n',
)
replace_once(
    "src/lib/game/engine.ts",
    '  clearPathControlForGroup(engine, userId, groupId);\n  const group = player.pieces.filter((piece) => piece.groupId === groupId && piece.status === "ON_BOARD");\n  returnPiecesAfterEnemyCapture(group, ownedIds);\n',
    '  clearPathControlForGroup(engine, userId, groupId);\n  resetAthleteAccelerationForGroup(engine, userId, groupId, ownedIds);\n  const group = player.pieces.filter((piece) => piece.groupId === groupId && piece.status === "ON_BOARD");\n  returnPiecesAfterEnemyCapture(group, ownedIds);\n',
)
replace_once(
    "src/lib/game/engine.ts",
    '  engine.results.splice(resultIndex, 1);\n',
    '  engine.results.splice(resultIndex, 1);\n  recordAthleteAccelerationMove(engine, mover.userId, args.groupId, result, ownedIds);\n',
)

# Roll-flow rerolls must also consume the G01 per-turn grant quota.
replace_once(
    "src/lib/game/roll-flow.ts",
    'import { finalStepsForRoll, grantsFaceExtraRoll, type PlayerAugmentSetups } from "@/lib/augments/effects";\n',
    'import { consumeFaceExtraRollGrant, finalStepsForRoll, type PlayerAugmentSetups } from "@/lib/augments/effects";\n',
)
replace_once(
    "src/lib/game/roll-flow.ts",
    '  if (grantsFaceExtraRoll(rerolledFace, ownedIds)) engine.pendingRolls.push("YUT_MO");\n',
    '  if (consumeFaceExtraRollGrant(engine, player.userId, rerolledFace, ownedIds)) engine.pendingRolls.push("YUT_MO");\n',
)

# Remove the old G15 behavior from the simulation compatibility layer.
Path("src/lib/game/athlete.ts").write_text('''import type { GameEngineState } from "./types";\n\nexport function markAthleteMovement(_engine: GameEngineState, _userId: string, _ownedIds: string[]) {}\n\nexport function markAthleteDisqualified(_engine: GameEngineState, _userId: string, _ownedIds: string[]) {}\n\nexport function moveOwnedIdsForAthlete(ownedIds: string[]) {\n  return ownedIds;\n}\n\nexport function prepareAthleteCoexistence(\n  _engine: GameEngineState,\n  _actorUserId: string,\n  _actorOwnedIds: string[],\n  ownedByUser: Record<string, string[]>,\n) {\n  return {\n    ownedByUser,\n    restore: (_nextEngine: GameEngineState) => undefined,\n  };\n}\n\nexport function maybeGrantAthleteExtraRoll(\n  _before: GameEngineState,\n  after: GameEngineState,\n  _actorUserId: string,\n  _actorOwnedIds: string[],\n) {\n  return after;\n}\n''', encoding="utf-8")

# Bot's dual-roll scoring should respect the G01 cap instead of assuming every GAE still grants a roll.
replace_once(
    "src/lib/simulation/game.ts",
    '  adjustedResultForGroup,\n  grantsFaceExtraRoll,\n',
    '  adjustedResultForGroup,\n  canGrantFaceExtraRoll,\n',
)
replace_once(
    "src/lib/simulation/game.ts",
    '      baseStepsForFace(face) + (grantsFaceExtraRoll(face, owned) ? 3 : 0)\n',
    '      baseStepsForFace(face) + (canGrantFaceExtraRoll(engine, userId, face, owned) ? 3 : 0)\n',
)

# Telemetry: G15 now triggers when its acceleration bonus is active; it no longer suppresses capture-attempt telemetry.
replace_once(
    "src/lib/simulation/triggers.ts",
    '''  if (\n    ownedIds.includes("G15")\n    && !runtime(input.before, input.actorUserId)?.athleteRewarded\n    && runtime(input.after, input.actorUserId)?.athleteRewarded\n  ) {\n    addMapEvent(events, input.actorUserId, "G15");\n  }\n''',
    '''  if (\n    ownedIds.includes("G15")\n    && positive\n    && !suppressBonuses\n    && runtime(input.before, input.actorUserId)?.athleteAcceleratingGroupId === move.groupId\n    && (runtime(input.before, input.actorUserId)?.athleteConsecutiveMoves ?? 0) > 0\n  ) {\n    addMapEvent(events, input.actorUserId, "G15");\n  }\n''',
)
replace_once(
    "src/lib/simulation/triggers.ts",
    '  if (!ownedIds.includes("G15")) {\n    const attemptNodes = new Set(captureAttemptNodes(input, move));\n',
    '  {\n    const attemptNodes = new Set(captureAttemptNodes(input, move));\n',
)
replace_once(
    "src/lib/simulation/triggers.ts",
    '        && (runtime(input.before, group.userId)?.timesCaptured ?? 0) >= 4\n',
    '        && (runtime(input.before, group.userId)?.timesCaptured ?? 0) >= 5\n',
)

# P08 secondary captures can also reset G15 acceleration.
replace_once(
    "src/lib/game/capture-choice.ts",
    '  recordEnemyCaptures,\n',
    '  recordEnemyCaptures,\n  resetAthleteAccelerationForGroup,\n',
)
replace_once(
    "src/lib/game/capture-choice.ts",
    '  clearPathControlForGroup(engine, attackerUserId, attackerGroupId);\n  const group = player.pieces.filter((piece) => piece.groupId === attackerGroupId && piece.status === "ON_BOARD");\n',
    '  clearPathControlForGroup(engine, attackerUserId, attackerGroupId);\n  resetAthleteAccelerationForGroup(engine, attackerUserId, attackerGroupId, attackerOwned);\n  const group = player.pieces.filter((piece) => piece.groupId === attackerGroupId && piece.status === "ON_BOARD");\n',
)
replace_once(
    "src/lib/game/capture-choice.ts",
    '  clearPathControlForGroup(engine, target.victimUserId, target.victimGroupId);\n  returnPiecesAfterEnemyCapture(pieces, victimOwned);\n',
    '  clearPathControlForGroup(engine, target.victimUserId, target.victimGroupId);\n  resetAthleteAccelerationForGroup(engine, target.victimUserId, target.victimGroupId, victimOwned);\n  returnPiecesAfterEnemyCapture(pieces, victimOwned);\n',
)

print("Applied balance v5: G15 consecutive acceleration (Gold) and G01 max two GAE extra rolls per turn.")
