from pathlib import Path


def replace_one(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: {label} expected once, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


game = Path("src/lib/simulation/game.ts")
types = Path("src/lib/simulation/types.ts")
runner = Path("scripts/s16-precision-run.ts")

# Materialize observability that S16 precision previously injected at runtime.
replace_one(
    game,
    "  actions: number;\n};",
    "  actions: number;\n  s16BasicRollsByUser: Record<string, number>;\n  s16NakByUser: Record<string, number>;\n};",
    "simulation telemetry context",
)
replace_one(
    game,
    '''  const nakActive = Object.values(context.ownedByUser).some((ids) => ids.includes("S16"));\n  if (engine.pendingRolls[0] === "BASIC" && nakActive && context.rng.effect.next() < 0.05) {''',
    '''  const nakActive = Object.values(context.ownedByUser).some((ids) => ids.includes("S16"));\n  if (engine.pendingRolls[0] === "BASIC" && nakActive) {\n    context.s16BasicRollsByUser[userId] = (context.s16BasicRollsByUser[userId] ?? 0) + 1;\n  }\n  if (engine.pendingRolls[0] === "BASIC" && nakActive && context.rng.effect.next() < 0.05) {\n    context.s16NakByUser[userId] = (context.s16NakByUser[userId] ?? 0) + 1;''',
    "S16 roll telemetry",
)
replace_one(
    game,
    "    actions: 0,\n  };",
    "    actions: 0,\n    s16BasicRollsByUser: Object.fromEntries(engine.players.map((player) => [player.userId, 0])),\n    s16NakByUser: Object.fromEntries(engine.players.map((player) => [player.userId, 0])),\n  };",
    "simulation telemetry initialization",
)
replace_one(
    game,
    "    firstAugmentLeaderCheckpoint: context.firstAugmentLeaderCheckpoint ?? undefined,\n    failureDiagnostics:",
    "    firstAugmentLeaderCheckpoint: context.firstAugmentLeaderCheckpoint ?? undefined,\n    s16Telemetry: {\n      basicRollsByUser: structuredClone(context.s16BasicRollsByUser),\n      nakByUser: structuredClone(context.s16NakByUser),\n    },\n    failureDiagnostics:",
    "simulation result telemetry",
)
replace_one(
    types,
    "  firstAugmentLeaderCheckpoint?: FirstAugmentLeaderCheckpoint;\n  failureDiagnostics?: SimulationFailureDiagnostics;",
    "  firstAugmentLeaderCheckpoint?: FirstAugmentLeaderCheckpoint;\n  s16Telemetry?: {\n    basicRollsByUser: Record<string, number>;\n    nakByUser: Record<string, number>;\n  };\n  failureDiagnostics?: SimulationFailureDiagnostics;",
    "simulation result type telemetry",
)

text = runner.read_text(encoding="utf-8")
text = text.replace(
    'import { mkdirSync, readFileSync, writeFileSync } from "node:fs";',
    'import { mkdirSync, writeFileSync } from "node:fs";',
)
start = text.find('const gamePath = join(process.cwd(), "src/lib/simulation/game.ts");')
end_marker = 'writeFileSync(typesPath, patchedTypesSource, "utf-8");\n\n'
end_start = text.find(end_marker, start)
if start < 0 or end_start < 0:
    raise SystemExit("s16 runner source-mutation setup block not found")
text = text[:start] + text[end_start + len(end_marker):]
text = text.replace(
    '''try {\n  const [{ getBalanceRuleset }, { simulateGame }] = await Promise.all([''',
    '''{\n  const [{ getBalanceRuleset }, { simulateGame }] = await Promise.all([''',
    1,
)
old_call = '''      const result = simulateGame({\n        seed: String(seed),\n        ruleset,\n        playerCount,\n        maxActions: 20_000,\n      });'''
new_call = '''      const result = simulateGame({\n        seed: String(seed),\n        ruleset,\n        playerCount,\n        maxActions: 20_000,\n        forcedAugmentId: augmentId,\n        forcedAcquisitionIndex: acquisitionIndex,\n      });'''
if text.count(old_call) != 1:
    raise SystemExit(f"s16 runner simulateGame call expected once, found {text.count(old_call)}")
text = text.replace(old_call, new_call, 1)
cleanup = '''} finally {\n  writeFileSync(gamePath, originalGameSource, "utf-8");\n  writeFileSync(typesPath, originalTypesSource, "utf-8");\n  delete process.env.SIM_FORCED_AUGMENT_ID;\n  delete process.env.SIM_FORCED_ACQUISITION_INDEX;\n}\n'''
if cleanup not in text:
    raise SystemExit("s16 runner cleanup block not found")
text = text.replace(cleanup, '}\n', 1)
for forbidden in [
    "readFileSync",
    "originalGameSource",
    "originalTypesSource",
    "patchedGameSource",
    "patchedTypesSource",
    "SIM_FORCED_AUGMENT_ID",
    "SIM_FORCED_ACQUISITION_INDEX",
]:
    if forbidden in text:
        raise SystemExit(f"s16 runner still contains source-mutation marker: {forbidden}")
runner.write_text(text, encoding="utf-8")

print("S16 telemetry materialized; precision runner no longer mutates canonical source.")
