from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


path = Path("src/lib/simulation/game.ts")
text = path.read_text(encoding="utf-8")

text = text.replace("  armA04OnAcquisition,\n", "")
text = replace_once(
    text,
    '''import {\n  applyBetrayalAcquisitionLifecycle,\n  initializeAcquiredPieceSetup,\n} from "@/lib/game/augment-lifecycle";''',
    '''import { applyAugmentAcquisitionLifecycle } from "@/lib/game/augment-lifecycle";''',
    "augment lifecycle import",
)
for name in [
    "  applyGreatUpheaval,\n",
    "  applyMoonwalkAcquisitionScatter,\n",
    "  applyTurtleAndHarePlacement,\n",
    "  armGachaMachineOnAcquisition,\n",
    "  armWormholeOnAcquisition,\n",
]:
    text = text.replace(name, "")

old = '''      context.ownedByUser[offer.userId] = upgradeOwnedList(context.ownedByUser[offer.userId] ?? [], acquiredId);\n      if (acquiredId === "P02") context.engine = applyMoonwalkAcquisitionScatter(context.engine, offer.userId, context.rng.effect.next);\n      context.engine.augmentRuntime ??= {};\n      context.engine.augmentRuntime[offer.userId] ??= {};\n      const ideaRuntime = context.engine.augmentRuntime[offer.userId];\n      if (a04UpgradePendingByUser[offer.userId]) delete ideaRuntime.a04UpgradeNextAugment;\n      if (acquiredId === "A04") armA04OnAcquisition(context.engine, offer.userId);\n      if (acquiredId === "A12") ideaRuntime.walkingTrailSegment = context.rng.effect.int(4);\n      if (acquiredId === "A01") {\n        ideaRuntime.gravityExplosionRound = context.engine.round;\n        ideaRuntime.gravityExplosionResolved = false;\n      }\n      if (acquiredId === "A02") armGachaMachineOnAcquisition(context.engine, offer.userId);\n      if (acquiredId === "A08") {\n        const beforeUpheaval = context.engine;\n        const afterUpheaval = applyGreatUpheaval(\n          beforeUpheaval,\n          offer.userId,\n          context.ownedByUser,\n          context.setupsByUser,\n          context.rng.effect.next,\n        );\n        commitTransition(context, beforeUpheaval, afterUpheaval, offer.userId, "augment_event");\n      }\n      if (acquiredId === "A13") armWormholeOnAcquisition(context.engine, offer.userId);\n      if (acquiredId === "A15") {\n        const owner = context.engine.players.find((candidate) => candidate.userId === offer.userId);\n        const waiting = owner?.pieces.filter((piece) => piece.status === "WAITING") ?? [];\n        if (waiting.length) {\n          const target = waiting[context.rng.effect.int(waiting.length)] ?? waiting[0];\n          context.engine = applyTurtleAndHarePlacement(context.engine, offer.userId, target.id);\n        }\n      }\n      if (acquiredId === "A10") {\n        const betrayal = applyBetrayalAcquisitionLifecycle(\n          context.engine,\n          offer.userId,\n          context.ownedByUser,\n          context.setupsByUser,\n          context.rng.effect.next,\n        );\n        context.engine = betrayal.engine;\n      }\n      if (acquiredId === "G16" || acquiredId === "P14") {\n        initializeAcquiredPieceSetup(\n          context.engine,\n          offer.userId,\n          acquiredId,\n          context.setupsByUser,\n        );\n      }'''
new = '''      context.ownedByUser[offer.userId] = upgradeOwnedList(context.ownedByUser[offer.userId] ?? [], acquiredId);\n      const acquisitionLifecycle = applyAugmentAcquisitionLifecycle({\n        engine: context.engine,\n        userId: offer.userId,\n        augmentId: acquiredId,\n        ownedByUser: context.ownedByUser,\n        setupsByUser: context.setupsByUser,\n        consumeA04UpgradePending: Boolean(a04UpgradePendingByUser[offer.userId]),\n        randomNext: () => context.rng.effect.next(),\n        randomInt: (maxExclusive) => context.rng.effect.int(maxExclusive),\n      });\n      if (acquisitionLifecycle.immediateTransitionFrom) {\n        commitTransition(\n          context,\n          acquisitionLifecycle.immediateTransitionFrom,\n          acquisitionLifecycle.engine,\n          offer.userId,\n          "augment_event",\n        );\n      } else {\n        context.engine = acquisitionLifecycle.engine;\n      }'''
text = replace_once(text, old, new, "acquisition side effects")

for forbidden in [
    'if (acquiredId === "P02")',
    'if (acquiredId === "A04")',
    'if (acquiredId === "A08")',
    'if (acquiredId === "A10")',
    'if (acquiredId === "A13")',
    'if (acquiredId === "A15")',
    'if (acquiredId === "G16" || acquiredId === "P14")',
    "ideaRuntime",
    "applyBetrayalAcquisitionLifecycle",
    "initializeAcquiredPieceSetup",
]:
    if forbidden in text:
        raise SystemExit(f"simulation acquisition-rule remnant remains: {forbidden}")

path.write_text(text, encoding="utf-8")
print("Simulation now delegates acquired augment state transitions to game/augment-lifecycle.ts.")
