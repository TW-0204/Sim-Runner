from pathlib import Path

path = Path('src/lib/simulation/game.ts')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        'import { baseStepsForFace, castYut } from "@/lib/game/roll";\n',
        'import { baseStepsForFace } from "@/lib/game/roll";\n',
    ),
    (
        '''import {\n  applyGodHandRoll,\n  beginRollFlow,\n  godHandChargeCount,\n  keepDoResult,\n  rerollDoResult,\n  resolveDualRollChoice,\n} from "@/lib/game/roll-flow";\n''',
        '''import {\n  godHandChargeCount,\n  keepDoResult,\n  resolveDualRollChoice,\n} from "@/lib/game/roll-flow";\nimport { executeDoRerollLifecycle, executeRollLifecycle } from "@/lib/game/roll-lifecycle";\n''',
    ),
    (
        '''  prepareBasicRollAugments,\n  resolveDueAutomaticAugmentEvent,\n  resolveS16Nak,\n  resolveUniverseFreezeTurn,\n''',
        '''  prepareBasicRollAugments,\n  resolveDueAutomaticAugmentEvent,\n  resolveUniverseFreezeTurn,\n''',
    ),
    (
        '''function withSeededMathRandom<T>(random: () => number, callback: () => T): T {\n  const original = Math.random;\n  Math.random = random;\n  try {\n    return callback();\n  } finally {\n    Math.random = original;\n  }\n}\n\n''',
        '',
    ),
    (
        '''  const rerolledFace = castYut(context.rng.roll.next);\n  const next = rerollDoResult(engine, rerolledFace, nextTokenId(context, "do-reroll"), owned, actorSetups(context, userId));\n  return finalizeAction(before, next, userId, context, "reroll_do");\n''',
        '''  return executeDoRerollLifecycle({\n    context,\n    engine,\n    userId,\n    randomRoll: context.rng.roll.next,\n    nextTokenId: (label) => nextTokenId(context, label),\n  });\n''',
    ),
    (
        '''function executeRoll(context: SimulationContext, engine: GameEngineState, userId: string) {\n  const owned = actorOwned(context, userId);\n  const before = structuredClone(engine);\n\n  const nak = resolveS16Nak(\n    engine,\n    userId,\n    context.ownedByUser,\n    actorSetups(context, userId),\n    () => context.rng.effect.next(),\n    () => nextTokenId(context, "nak-compensation"),\n  );\n  if (nak.checked) {\n    context.s16BasicRollsByUser[userId] = (context.s16BasicRollsByUser[userId] ?? 0) + 1;\n  }\n  if (nak.occurred) {\n    context.s16NakByUser[userId] = (context.s16NakByUser[userId] ?? 0) + 1;\n    return finalizeAction(before, nak.engine, userId, context, "roll");\n  }\n  if (engine.pendingRolls[0] === "BASIC" && owned.includes("P19") && godHandChargeCount(engine, userId, owned) > 0) {\n    const next = applyGodHandRoll(engine, "MO", nextTokenId(context, "god-hand"), owned, actorSetups(context, userId));\n    return finalizeAction(before, next, userId, context, "god_hand");\n  }\n\n  const faces: [ReturnType<typeof castYut>, ReturnType<typeof castYut>] = [\n    castYut(context.rng.roll.next),\n    castYut(context.rng.roll.next),\n  ];\n  const next = withSeededMathRandom(context.rng.effect.next, () => (\n    beginRollFlow(engine, faces, nextTokenId(context, "roll"), owned, actorSetups(context, userId))\n  ));\n  return finalizeAction(before, next, userId, context, "roll");\n}\n''',
        '''function executeRoll(context: SimulationContext, engine: GameEngineState, userId: string) {\n  const owned = actorOwned(context, userId);\n  const godHandFace = engine.pendingRolls[0] === "BASIC"\n    && owned.includes("P19")\n    && godHandChargeCount(engine, userId, owned) > 0\n      ? "MO" as const\n      : null;\n\n  const result = executeRollLifecycle({\n    context,\n    engine,\n    userId,\n    randomRoll: context.rng.roll.next,\n    randomEffect: context.rng.effect.next,\n    nextTokenId: (label) => nextTokenId(context, label),\n    godHandFace,\n  });\n  if (result.s16Checked) {\n    context.s16BasicRollsByUser[userId] = (context.s16BasicRollsByUser[userId] ?? 0) + 1;\n  }\n  if (result.s16Occurred) {\n    context.s16NakByUser[userId] = (context.s16NakByUser[userId] ?? 0) + 1;\n  }\n  return result.engine;\n}\n''',
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected exactly one migration target, found {count}: {old[:80]!r}')
    text = text.replace(old, new)

path.write_text(text, encoding='utf-8')
print('roll lifecycle migration applied')
