from pathlib import Path

path = Path("src/lib/simulation/game.ts")
text = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    text = text.replace(old, new, 1)


replace_once(
    'import { buildPhaseOffers, canOffer, chancePerDrawForMaxGameExposure, pickTierSequence, SPECIAL_AUGMENT_IDS } from "@/lib/augments/server";\n',
    'import { referencedSetupPieceIds } from "@/lib/augments/setup";\nimport { buildPhaseOffers, canOffer, chancePerDrawForMaxGameExposure, pickTierSequence, SPECIAL_AUGMENT_IDS } from "@/lib/augments/server";\n',
    "setup helper import",
)

replace_once(
    'import { applyPassiveSpecialWinner } from "@/lib/game/passive-win";\n',
    'import {\n  applyCrossTransitionLegacyRules,\n  applyPostTransitionAugmentLifecycle,\n} from "@/lib/game/transition-lifecycle";\n',
    "transition lifecycle import",
)

replace_once(
'''  const beforeActor = currentPlayer(before).userId;
  const afterActor = currentPlayer(after).userId;
  if (beforeActor !== afterActor) {
    const runtime = after.augmentRuntime?.[beforeActor];
    if (runtime?.plagueTurnActive) {
      runtime.plaguePieceIds = {};
      runtime.plagueTurnActive = false;
    }
  }
  context.engine = applyPassiveSpecialWinner(after, context.ownedByUser);
''',
'''  context.engine = applyCrossTransitionLegacyRules(before, after, context);
''',
    "commit transition game rules",
)

marker = '''function applyDueAugmentEvents(context: SimulationContext) {
'''
helper = '''function canonicalizeRawTransition(
  context: SimulationContext,
  before: GameEngineState,
  after: GameEngineState,
  actorUserId: string,
  actionKind: SimulationActionKind,
  event: Readonly<Record<string, unknown>> = {},
) {
  return applyPostTransitionAugmentLifecycle(
    before,
    after,
    actorUserId,
    actionKind,
    context,
    event,
  );
}

function applyRawTransitionWithoutTelemetry(
  context: SimulationContext,
  before: GameEngineState,
  after: GameEngineState,
  actorUserId: string,
  actionKind: SimulationActionKind,
  label: string,
  event: Readonly<Record<string, unknown>> = {},
) {
  context.engine = canonicalizeRawTransition(context, before, after, actorUserId, actionKind, event);
  assertGameStateInvariants(context.engine, {
    ownedByUser: context.ownedByUser,
    setupsByUser: context.setupsByUser,
    label,
  });
}

function applyDueAugmentEvents(context: SimulationContext) {
'''
replace_once(marker, helper, "raw transition helpers")

replace_once(
'''      if (acquisitionLifecycle.immediateTransitionFrom) {
        commitTransition(
          context,
          acquisitionLifecycle.immediateTransitionFrom,
          acquisitionLifecycle.engine,
          offer.userId,
          "augment_event",
        );
      } else {
''',
'''      if (acquisitionLifecycle.immediateTransitionFrom) {
        const acquisitionNext = canonicalizeRawTransition(
          context,
          acquisitionLifecycle.immediateTransitionFrom,
          acquisitionLifecycle.engine,
          offer.userId,
          "augment_event",
          { acquiredAugmentId: acquiredId },
        );
        commitTransition(
          context,
          acquisitionLifecycle.immediateTransitionFrom,
          acquisitionNext,
          offer.userId,
          "augment_event",
        );
      } else {
''',
    "acquisition raw transition",
)

replace_once(
'''    const passiveBefore = structuredClone(context.engine);
    const passiveAfter = applyPassiveSpecialWinner(context.engine, context.ownedByUser);
    commitTransition(context, passiveBefore, passiveAfter, currentPlayer(passiveBefore).userId, "augment_event");
''',
'''    const passiveBefore = structuredClone(context.engine);
    const passiveAfter = applyCrossTransitionLegacyRules(passiveBefore, context.engine, context);
    commitTransition(context, passiveBefore, passiveAfter, currentPlayer(passiveBefore).userId, "augment_event");
''',
    "acquisition passive tail",
)

replace_once(
'''  commitTransition(context, before, result.engine, actor.userId, "augment_event");
''',
'''  const next = canonicalizeRawTransition(
    context,
    before,
    result.engine,
    actor.userId,
    "augment_event",
    { kind: "gacha_machine", augmentId: "A02" },
  );
  commitTransition(context, before, next, actor.userId, "augment_event");
''',
    "gacha raw transition",
)

replace_once(
'''  const before = structuredClone(engine);
  const next = applyWormholeTurn(engine, actor.userId, selected[0], owned);
  commitTransition(context, before, next, actor.userId, "wormhole");
''',
'''  const before = structuredClone(engine);
  const rawNext = applyWormholeTurn(engine, actor.userId, selected[0], owned);
  const next = canonicalizeRawTransition(
    context,
    before,
    rawNext,
    actor.userId,
    "wormhole",
    { groupId: selected[0] },
  );
  commitTransition(context, before, next, actor.userId, "wormhole");
''',
    "wormhole action raw transition",
)

replace_once(
'''    const setups = actorSetups(context, chooserUserId);
    const protectedIds = new Set([setups.G16?.pieceId, setups.P14?.pieceId].filter((id): id is string => Boolean(id)));
''',
'''    const setups = actorSetups(context, chooserUserId);
    const protectedIds = referencedSetupPieceIds(setups);
''',
    "generic referenced setup protection",
)

replace_once(
'''  if (automaticEvent.applied) {
    const actorUserId = automaticEvent.actorUserId ?? currentPlayer(automaticBefore).userId;
    commitTransition(context, automaticBefore, automaticEvent.engine, actorUserId, "augment_event");
    return;
  }

  const returnActor = currentPlayer(context.engine);
  context.engine = resolveDueWormholeReturns(
    context.engine,
    returnActor.userId,
    actorOwned(context, returnActor.userId),
    actorSetups(context, returnActor.userId),
    context.rng.effect.next,
  );
  if (context.engine.winnerUserId) return;

  const freeze = resolveUniverseFreezeTurn(context.engine);
  if (freeze.applied) {
    context.engine = freeze.engine;
    assertGameStateInvariants(context.engine, {
      ownedByUser: context.ownedByUser,
      setupsByUser: context.setupsByUser,
      label: `universe-freeze@${context.actions}`,
    });
    return;
  }

  const vacancyActor = currentPlayer(context.engine);
  const vacancy = resolveVacancyTurn(
    context.engine,
    actorOwned(context, vacancyActor.userId),
  );
  if (vacancy.applied) {
    context.engine = vacancy.engine;
    assertGameStateInvariants(context.engine, {
      ownedByUser: context.ownedByUser,
      setupsByUser: context.setupsByUser,
      label: `vacancy@${context.actions}`,
    });
    return;
  }
''',
'''  if (automaticEvent.applied) {
    const actorUserId = automaticEvent.actorUserId ?? currentPlayer(automaticBefore).userId;
    const automaticNext = canonicalizeRawTransition(
      context,
      automaticBefore,
      automaticEvent.engine,
      actorUserId,
      "augment_event",
      { kind: "automatic_augment_event" },
    );
    commitTransition(context, automaticBefore, automaticNext, actorUserId, "augment_event");
    return;
  }

  const returnBefore = context.engine;
  const returnActor = currentPlayer(returnBefore);
  const returnAfter = resolveDueWormholeReturns(
    returnBefore,
    returnActor.userId,
    actorOwned(context, returnActor.userId),
    actorSetups(context, returnActor.userId),
    context.rng.effect.next,
  );
  if (returnAfter !== returnBefore) {
    applyRawTransitionWithoutTelemetry(
      context,
      returnBefore,
      returnAfter,
      returnActor.userId,
      "augment_event",
      `wormhole-return@${context.actions}`,
      { kind: "wormhole_return" },
    );
  } else {
    context.engine = returnAfter;
  }
  if (context.engine.winnerUserId) return;

  const freezeBefore = context.engine;
  const freezeActor = currentPlayer(freezeBefore);
  const freeze = resolveUniverseFreezeTurn(freezeBefore);
  if (freeze.applied) {
    applyRawTransitionWithoutTelemetry(
      context,
      freezeBefore,
      freeze.engine,
      freezeActor.userId,
      "augment_event",
      `universe-freeze@${context.actions}`,
      { kind: "universe_freeze" },
    );
    return;
  }

  const vacancyBefore = context.engine;
  const vacancyActor = currentPlayer(vacancyBefore);
  const vacancy = resolveVacancyTurn(
    vacancyBefore,
    actorOwned(context, vacancyActor.userId),
  );
  if (vacancy.applied) {
    applyRawTransitionWithoutTelemetry(
      context,
      vacancyBefore,
      vacancy.engine,
      vacancyActor.userId,
      "augment_event",
      `vacancy@${context.actions}`,
      { kind: "vacancy" },
    );
    return;
  }
''',
    "automatic transition boundaries",
)

replace_once(
'''      if (discarded !== before) {
        commitTransition(context, before, discarded, userId, "move");
        return;
      }
''',
'''      if (discarded !== before) {
        const finalizedDiscard = canonicalizeRawTransition(
          context,
          before,
          discarded,
          userId,
          "move",
          { kind: "discard_no_legal_move" },
        );
        commitTransition(context, before, finalizedDiscard, userId, "move");
        return;
      }
''',
    "no legal move transition",
)

path.write_text(text, encoding="utf-8")
print("transition lifecycle migration applied")
