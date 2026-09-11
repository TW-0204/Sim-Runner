from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one occurrence in {path}, got {count}: {old[:200]!r}")
    write(path, text.replace(old, new, 1))


# A05 immediate Gold replacement must obey A10's dynamic eligibility too.
# Otherwise Asura can replace into Betrayal after the owner has no WAITING piece.
replace_once(
    "src/lib/simulation/game.ts",
    '''    .filter((augment) => augment.id !== "A05" && augment.id !== "A06")\n    .filter((augment) => canOffer(augment, phase, ownedIds))\n''',
    '''    .filter((augment) => augment.id !== "A05" && augment.id !== "A06")\n    .filter((augment) => augment.id !== "A10" || playerHasWaitingPiece(context, userId))\n    .filter((augment) => canOffer(augment, phase, ownedIds))\n''',
)

# Betrayal can transfer the source player's final unfinished piece. In that case the
# source immediately satisfies the normal current-piece win condition and must not
# be left in MOVING with no legal piece.
replace_once(
    "src/lib/simulation/game.ts",
    '''  isGroupUsableWithAugments,\n  type PlayerAugmentSetups,\n''',
    '''  isGroupUsableWithAugments,\n  replacesNormalWinCondition,\n  type PlayerAugmentSetups,\n''',
)

replace_once(
    "src/lib/simulation/game.ts",
    '''function upgradedAugmentTier(tier: AugmentTier): AugmentTier {\n''',
    '''function maybeDeclareBetrayalSourceWinner(context: SimulationContext, userId: string) {\n  const ownedIds = context.ownedByUser[userId] ?? [];\n  if (ownedIds.includes("P02") || replacesNormalWinCondition(ownedIds)) return;\n  const player = context.engine.players.find((candidate) => candidate.userId === userId);\n  if (!player || !player.pieces.every((piece) => piece.status === "FINISHED")) return;\n\n  context.engine.winnerUserId = userId;\n  context.engine.winnerCondition = "NORMAL";\n  context.engine.stage = "FINISHED";\n  context.engine.pendingRolls = [];\n  context.engine.results = [];\n  context.engine.pendingRollChoice = null;\n  context.engine.pendingSplitChoice = null;\n  context.engine.pendingCaptureChoice = null;\n  context.engine.pendingRelocationChoice = null;\n  context.engine.pendingStackChoice = null;\n  context.engine.lastAction = `${player.displayName}: 배반 후 남은 현재 말이 모두 완주되어 승리!`;\n}\n\nfunction upgradedAugmentTier(tier: AugmentTier): AugmentTier {\n''',
)

replace_once(
    "src/lib/simulation/game.ts",
    '''      if (acquiredId === "A10") {\n        const betrayal = applyBetrayalTransfer(context.engine, offer.userId, context.rng.effect.next);\n        context.engine = betrayal.engine;\n        repairTransferredSetup(context, offer.userId, betrayal.transferredPieceId);\n      }\n''',
    '''      if (acquiredId === "A10") {\n        const betrayal = applyBetrayalTransfer(context.engine, offer.userId, context.rng.effect.next);\n        context.engine = betrayal.engine;\n        repairTransferredSetup(context, offer.userId, betrayal.transferredPieceId);\n        maybeDeclareBetrayalSourceWinner(context, offer.userId);\n      }\n''',
)

print("Applied stall fixes v5: A10 replacement eligibility and immediate source win resolution.")
