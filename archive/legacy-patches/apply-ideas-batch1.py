from pathlib import Path


def replace_exact(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# Batch 1 intentionally contains only the two immediate augment-replacement ideas.
# A05/A06 are recorded as acquired for balance telemetry but never remain in ownedIds.
replace_exact(
    "src/lib/augments/catalog.ts",
    '  { id: "P19", name: "신의 손", tier: "prism", timing: "not-last", conflicts: fixedRollConflicts.filter((id) => id !== "P19"), description: "획득 즉시 1회 충전되며 이후 기본 던지기 3회마다 다음 기본 결과를 원하는 도·개·걸·윷·모로 바꿀 수 있습니다." },\n];',
    '  { id: "P19", name: "신의 손", tier: "prism", timing: "not-last", conflicts: fixedRollConflicts.filter((id) => id !== "P19"), description: "획득 즉시 1회 충전되며 이후 기본 던지기 3회마다 다음 기본 결과를 원하는 도·개·걸·윷·모로 바꿀 수 있습니다." },\n\n  { id: "A05", name: "아수라장", tier: "silver", description: "무작위 Gold 증강 1개를 즉시 획득합니다." },\n  { id: "A06", name: "금빛 아수라장", tier: "gold", description: "무작위 Prism 증강 1개를 즉시 획득합니다." },\n];',
)

# Reuse the canonical eligibility rules when resolving an immediate replacement.
replace_exact(
    "src/lib/augments/server.ts",
    'function canOffer(augment: AugmentDefinition, phase: number, ownedIds: string[]) {',
    'export function canOffer(augment: AugmentDefinition, phase: number, ownedIds: string[]) {',
)

replace_exact(
    "src/lib/simulation/game.ts",
    'import { AUGMENT_BY_ID } from "@/lib/augments/catalog";',
    'import { AUGMENTS, AUGMENT_BY_ID, type AugmentTier } from "@/lib/augments/catalog";',
)
replace_exact(
    "src/lib/simulation/game.ts",
    'import { buildPhaseOffers, chancePerDrawForMaxGameExposure, pickTierSequence, SPECIAL_AUGMENT_IDS } from "@/lib/augments/server";',
    'import { buildPhaseOffers, canOffer, chancePerDrawForMaxGameExposure, pickTierSequence, SPECIAL_AUGMENT_IDS } from "@/lib/augments/server";',
)

replace_exact(
    "src/lib/simulation/game.ts",
    '''function commitTransition(\n  context: SimulationContext,\n''',
    '''function immediateReplacementId(\n  context: SimulationContext,\n  userId: string,\n  phase: number,\n  sourceId: "A05" | "A06",\n) {\n  const targetTier: AugmentTier = sourceId === "A05" ? "gold" : "prism";\n  const ownedIds = context.ownedByUser[userId] ?? [];\n  const alreadyClaimedUnique = new Set(\n    context.acquisitions\n      .map((item) => item.augmentId)\n      .filter((id) => AUGMENT_BY_ID.get(id)?.uniquePerGame),\n  );\n  const candidates = AUGMENTS\n    .filter((augment) => augment.tier === targetTier)\n    .filter((augment) => augment.id !== "A05" && augment.id !== "A06")\n    .filter((augment) => canOffer(augment, phase, ownedIds))\n    .filter((augment) => !augment.uniquePerGame || !alreadyClaimedUnique.has(augment.id));\n  if (!candidates.length) {\n    throw new Error(`${sourceId} replacement pool has no eligible ${targetTier} augment.`);\n  }\n  return context.rng.augment.pick(candidates).id;\n}\n\nfunction ownedIdsForOffers(context: SimulationContext) {\n  return Object.fromEntries(context.engine.players.map((player) => {\n    const consumedReplacementCards = context.acquisitions\n      .filter((item) => item.userId === player.userId && (item.augmentId === "A05" || item.augmentId === "A06"))\n      .map((item) => item.augmentId);\n    return [player.userId, [...(context.ownedByUser[player.userId] ?? []), ...consumedReplacementCards]];\n  }));\n}\n\nfunction commitTransition(\n  context: SimulationContext,\n''',
)

replace_exact(
    "src/lib/simulation/game.ts",
    '''    let offers = buildPhaseOffers({\n      seed: context.seed,\n      phase: event.logicalPhase,\n      tier,\n      players: context.engine.players.map((player) => ({ userId: player.userId, seat: player.seat })),\n      ownedByUser: context.ownedByUser,\n''',
    '''    const offerOwnedByUser = ownedIdsForOffers(context);\n    let offers = buildPhaseOffers({\n      seed: context.seed,\n      phase: event.logicalPhase,\n      tier,\n      players: context.engine.players.map((player) => ({ userId: player.userId, seat: player.seat })),\n      ownedByUser: offerOwnedByUser,\n''',
)

replace_exact(
    "src/lib/simulation/game.ts",
    '''      context.ownedByUser[offer.userId] = upgradeOwnedList(context.ownedByUser[offer.userId] ?? [], selectedId);\n      if (selectedId === "G16" || selectedId === "P14") {\n        const pieceId = setupPieceId(player);\n        if (pieceId) {\n          context.setupsByUser[offer.userId] ??= {};\n          context.setupsByUser[offer.userId][selectedId] = { pieceId };\n        }\n      }\n\n      context.acquisitions.push({\n        userId: offer.userId,\n        seat: player.seat,\n        augmentId: selectedId,\n        acquisitionIndex: eventIndex + 1,\n        logicalPhase: event.logicalPhase,\n        afterRound: event.afterRound,\n        tier: AUGMENT_BY_ID.get(selectedId)?.tier ?? tier,\n      });\n''',
    '''      const acquiredId = selectedId === "A05" || selectedId === "A06"\n        ? immediateReplacementId(context, offer.userId, event.logicalPhase, selectedId)\n        : selectedId;\n\n      context.ownedByUser[offer.userId] = upgradeOwnedList(context.ownedByUser[offer.userId] ?? [], acquiredId);\n      if (acquiredId === "G16" || acquiredId === "P14") {\n        const pieceId = setupPieceId(player);\n        if (pieceId) {\n          context.setupsByUser[offer.userId] ??= {};\n          context.setupsByUser[offer.userId][acquiredId] = { pieceId };\n        }\n      }\n\n      context.acquisitions.push({\n        userId: offer.userId,\n        seat: player.seat,\n        augmentId: selectedId,\n        acquisitionIndex: eventIndex + 1,\n        logicalPhase: event.logicalPhase,\n        afterRound: event.afterRound,\n        tier: AUGMENT_BY_ID.get(selectedId)?.tier ?? tier,\n      });\n      if (acquiredId !== selectedId) {\n        context.acquisitions.push({\n          userId: offer.userId,\n          seat: player.seat,\n          augmentId: acquiredId,\n          acquisitionIndex: eventIndex + 1,\n          logicalPhase: event.logicalPhase,\n          afterRound: event.afterRound,\n          tier: AUGMENT_BY_ID.get(acquiredId)?.tier ?? tier,\n        });\n      }\n''',
)

print("Applied ideas batch 1: A05 Asura replacement and A06 Golden Asura replacement.")
