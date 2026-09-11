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
    "function adjustedMoonwalkResult(\n",
    "export function adjustedResultForMove(\n",
    "export adjusted movement result",
)
engine = engine.replace("adjustedMoonwalkResult(engine, mover.userId, args.groupId, result, ownedIds, setups)", "adjustedResultForMove(engine, mover.userId, args.groupId, result, ownedIds, setups)")

legal_insert = r'''

export type EngineLegalMoveOption = {
  groupId: string;
  result: RollToken;
  target: EngineMoveTarget;
};

export function legalMoveOptionsWithAugments(
  engine: GameEngineState,
  userId: string,
  ownedIds: string[] = [],
  setups: PlayerAugmentSetups = {},
  ownedByUser: Record<string, string[]> = {},
  movementOwnedIds: string[] = ownedIds,
): EngineLegalMoveOption[] {
  if (engine.stage !== "MOVING") return [];
  const player = engine.players.find((candidate) => candidate.userId === userId && candidate.seat === engine.currentSeat);
  if (!player) return [];
  const moonwalk = ownedIds.includes("P02");
  const options: EngineLegalMoveOption[] = [];

  for (const result of engine.results) {
    if (result.numericPool) continue;
    const seen = new Set<string>();
    for (const piece of player.pieces) {
      if (seen.has(piece.groupId)) continue;
      if (piece.status === "WORMHOLE" || piece.status === "MARGIN") continue;
      if (piece.status === "FINISHED" && !moonwalk) continue;
      seen.add(piece.groupId);

      if (!moonwalk && !isGroupUsableWithAugments(engine, userId, piece.groupId, ownedIds, setups)) continue;
      if (result.forbiddenPieceIds?.some((pieceId) => player.pieces.some((candidate) => (
        candidate.groupId === piece.groupId
        && candidate.id === pieceId
        && candidate.status !== "FINISHED"
      )))) continue;

      const effective = adjustedResultForMove(
        engine,
        userId,
        piece.groupId,
        result,
        movementOwnedIds,
        setups,
      );
      for (const target of legalMoveTargetsWithAugments(
        engine,
        userId,
        piece,
        effective,
        movementOwnedIds,
        ownedByUser,
      )) {
        options.push({ groupId: piece.groupId, result, target });
      }
    }
  }

  return options;
}

export function discardMovementResultsWhenNoLegalMove(
  engineInput: GameEngineState,
  userId: string,
  ownedIds: string[] = [],
  setups: PlayerAugmentSetups = {},
  ownedByUser: Record<string, string[]> = {},
  movementOwnedIds: string[] = ownedIds,
): GameEngineState {
  if (engineInput.stage !== "MOVING") return engineInput;
  if (legalMoveOptionsWithAugments(
    engineInput,
    userId,
    ownedIds,
    setups,
    ownedByUser,
    movementOwnedIds,
  ).length > 0) return engineInput;

  const engine = clone(engineInput);
  const actor = currentPlayer(engine);
  engine.results = [];
  if (engine.pendingRolls.length > 0) {
    engine.stage = "AWAITING_ROLL";
    engine.lastAction = `${actor.displayName}: 사용할 수 있는 이동 결과가 없어 결과 소멸`;
  } else {
    advanceTurn(engine);
    engine.lastAction = `${actor.displayName}: 사용할 수 있는 이동 결과가 없어 결과 소멸 · ${currentPlayer(engine).displayName}의 턴`;
  }
  return engine;
}
'''
engine = replace_once(
    engine,
    "\nfunction opponentGroupsAtNode(engine: GameEngineState, moverUserId: string, node: number) {",
    legal_insert + "\nfunction opponentGroupsAtNode(engine: GameEngineState, moverUserId: string, node: number) {",
    "legal action API insertion",
)

if "adjustedMoonwalkResult" in engine:
    raise SystemExit("old adjustedMoonwalkResult symbol remains")
engine_path.write_text(engine, encoding="utf-8")

sim_path = Path("src/lib/simulation/game.ts")
sim = sim_path.read_text(encoding="utf-8")
sim = sim.replace("  adjustedResultForGroup,\n", "")
sim = sim.replace("  legalMoveTargetsWithAugments,\n", "  legalMoveOptionsWithAugments,\n  discardMovementResultsWhenNoLegalMove,\n")

start = sim.index("function adjustedResultForTargeting(")
end = sim.index("function moveArgsForTarget", start)
sim = sim[:start] + sim[end:]

old_best = '''function bestMove(context: SimulationContext, engine: GameEngineState, userId: string) {\n  const owned = actorOwned(context, userId);\n  const setups = actorSetups(context, userId);\n  const moveOwned = moveOwnedIdsForAthlete(owned);\n  const groups = groupRepresentativesForBot(engine, userId, owned);\n  const candidates: Array<{ next: GameEngineState; score: number }> = [];\n\n  for (const result of engine.results) {\n    if (result.numericPool) continue;\n    for (const piece of groups) {\n      if (!isGroupUsableWithAugments(engine, userId, piece.groupId, owned, setups)) continue;\n      if (result.forbiddenPieceIds?.some((pieceId) => {\n        const player = engine.players.find((candidate) => candidate.userId === userId);\n        return player?.pieces.some((candidate) => candidate.groupId === piece.groupId && candidate.id === pieceId && candidate.status !== "FINISHED");\n      })) continue;\n\n      const effective = adjustedResultForTargeting(engine, userId, piece, result, moveOwned, setups);\n      const targets = legalMoveTargetsWithAugments(engine, userId, piece, effective, moveOwned, context.ownedByUser);\n      for (const target of targets) {\n        try {\n          const next = executeMoveAction(context, engine, userId, moveArgsForTarget(piece.groupId, result, target, owned.includes("P02")));\n          candidates.push({\n            next,\n            score: outcomeScore(context, engine, next, userId) + context.rng.decision.next() * 0.001,\n          });\n        } catch {\n          // Candidate enumeration is intentionally defensive; illegal combinations are ignored.\n        }\n      }\n    }\n  }\n\n  candidates.sort((left, right) => right.score - left.score);\n  return candidates[0]?.next ?? null;\n}\n'''
new_best = '''function bestMove(context: SimulationContext, engine: GameEngineState, userId: string) {\n  const owned = actorOwned(context, userId);\n  const setups = actorSetups(context, userId);\n  const moveOwned = moveOwnedIdsForAthlete(owned);\n  const candidates: Array<{ next: GameEngineState; score: number }> = [];\n  const legalOptions = legalMoveOptionsWithAugments(\n    engine,\n    userId,\n    owned,\n    setups,\n    context.ownedByUser,\n    moveOwned,\n  );\n\n  for (const option of legalOptions) {\n    try {\n      const next = executeMoveAction(\n        context,\n        engine,\n        userId,\n        moveArgsForTarget(option.groupId, option.result, option.target, owned.includes("P02")),\n      );\n      candidates.push({\n        next,\n        score: outcomeScore(context, engine, next, userId) + context.rng.decision.next() * 0.001,\n      });\n    } catch {\n      // The engine enumerates legal actions; execution failures are kept out of bot scoring.\n    }\n  }\n\n  candidates.sort((left, right) => right.score - left.score);\n  return candidates[0]?.next ?? null;\n}\n'''
sim = replace_once(sim, old_best, new_best, "simulation bestMove")

fallback_start = sim.index("    if (!next) {\n      const plaguePieceIds")
fallback_end_marker = '      throw new Error(`No legal move candidate for ${userId} at turn ${context.engine.turnNumber}.`);\n    }'
fallback_end = sim.index(fallback_end_marker, fallback_start) + len(fallback_end_marker)
new_fallback = '''    if (!next) {\n      const owned = actorOwned(context, userId);\n      const discarded = discardMovementResultsWhenNoLegalMove(\n        before,\n        userId,\n        owned,\n        actorSetups(context, userId),\n        context.ownedByUser,\n        moveOwnedIdsForAthlete(owned),\n      );\n      if (discarded !== before) {\n        commitTransition(context, before, discarded, userId, "move");\n        return;\n      }\n      throw new Error(`Engine exposed legal moves that the simulator could not execute for ${userId} at turn ${context.engine.turnNumber}.`);\n    }'''
sim = sim[:fallback_start] + new_fallback + sim[fallback_end:]

for forbidden in [
    "function adjustedResultForTargeting",
    "const plaguePieceIds = context.engine.augmentRuntime",
    "allBoardGroupsTurtleLocked",
    "No legal move candidate for",
    "legalMoveTargetsWithAugments(engine, userId, piece",
]:
    if forbidden in sim:
        raise SystemExit(f"simulation legal-rule remnant remains: {forbidden}")

sim_path.write_text(sim, encoding="utf-8")
print("Centralized legal move enumeration and no-legal-move result discard in the game engine.")
