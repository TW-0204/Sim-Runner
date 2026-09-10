from pathlib import Path

path = Path("src/lib/simulation/game.ts")
text = path.read_text(encoding="utf-8")
old = '''    const next = bestMove(context, before, userId);\n    if (!next) throw new Error(`No legal move candidate for ${userId} at turn ${context.engine.turnNumber}.`);\n    commitTransition(context, before, next, userId, "move");\n    return;\n'''
new = '''    const next = bestMove(context, before, userId);\n    if (!next) {\n      const plaguePieceIds = context.engine.augmentRuntime?.[userId]?.plaguePieceIds ?? {};\n      const hasBlockedInfectedWaitingPiece = actor.pieces.some((piece) => (\n        piece.status === "WAITING" && Boolean(plaguePieceIds[piece.id])\n      ));\n      if (hasBlockedInfectedWaitingPiece) {\n        const skipped = structuredClone(before);\n        skipped.results = [];\n        if (skipped.pendingRolls.length > 0) {\n          skipped.stage = "AWAITING_ROLL";\n        } else {\n          advanceTurnForVacancy(skipped);\n        }\n        skipped.lastAction = `${actor.displayName}: 역병으로 출발할 수 없어 이동 결과 소멸`;\n        commitTransition(context, before, skipped, userId, "move");\n        return;\n      }\n      throw new Error(`No legal move candidate for ${userId} at turn ${context.engine.turnNumber}.`);\n    }\n    commitTransition(context, before, next, userId, "move");\n    return;\n'''
if text.count(old) != 1:
    raise SystemExit(f"Expected one no-move simulation block, got {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("Applied v3 stall fix: unusable plague departure results are consumed instead of stalling the simulator.")
