from pathlib import Path

catalog = Path("src/lib/augments/catalog.ts")
text = catalog.read_text()
anchor = '  { id: "S15", name: "친구와 함께", tier: "silver", description: "이동을 마친 뒤 경로 기준 앞뒤 1칸의 아군 한 묶음을 불러와 업을 수 있습니다." },\n'
insert = anchor + '  { id: "S16", name: "낙!", tier: "silver", description: "모든 플레이어의 기본 던지기는 5% 확률로 낙이 됩니다. 자신의 낙은 대신 1칸 이동권을 얻습니다." },\n'
if 'id: "S16"' not in text:
    if anchor not in text:
        raise SystemExit("S15 anchor not found")
    catalog.write_text(text.replace(anchor, insert))

game = Path("src/lib/simulation/game.ts")
text = game.read_text()
needle = '''function executeRoll(context: SimulationContext, engine: GameEngineState, userId: string) {
  const owned = actorOwned(context, userId);
  const before = structuredClone(engine);
'''
replacement = '''function executeRoll(context: SimulationContext, engine: GameEngineState, userId: string) {
  const owned = actorOwned(context, userId);
  const before = structuredClone(engine);

  const nakActive = Object.values(context.ownedByUser).some((ids) => ids.includes("S16"));
  if (engine.pendingRolls[0] === "BASIC" && nakActive && context.rng.effect.next() < 0.05) {
    const next = structuredClone(engine);
    next.pendingRolls.shift();
    const actorName = currentPlayer(next).displayName;
    if (owned.includes("S16")) {
      next.results.push({
        id: nextTokenId(context, "nak-compensation"),
        face: "MOVE1",
        baseSteps: 1,
        finalSteps: 1,
        source: "AUGMENT",
        suppressMovementBonuses: true,
      });
      next.stage = "MOVING";
      next.lastAction = `${actorName}: 낙! · 1칸 이동권`;
    } else if (next.pendingRolls.length > 0) {
      next.stage = "AWAITING_ROLL";
      next.lastAction = `${actorName}: 낙!`;
    } else if (next.results.length > 0) {
      next.stage = "MOVING";
      next.lastAction = `${actorName}: 낙!`;
    } else {
      advanceTurnForVacancy(next);
      next.lastAction = `${actorName}: 낙! · ${currentPlayer(next).displayName}의 턴`;
    }
    return finalizeAction(before, next, userId, context, "roll");
  }
'''
if 'nakActive = Object.values(context.ownedByUser)' not in text:
    if needle not in text:
        raise SystemExit("executeRoll anchor not found")
    game.write_text(text.replace(needle, replacement))

triggers = Path("src/lib/simulation/triggers.ts")
text = triggers.read_text()
needle = '''function detectRollTriggers(input: DetectInput, events: Map<string, AugmentTriggerEvent>) {
  const ownedIds = input.ownedByUser[input.actorUserId] ?? [];
'''
replacement = '''function detectRollTriggers(input: DetectInput, events: Map<string, AugmentTriggerEvent>) {
  const ownedIds = input.ownedByUser[input.actorUserId] ?? [];

  if (input.actionKind === "roll" && input.after.lastAction.includes("낙!")) {
    for (const [ownerUserId, ids] of Object.entries(input.ownedByUser)) {
      if (ids.includes("S16")) addMapEvent(events, ownerUserId, "S16");
    }
  }
'''
if 'ids.includes("S16")' not in text:
    if needle not in text:
        raise SystemExit("detectRollTriggers anchor not found")
    triggers.write_text(text.replace(needle, replacement))

print("S16 experiment patch applied")
