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
# P14 + A08: if Great Upheaval places the designated runner in FINISHED,
# resolve that state through the normal solo-lap lifecycle instead of leaving
# the only usable P14 piece permanently finished.
# ---------------------------------------------------------------------------
replace_once(
    "src/lib/game/engine.ts",
    '''export function applyGreatUpheaval(\n  engineInput: GameEngineState,\n  sourceUserId: string,\n  ownedByUser: Record<string, string[]>,\n  random: () => number = Math.random,\n): GameEngineState {\n''',
    '''export function applyGreatUpheaval(\n  engineInput: GameEngineState,\n  sourceUserId: string,\n  ownedByUser: Record<string, string[]>,\n  setupsByUser: Record<string, PlayerAugmentSetups> = {},\n  random: () => number = Math.random,\n): GameEngineState {\n''',
)

replace_once(
    "src/lib/game/engine.ts",
    '''  // The reshuffle can itself complete a normal win. If more than one player completes\n  // simultaneously, the A08 owner takes priority, then normal seat order.\n''',
    '''  // P14 replaces normal completion with laps. A08 can place the designated runner\n  // directly into FINISHED, so normalize that through the same lap resolver used by moves.\n  for (const player of engine.players) {\n    const owned = ownedByUser[player.userId] ?? [];\n    if (!owned.includes("P14")) continue;\n    const setups = setupsByUser[player.userId] ?? {};\n    const representativeId = setups.P14?.pieceId;\n    const representative = player.pieces.find((piece) => piece.id === representativeId);\n    if (!representative || representative.status !== "FINISHED") continue;\n    const lap = resolveSoloLap(engine, [representative], owned, setups);\n    if (lap === "WIN") return engine;\n  }\n\n  // The reshuffle can itself complete a normal win. If more than one player completes\n  // simultaneously, the A08 owner takes priority, then normal seat order.\n''',
)

replace_once(
    "src/lib/simulation/game.ts",
    '''        const afterUpheaval = applyGreatUpheaval(\n          beforeUpheaval,\n          offer.userId,\n          context.ownedByUser,\n          context.rng.effect.next,\n        );\n''',
    '''        const afterUpheaval = applyGreatUpheaval(\n          beforeUpheaval,\n          offer.userId,\n          context.ownedByUser,\n          context.setupsByUser,\n          context.rng.effect.next,\n        );\n''',
)


# ---------------------------------------------------------------------------
# A15: when every remaining board group is temporarily turtle-locked and there
# is no WAITING piece, movement results are unusable for that turn. Consume the
# results instead of treating the legal temporary lock state as a simulator stall.
# ---------------------------------------------------------------------------
replace_once(
    "src/lib/simulation/game.ts",
    '''      if (hasBlockedInfectedWaitingPiece) {\n        const skipped = structuredClone(before);\n        skipped.results = [];\n        if (skipped.pendingRolls.length > 0) {\n          skipped.stage = "AWAITING_ROLL";\n        } else {\n          advanceTurnForVacancy(skipped);\n        }\n        skipped.lastAction = `${actor.displayName}: 역병으로 출발할 수 없어 이동 결과 소멸`;\n        commitTransition(context, before, skipped, userId, "move");\n        return;\n      }\n      throw new Error(`No legal move candidate for ${userId} at turn ${context.engine.turnNumber}.`);\n''',
    '''      if (hasBlockedInfectedWaitingPiece) {\n        const skipped = structuredClone(before);\n        skipped.results = [];\n        if (skipped.pendingRolls.length > 0) {\n          skipped.stage = "AWAITING_ROLL";\n        } else {\n          advanceTurnForVacancy(skipped);\n        }\n        skipped.lastAction = `${actor.displayName}: 역병으로 출발할 수 없어 이동 결과 소멸`;\n        commitTransition(context, before, skipped, userId, "move");\n        return;\n      }\n      const turtleLocks = context.engine.augmentRuntime?.[userId]?.turtleLockedUntilRoundByPiece ?? {};\n      const boardGroupIds = [...new Set(actor.pieces\n        .filter((piece) => piece.status === "ON_BOARD")\n        .map((piece) => piece.groupId))];\n      const hasWaitingPiece = actor.pieces.some((piece) => piece.status === "WAITING");\n      const allBoardGroupsTurtleLocked = boardGroupIds.length > 0 && boardGroupIds.every((groupId) => (\n        actor.pieces.some((piece) => (\n          piece.groupId === groupId\n          && piece.status === "ON_BOARD"\n          && (turtleLocks[piece.id] ?? 0) > context.engine.round\n        ))\n      ));\n      if (!hasWaitingPiece && allBoardGroupsTurtleLocked) {\n        const skipped = structuredClone(before);\n        skipped.results = [];\n        if (skipped.pendingRolls.length > 0) {\n          skipped.stage = "AWAITING_ROLL";\n        } else {\n          advanceTurnForVacancy(skipped);\n        }\n        skipped.lastAction = `${actor.displayName}: 토끼와 거북이 이동 제한으로 이동 결과 소멸`;\n        commitTransition(context, before, skipped, userId, "move");\n        return;\n      }\n      throw new Error(`No legal move candidate for ${userId} at turn ${context.engine.turnNumber}.`);\n''',
)


# ---------------------------------------------------------------------------
# A16: with one completed piece, node 15 is still valid but its default route
# points toward the removed final side. If that route is eliminated, continue
# through 16 -> 17 -> 22, the surviving branch toward the shortened finish.
# ---------------------------------------------------------------------------
replace_once(
    "src/lib/game/engine.ts",
    '''  let movements = shrinkMovements(Boolean(result.forbidShortcuts));\n  if (shrink && movements.length === 0 && !result.forbidShortcuts) {\n    movements = shrinkMovements(true);\n  }\n  const echoMovements = movements.filter((movement) => (\n''',
    '''  let movements = shrinkMovements(Boolean(result.forbidShortcuts));\n  if (shrink && movements.length === 0 && !result.forbidShortcuts) {\n    movements = shrinkMovements(true);\n  }\n  if (shrink && movements.length === 0 && start === 15 && shrink.finishNode === 22) {\n    movements = forwardMoveOptions(14, result.finalSteps + 1, {\n      forbidShortcutEntry: true,\n      allowPassingShortcutEntry: false,\n      allowUniversalCenterChoice: false,\n    })\n      .map((movement) => ({\n        ...movement,\n        traversed: movement.traversed[0] === 15 ? movement.traversed.slice(1) : movement.traversed,\n      }))\n      .map((movement) => applyMarginShrinkToForwardMove(movement, shrink))\n      .filter((movement): movement is NonNullable<typeof movement> => movement != null);\n  }\n  const echoMovements = movements.filter((movement) => (\n''',
)


# ---------------------------------------------------------------------------
# A13 + stored G13 BACKDO: a WAITING piece cannot consume BACKDO. Do not send
# the only ON_BOARD group into the wormhole when the already-stored result would
# then have no compatible remaining piece.
# ---------------------------------------------------------------------------
replace_once(
    "src/lib/game/engine.ts",
    '''    const hasOtherMovablePiece = player.pieces.some((piece) => (\n      piece.groupId !== groupId && (piece.status === "WAITING" || piece.status === "ON_BOARD")\n    ));\n    const hasMarginReturn = ownedIds.includes("A16")\n      && player.pieces.some((piece) => piece.status === "MARGIN")\n      && engine.results.some((result) => !result.numericPool && ["DO", "GAE", "GEOL", "YUT", "MO"].includes(result.face));\n    if (!hasOtherMovablePiece && !hasMarginReturn) {\n''',
    '''    const hasOtherOnBoardPiece = player.pieces.some((piece) => (\n      piece.groupId !== groupId && piece.status === "ON_BOARD"\n    ));\n    const hasWaitingPiece = player.pieces.some((piece) => piece.status === "WAITING");\n    const hasForwardResult = engine.results.some((result) => (\n      !result.numericPool && ["DO", "GAE", "GEOL", "YUT", "MO"].includes(result.face)\n    ));\n    const hasOtherResultCompatiblePiece = hasOtherOnBoardPiece || (hasWaitingPiece && hasForwardResult);\n    const hasMarginReturn = ownedIds.includes("A16")\n      && player.pieces.some((piece) => piece.status === "MARGIN")\n      && engine.results.some((result) => !result.numericPool && ["DO", "GAE", "GEOL", "YUT", "MO"].includes(result.face));\n    if (!hasOtherResultCompatiblePiece && !hasMarginReturn) {\n''',
)

replace_once(
    "src/lib/simulation/game.ts",
    '''  if (engine.results.length > 0 && groups.size === 1) {\n    const onlyGroupId = groups.keys().next().value as string | undefined;\n    const hasWaitingPiece = actor.pieces.some((piece) => piece.status === "WAITING");\n    const hasMarginReturn = owned.includes("A16")\n      && actor.pieces.some((piece) => piece.status === "MARGIN")\n      && engine.results.some((result) => !result.numericPool && ["DO", "GAE", "GEOL", "YUT", "MO"].includes(result.face));\n    if (onlyGroupId && !hasWaitingPiece && !hasMarginReturn) {\n      context.engine = expireWormholeForCurrentRound(engine, actor.userId, owned);\n      return false;\n    }\n  }\n''',
    '''  if (engine.results.length > 0 && groups.size === 1) {\n    const onlyGroupId = groups.keys().next().value as string | undefined;\n    const hasCompatibleWaitingPiece = actor.pieces.some((piece) => (\n      piece.status === "WAITING"\n      && isGroupUsableWithAugments(engine, actor.userId, piece.groupId, owned, actorSetups(context, actor.userId))\n    )) && engine.results.some((result) => (\n      !result.numericPool && ["DO", "GAE", "GEOL", "YUT", "MO"].includes(result.face)\n    ));\n    const hasMarginReturn = owned.includes("A16")\n      && actor.pieces.some((piece) => piece.status === "MARGIN")\n      && engine.results.some((result) => !result.numericPool && ["DO", "GAE", "GEOL", "YUT", "MO"].includes(result.face));\n    if (onlyGroupId && !hasCompatibleWaitingPiece && !hasMarginReturn) {\n      context.engine = expireWormholeForCurrentRound(engine, actor.userId, owned);\n      return false;\n    }\n  }\n''',
)

print("Applied stall fixes v7: A08/P14, A15 lock, A16 center route, and A13/G13 result compatibility.")
