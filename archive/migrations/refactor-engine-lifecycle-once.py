from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


path = Path("src/lib/simulation/game.ts")
text = path.read_text(encoding="utf-8")

text = text.replace("  applyBetrayalTransfer,\n", "")
text = text.replace("  replacesNormalWinCondition,\n", "")

anchor = 'import { applyLoneWolfAllyCapture } from "@/lib/game/ally-capture";\n'
insert = (
    'import { applyLoneWolfAllyCapture } from "@/lib/game/ally-capture";\n'
    'import {\n'
    '  applyBetrayalAcquisitionLifecycle,\n'
    '  initializeAcquiredPieceSetup,\n'
    '} from "@/lib/game/augment-lifecycle";\n'
    'import { assertGameStateInvariants } from "@/lib/game/invariants";\n'
)
text = replace_once(text, anchor, insert, "game lifecycle imports")

start = text.index("function rankedSetupPiece")
end = text.index("function playerHasWaitingPiece", start)
text = text[:start] + text[end:]

start = text.index("function repairTransferredSetup")
end = text.index("function upgradedAugmentTier", start)
text = text[:start] + text[end:]

old_betrayal = '''      if (acquiredId === "A10") {\n        const betrayal = applyBetrayalTransfer(context.engine, offer.userId, context.rng.effect.next);\n        context.engine = betrayal.engine;\n        repairTransferredSetup(context, offer.userId, betrayal.transferredPieceId);\n        maybeDeclareBetrayalSourceWinner(context, offer.userId);\n      }\n      if (acquiredId === "G16" || acquiredId === "P14") {\n        const pieceId = setupPieceId(player, acquiredId);\n        if (pieceId) {\n          context.setupsByUser[offer.userId] ??= {};\n          context.setupsByUser[offer.userId][acquiredId] = { pieceId };\n        }\n      }'''
new_betrayal = '''      if (acquiredId === "A10") {\n        const betrayal = applyBetrayalAcquisitionLifecycle(\n          context.engine,\n          offer.userId,\n          context.ownedByUser,\n          context.setupsByUser,\n          context.rng.effect.next,\n        );\n        context.engine = betrayal.engine;\n      }\n      if (acquiredId === "G16" || acquiredId === "P14") {\n        initializeAcquiredPieceSetup(\n          context.engine,\n          offer.userId,\n          acquiredId,\n          context.setupsByUser,\n        );\n      }'''
text = replace_once(text, old_betrayal, new_betrayal, "A10/P14/G16 acquisition lifecycle")

old_commit = '''  context.engine = applyPassiveSpecialWinner(after, context.ownedByUser);\n}'''
new_commit = '''  context.engine = applyPassiveSpecialWinner(after, context.ownedByUser);\n  assertGameStateInvariants(context.engine, {\n    ownedByUser: context.ownedByUser,\n    setupsByUser: context.setupsByUser,\n    label: `${actionKind}@${context.actions}`,\n  });\n}'''
text = replace_once(text, old_commit, new_commit, "commitTransition invariant")

acquisition_tail = '''      if (acquiredId !== selectedId) {\n        context.acquisitions.push({\n          userId: offer.userId,\n          seat: player.seat,\n          augmentId: acquiredId,\n          acquisitionIndex: eventIndex + 1,\n          logicalPhase: event.logicalPhase,\n          afterRound: event.afterRound,\n          tier: AUGMENT_BY_ID.get(acquiredId)?.tier ?? tier,\n        });\n      }\n    }'''
acquisition_tail_new = '''      if (acquiredId !== selectedId) {\n        context.acquisitions.push({\n          userId: offer.userId,\n          seat: player.seat,\n          augmentId: acquiredId,\n          acquisitionIndex: eventIndex + 1,\n          logicalPhase: event.logicalPhase,\n          afterRound: event.afterRound,\n          tier: AUGMENT_BY_ID.get(acquiredId)?.tier ?? tier,\n        });\n      }\n      assertGameStateInvariants(context.engine, {\n        ownedByUser: context.ownedByUser,\n        setupsByUser: context.setupsByUser,\n        label: `acquire:${acquiredId}:${offer.userId}`,\n      });\n    }'''
text = replace_once(text, acquisition_tail, acquisition_tail_new, "acquisition invariant")

for forbidden in [
    "function rankedSetupPiece",
    "function setupPieceId",
    "function repairTransferredSetup",
    "function maybeDeclareBetrayalSourceWinner",
    "applyBetrayalTransfer(context.engine",
]:
    if forbidden in text:
        raise SystemExit(f"simulation lifecycle remnant remains: {forbidden}")

path.write_text(text, encoding="utf-8")
print("Moved ownership/setup lifecycle to src/lib/game and added transition invariants.")
