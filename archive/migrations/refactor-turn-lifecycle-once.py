from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


engine_path = Path("src/lib/game/engine.ts")
engine = engine_path.read_text(encoding="utf-8")
engine = replace_once(
    engine,
    "function advanceTurn(engine: GameEngineState) {",
    "export function advanceTurn(engine: GameEngineState) {",
    "export advanceTurn",
)
engine_path.write_text(engine, encoding="utf-8")

sim_path = Path("src/lib/simulation/game.ts")
sim = sim_path.read_text(encoding="utf-8")

sim = sim.replace("  queueA04BonusForNextBasic,\n", "")
sim = sim.replace("  applyBombExplosion,\n", "")
sim = sim.replace("  applyGravityExplosion,\n", "")
sim = sim.replace('import { discardUnusableResults } from "@/lib/game/engine";\n', "")

turn_import_anchor = 'import { injectTomorrowResult, saveResultForTomorrow } from "@/lib/game/tomorrow";\n'
turn_import = '''import { injectTomorrowResult, saveResultForTomorrow } from "@/lib/game/tomorrow";\nimport {\n  activatePlagueTurnIfNeeded,\n  injectBombBonusRolls,\n  prepareBasicRollAugments,\n  resolveDueAutomaticAugmentEvent,\n  resolveS16Nak,\n  resolveUniverseFreezeTurn,\n  resolveVacancyTurn,\n} from "@/lib/game/turn-lifecycle";\n'''
sim = replace_once(sim, turn_import_anchor, turn_import, "turn lifecycle imports")

start = sim.index("function advanceTurnForVacancy(")
end = sim.index("function maybeUseGachaMachine(", start)
sim = sim[:start] + sim[end:]

start = sim.index("function maybeApplyBombExplosion(")
end = sim.index("function stepGame(", start)
sim = sim[:start] + sim[end:]

nak_start = sim.index('  const nakActive = Object.values(context.ownedByUser).some((ids) => ids.includes("S16"));')
nak_end_marker = '  if (engine.pendingRolls[0] === "BASIC" && owned.includes("P19") && godHandChargeCount(engine, userId, owned) > 0) {'
nak_end = sim.index(nak_end_marker, nak_start)
new_nak = '''  const nak = resolveS16Nak(\n    engine,\n    userId,\n    context.ownedByUser,\n    actorSetups(context, userId),\n    () => context.rng.effect.next(),\n    () => nextTokenId(context, "nak-compensation"),\n  );\n  if (nak.checked) {\n    context.s16BasicRollsByUser[userId] = (context.s16BasicRollsByUser[userId] ?? 0) + 1;\n  }\n  if (nak.occurred) {\n    context.s16NakByUser[userId] = (context.s16NakByUser[userId] ?? 0) + 1;\n    return finalizeAction(before, nak.engine, userId, context, "roll");\n  }\n'''
sim = sim[:nak_start] + new_nak + sim[nak_end:]

old_step_prefix = '''  const turnOwner = currentPlayer(context.engine);\n  const turnRuntime = context.engine.augmentRuntime?.[turnOwner.userId];\n  if (turnRuntime && Object.keys(turnRuntime.plaguePieceIds ?? {}).length > 0 && turnRuntime.plagueTurnActive !== true) {\n    turnRuntime.plagueTurnActive = true;\n  }\n  if (maybeApplyBombExplosion(context)) return;\n  if (context.engine.winnerUserId) return;\n  if (maybeApplyGravityExplosion(context)) return;\n'''
new_step_prefix = '''  const plagueBefore = context.engine;\n  context.engine = activatePlagueTurnIfNeeded(context.engine);\n  if (context.engine !== plagueBefore) {\n    assertGameStateInvariants(context.engine, {\n      ownedByUser: context.ownedByUser,\n      setupsByUser: context.setupsByUser,\n      label: `plague-turn@${context.actions}`,\n    });\n  }\n\n  const automaticBefore = context.engine;\n  const automaticEvent = resolveDueAutomaticAugmentEvent(\n    automaticBefore,\n    context.ownedByUser,\n    () => context.rng.effect.next(),\n  );\n  if (automaticEvent.applied) {\n    const actorUserId = automaticEvent.actorUserId ?? currentPlayer(automaticBefore).userId;\n    commitTransition(context, automaticBefore, automaticEvent.engine, actorUserId, "augment_event");\n    return;\n  }\n'''
sim = replace_once(sim, old_step_prefix, new_step_prefix, "step automatic lifecycle")

old_freeze_vacancy = '''  if (context.engine.winnerUserId) return;\n  if (maybeApplyUniverseFreeze(context)) return;\n  if (maybeApplyVacancySkip(context)) return;\n'''
new_freeze_vacancy = '''  if (context.engine.winnerUserId) return;\n\n  const freeze = resolveUniverseFreezeTurn(context.engine);\n  if (freeze.applied) {\n    context.engine = freeze.engine;\n    assertGameStateInvariants(context.engine, {\n      ownedByUser: context.ownedByUser,\n      setupsByUser: context.setupsByUser,\n      label: `universe-freeze@${context.actions}`,\n    });\n    return;\n  }\n\n  const vacancyActor = currentPlayer(context.engine);\n  const vacancy = resolveVacancyTurn(\n    context.engine,\n    actorOwned(context, vacancyActor.userId),\n  );\n  if (vacancy.applied) {\n    context.engine = vacancy.engine;\n    assertGameStateInvariants(context.engine, {\n      ownedByUser: context.ownedByUser,\n      setupsByUser: context.setupsByUser,\n      label: `vacancy@${context.actions}`,\n    });\n    return;\n  }\n'''
sim = replace_once(sim, old_freeze_vacancy, new_freeze_vacancy, "freeze/vacancy lifecycle")

sim = replace_once(
    sim,
    "    queueA04BonusForNextBasic(context.engine, userId, actorOwned(context, userId));",
    "    prepareBasicRollAugments(context.engine, userId, actorOwned(context, userId));",
    "A04 roll preparation",
)

for forbidden in [
    "function advanceTurnForVacancy(",
    "function maybeApplyUniverseFreeze(",
    "function maybeApplyVacancySkip(",
    "function maybeApplyBombExplosion(",
    "function maybeApplyGravityExplosion(",
    "function injectBombBonusRolls(",
    "queueA04BonusForNextBasic(context.engine",
    "const nakActive = Object.values(context.ownedByUser)",
    "turnRuntime.plagueTurnActive = true",
]:
    if forbidden in sim:
        raise SystemExit(f"simulation turn-rule remnant remains: {forbidden}")

sim_path.write_text(sim, encoding="utf-8")
print("Moved automatic turn, plague, bomb/gravity, vacancy/freeze, A04 and S16 Nak state transitions into game lifecycle.")
