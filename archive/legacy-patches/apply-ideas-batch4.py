from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:220]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_all(path: str, old: str, new: str, expected: int):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"Unexpected replacement count in {path}: got {count}, expected {expected}")
    p.write_text(text.replace(old, new), encoding="utf-8")


# Batch 4 intentionally contains only A13 웜홀.
replace_once(
    "src/lib/augments/catalog.ts",
    '''  { id: "A12", name: "산책로", tier: "silver", description: "외곽의 네 구간 중 하나가 무작위 산책로가 됩니다. 자신의 말이 산책로에서 이동을 시작하면 전진 이동량이 +1칸 증가합니다." },\n];''',
    '''  { id: "A12", name: "산책로", tier: "silver", description: "외곽의 네 구간 중 하나가 무작위 산책로가 됩니다. 자신의 말이 산책로에서 이동을 시작하면 전진 이동량이 +1칸 증가합니다." },\n  { id: "A13", name: "웜홀", tier: "prism", description: "획득 직후와 이후 2라운드마다, 자신의 기본 던지기 대신 판 위의 말 한 묶음을 웜홀에 보낼 수 있습니다. 1라운드 후 진행 방향 기준 3~18칸 앞의 무작위 유효 위치에 나타납니다." },\n];''',
)

# A13 needs an explicit off-board state so the travelling group cannot be rolled, moved, stacked, captured, or counted as waiting.
replace_once(
    "src/lib/game/types.ts",
    'export type PieceStatus = "WAITING" | "ON_BOARD" | "FINISHED";\n',
    'export type PieceStatus = "WAITING" | "ON_BOARD" | "WORMHOLE" | "FINISHED";\n',
)
replace_once(
    "src/lib/game/types.ts",
    '''  echoFollowerPieceId?: string;\n  echoCompleted?: boolean;\n''',
    '''  echoFollowerPieceId?: string;\n  echoCompleted?: boolean;\n  wormholeNextOpenRound?: number;\n  wormholeTransit?: Record<string, { returnRound: number; originNode: number; pieceIds: string[] }>;\n''',
)

# Generic group helpers must never treat a WORMHOLE group as movable.
replace_once(
    "src/lib/augments/effects.ts",
    '''  return player?.pieces.filter((piece) => piece.groupId === groupId && piece.status !== "FINISHED") ?? [];\n''',
    '''  return player?.pieces.filter((piece) => (\n    piece.groupId === groupId && (piece.status === "WAITING" || piece.status === "ON_BOARD")\n  )) ?? [];\n''',
)
replace_once(
    "src/lib/game/engine.ts",
    '''function groupPieces(engine: GameEngineState, groupId: string, includeFinished = false) {\n  return currentPlayer(engine).pieces.filter((piece) => (\n    piece.groupId === groupId && (includeFinished || piece.status !== "FINISHED")\n  ));\n}\n''',
    '''function groupPieces(engine: GameEngineState, groupId: string, includeFinished = false) {\n  return currentPlayer(engine).pieces.filter((piece) => (\n    piece.groupId === groupId\n    && (piece.status === "WAITING" || piece.status === "ON_BOARD" || (includeFinished && piece.status === "FINISHED"))\n  ));\n}\n''',
)
replace_once(
    "src/lib/game/engine.ts",
    '''  return player.pieces.filter((piece) => {\n    if (piece.status === "FINISHED" || seen.has(piece.groupId)) return false;\n''',
    '''  return player.pieces.filter((piece) => {\n    if (piece.status === "WORMHOLE" || piece.status === "FINISHED" || seen.has(piece.groupId)) return false;\n''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''  return player.pieces.filter((piece) => {\n    if (seen.has(piece.groupId)) return false;\n    if (piece.status === "FINISHED" && !allowFinished) return false;\n''',
    '''  return player.pieces.filter((piece) => {\n    if (seen.has(piece.groupId)) return false;\n    if (piece.status === "WORMHOLE") return false;\n    if (piece.status === "FINISHED" && !allowFinished) return false;\n''',
)

# Engine-level A13 lifecycle.
replace_once(
    "src/lib/game/engine.ts",
    '''export function currentPlayer(engine: GameEngineState): EnginePlayer {\n  const player = engine.players.find((candidate) => candidate.seat === engine.currentSeat);\n  if (!player) throw new Error("Current player is missing.");\n  return player;\n}\n''',
    '''export function currentPlayer(engine: GameEngineState): EnginePlayer {\n  const player = engine.players.find((candidate) => candidate.seat === engine.currentSeat);\n  if (!player) throw new Error("Current player is missing.");\n  return player;\n}\n\nfunction runtimeForWormhole(engine: GameEngineState, userId: string) {\n  engine.augmentRuntime ??= {};\n  const runtime = engine.augmentRuntime[userId] ?? {};\n  engine.augmentRuntime[userId] = runtime;\n  return runtime;\n}\n\nexport function armWormholeOnAcquisition(engine: GameEngineState, userId: string) {\n  const runtime = runtimeForWormhole(engine, userId);\n  runtime.wormholeNextOpenRound = engine.round;\n}\n\nexport function wormholeIsOpen(engine: GameEngineState, userId: string, ownedIds: string[]) {\n  if (!ownedIds.includes("A13")) return false;\n  const nextOpen = engine.augmentRuntime?.[userId]?.wormholeNextOpenRound;\n  return nextOpen != null && engine.round >= nextOpen;\n}\n\nexport function expireWormholeForCurrentRound(\n  engineInput: GameEngineState,\n  userId: string,\n  ownedIds: string[],\n) {\n  if (!wormholeIsOpen(engineInput, userId, ownedIds)) return engineInput;\n  const engine = clone(engineInput);\n  const runtime = runtimeForWormhole(engine, userId);\n  runtime.wormholeNextOpenRound = engine.round + 2;\n  return engine;\n}\n\ntype WormholeReturnCandidate = { node: number | null; finished: boolean; home: boolean };\n\nfunction wormholeReturnCandidates(originNode: number, moonwalk: boolean): WormholeReturnCandidate[] {\n  const candidates = new Map<string, WormholeReturnCandidate>();\n  for (let steps = 3; steps <= 18; steps += 1) {\n    if (moonwalk) {\n      for (const move of reverseMoveOptions(originNode, steps)) {\n        const candidate = { node: move.node, finished: false, home: move.home };\n        const key = move.home ? "HOME" : `N:${move.node}`;\n        if (!candidates.has(key)) candidates.set(key, candidate);\n      }\n    } else {\n      for (const move of forwardMoveOptions(originNode, steps)) {\n        const candidate = { node: move.node, finished: move.finished, home: false };\n        const key = move.finished ? "FINISH" : `N:${move.node}`;\n        if (!candidates.has(key)) candidates.set(key, candidate);\n      }\n    }\n  }\n  return [...candidates.values()];\n}\n\nexport function applyWormholeTurn(\n  engineInput: GameEngineState,\n  userId: string,\n  groupId: string,\n  ownedIds: string[],\n): GameEngineState {\n  if (engineInput.stage !== "AWAITING_ROLL" || engineInput.pendingRolls[0] !== "BASIC") {\n    throw new Error("웜홀은 기본 던지기 전에만 사용할 수 있습니다.");\n  }\n  const actor = currentPlayer(engineInput);\n  if (actor.userId !== userId) throw new Error("현재 플레이어의 웜홀만 사용할 수 있습니다.");\n  if (!wormholeIsOpen(engineInput, userId, ownedIds)) throw new Error("현재 라운드에는 웜홀이 열려 있지 않습니다.");\n\n  const engine = clone(engineInput);\n  const player = currentPlayer(engine);\n  const group = player.pieces.filter((piece) => piece.groupId === groupId && piece.status === "ON_BOARD" && piece.node != null);\n  if (!group.length) throw new Error("웜홀에 보낼 판 위의 말 묶음을 찾지 못했습니다.");\n  const originNode = group[0].node;\n  if (originNode == null || group.some((piece) => piece.node !== originNode)) throw new Error("웜홀 묶음 위치가 일치하지 않습니다.");\n\n  clearJunctionBoostForGroup(engine, userId, groupId);\n  clearPathControlForGroup(engine, userId, groupId);\n  resetAthleteAccelerationForGroup(engine, userId, groupId, ownedIds);\n\n  const runtime = runtimeForWormhole(engine, userId);\n  runtime.wormholeTransit ??= {};\n  runtime.wormholeTransit[groupId] = {\n    returnRound: engine.round + 1,\n    originNode,\n    pieceIds: group.map((piece) => piece.id),\n  };\n  runtime.wormholeNextOpenRound = engine.round + 2;\n\n  for (const piece of group) {\n    piece.status = "WORMHOLE";\n    piece.node = null;\n  }\n\n  // A13 replaces only the BASIC throw. Existing non-roll movement results, if any, remain usable.\n  engine.pendingRolls.shift();\n  engine.pendingRollChoice = null;\n  if (engine.pendingRolls.length > 0) {\n    engine.stage = "AWAITING_ROLL";\n  } else if (engine.results.length > 0) {\n    engine.stage = "MOVING";\n  } else {\n    advanceTurn(engine);\n  }\n  engine.lastAction = `${player.displayName}: 웜홀 · 말 ${group.length}개 묶음이 1라운드 동안 사라집니다.`;\n  return engine;\n}\n\nexport function resolveDueWormholeReturns(\n  engineInput: GameEngineState,\n  userId: string,\n  ownedIds: string[],\n  random: () => number = Math.random,\n): GameEngineState {\n  if (!ownedIds.includes("A13")) return engineInput;\n  const transit = engineInput.augmentRuntime?.[userId]?.wormholeTransit;\n  if (!transit) return engineInput;\n  const due = Object.entries(transit).filter(([, item]) => item.returnRound <= engineInput.round);\n  if (!due.length) return engineInput;\n\n  const engine = clone(engineInput);\n  const runtime = runtimeForWormhole(engine, userId);\n  const player = engine.players.find((candidate) => candidate.userId === userId);\n  if (!player) return engineInput;\n  const messages: string[] = [];\n\n  for (const [groupId, item] of due) {\n    const pieces = player.pieces.filter((piece) => item.pieceIds.includes(piece.id) && piece.status === "WORMHOLE");\n    if (!pieces.length) {\n      if (runtime.wormholeTransit) delete runtime.wormholeTransit[groupId];\n      continue;\n    }\n    const moonwalk = ownedIds.includes("P02");\n    const candidates = wormholeReturnCandidates(item.originNode, moonwalk);\n    if (!candidates.length) throw new Error("웜홀 복귀 위치를 찾지 못했습니다.");\n    const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));\n    const selected = candidates[index] ?? candidates[0];\n\n    if (selected.home) {\n      for (const piece of pieces) {\n        piece.status = "WAITING";\n        piece.node = null;\n        piece.groupId = piece.id;\n        piece.hasEntered = true;\n      }\n      messages.push(`${pieces.length}개 말이 출발점으로 복귀`);\n    } else if (selected.finished) {\n      for (const piece of pieces) {\n        piece.status = "FINISHED";\n        piece.node = null;\n        piece.hasEntered = true;\n      }\n      recordEchoFinish(engine, userId, groupId, true, ownedIds);\n      messages.push(`${pieces.length}개 말이 완주`);\n    } else {\n      if (selected.node == null) throw new Error("웜홀 복귀 칸이 비어 있습니다.");\n      for (const piece of pieces) {\n        piece.status = "ON_BOARD";\n        piece.node = selected.node;\n        piece.hasEntered = true;\n      }\n      messages.push(`${pieces.length}개 말이 ${selected.node}번에 등장`);\n    }\n    if (runtime.wormholeTransit) delete runtime.wormholeTransit[groupId];\n  }\n\n  if (checkSpecialWinner(engine, ownedIds) || checkBasicWinner(engine, ownedIds)) return engine;\n  engine.lastAction = `${player.displayName}: 웜홀 복귀 · ${messages.join(" / ")}`;\n  return engine;\n}\n''',
)

# Simulation imports and acquisition arming.
replace_once(
    "src/lib/simulation/game.ts",
    '''  applyGrandUnity,\n  applyMove,\n''',
    '''  applyGrandUnity,\n  applyMove,\n  applyWormholeTurn,\n  armWormholeOnAcquisition,\n''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''  currentPlayer,\n  legalMoveTargetsWithAugments,\n''',
    '''  currentPlayer,\n  expireWormholeForCurrentRound,\n  legalMoveTargetsWithAugments,\n  resolveDueWormholeReturns,\n  wormholeIsOpen,\n''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''      if (acquiredId === "A12") ideaRuntime.walkingTrailSegment = context.rng.effect.int(4);\n      if (acquiredId === "A10") {\n''',
    '''      if (acquiredId === "A12") ideaRuntime.walkingTrailSegment = context.rng.effect.int(4);\n      if (acquiredId === "A13") armWormholeOnAcquisition(context.engine, offer.userId);\n      if (acquiredId === "A10") {\n''',
)

# A skipped S13 turn still consumes an A13 opening in that round; the opening does not carry over.
replace_once(
    "src/lib/simulation/game.ts",
    '''  runtime.vacancySkipsRemaining = remaining - 1;\n  const remainingAfter = runtime.vacancySkipsRemaining;\n  advanceTurnForVacancy(next);\n''',
    '''  runtime.vacancySkipsRemaining = remaining - 1;\n  const remainingAfter = runtime.vacancySkipsRemaining;\n  const afterExpiry = expireWormholeForCurrentRound(next, player.userId, owned);\n  advanceTurnForVacancy(afterExpiry);\n''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''  const following = currentPlayer(next);\n  next.lastAction = remainingAfter > 0\n    ? `${player.displayName}: 자리비움 · 턴 스킵 (${remainingAfter}회 남음) · ${following.displayName}의 턴`\n    : `${player.displayName}: 자리비움 종료 · Round 9까지 기본 양수 이동 +1 · ${following.displayName}의 턴`;\n  context.engine = next;\n''',
    '''  const following = currentPlayer(afterExpiry);\n  afterExpiry.lastAction = remainingAfter > 0\n    ? `${player.displayName}: 자리비움 · 턴 스킵 (${remainingAfter}회 남음) · ${following.displayName}의 턴`\n    : `${player.displayName}: 자리비움 종료 · Round 9까지 기본 양수 이동 +1 · ${following.displayName}의 턴`;\n  context.engine = afterExpiry;\n''',
)

# The bot uses an available wormhole on its least-progressed on-board group. This is a test heuristic, not a player-facing rule.
replace_once(
    "src/lib/simulation/game.ts",
    '''function actorOwned(context: SimulationContext, userId: string) {\n''',
    '''function maybeUseWormhole(context: SimulationContext) {\n  const engine = context.engine;\n  if (engine.stage !== "AWAITING_ROLL" || engine.pendingRolls[0] !== "BASIC") return false;\n  const actor = currentPlayer(engine);\n  const owned = context.ownedByUser[actor.userId] ?? [];\n  if (!wormholeIsOpen(engine, actor.userId, owned)) return false;\n\n  const groups = new Map<string, PieceState[]>();\n  for (const piece of actor.pieces) {\n    if (piece.status !== "ON_BOARD" || piece.node == null) continue;\n    const list = groups.get(piece.groupId) ?? [];\n    list.push(piece);\n    groups.set(piece.groupId, list);\n  }\n\n  if (!groups.size) {\n    context.engine = expireWormholeForCurrentRound(engine, actor.userId, owned);\n    return false;\n  }\n\n  const selected = [...groups.entries()].sort((left, right) => {\n    const leftProgress = Math.max(...left[1].map((piece) => piece.pathHistory.length));\n    const rightProgress = Math.max(...right[1].map((piece) => piece.pathHistory.length));\n    if (leftProgress !== rightProgress) return leftProgress - rightProgress;\n    if (left[1].length !== right[1].length) return right[1].length - left[1].length;\n    return left[0].localeCompare(right[0]);\n  })[0];\n  if (!selected) return false;\n\n  const before = structuredClone(engine);\n  const next = applyWormholeTurn(engine, actor.userId, selected[0], owned);\n  commitTransition(context, before, next, actor.userId, "wormhole");\n  return true;\n}\n\nfunction actorOwned(context: SimulationContext, userId: string) {\n''',
)

# Resolve due returns at the start of the owner's turn. They do not count as captures or movement actions.
replace_once(
    "src/lib/simulation/game.ts",
    '''function stepGame(context: SimulationContext) {\n  if (applyDueAugmentEvents(context)) return;\n  if (context.engine.winnerUserId) return;\n  if (maybeApplyVacancySkip(context)) return;\n\n  const actorBeforeInjection = currentPlayer(context.engine);\n''',
    '''function stepGame(context: SimulationContext) {\n  if (applyDueAugmentEvents(context)) return;\n  if (context.engine.winnerUserId) return;\n\n  const returnActor = currentPlayer(context.engine);\n  context.engine = resolveDueWormholeReturns(\n    context.engine,\n    returnActor.userId,\n    actorOwned(context, returnActor.userId),\n    context.rng.effect.next,\n  );\n  if (context.engine.winnerUserId) return;\n  if (maybeApplyVacancySkip(context)) return;\n\n  const actorBeforeInjection = currentPlayer(context.engine);\n''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''  if (context.engine.stage === "AWAITING_ROLL") {\n    queueA04BonusForNextBasic(context.engine, userId, actorOwned(context, userId));\n    const before = context.engine;\n''',
    '''  if (context.engine.stage === "AWAITING_ROLL") {\n    if (maybeUseWormhole(context)) return;\n    queueA04BonusForNextBasic(context.engine, userId, actorOwned(context, userId));\n    const before = context.engine;\n''',
)

# Telemetry action type for clean transition classification.
replace_once(
    "src/lib/simulation/triggers.ts",
    '''  | "move"\n  | "stack"\n''',
    '''  | "move"\n  | "wormhole"\n  | "stack"\n''',
)

print("Applied ideas batch 4: A13 Wormhole lifecycle, delayed return, and turn replacement.")
