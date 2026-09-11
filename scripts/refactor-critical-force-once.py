from pathlib import Path


def replace_one(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


# Forced precision is a simulation input, not a runtime source rewrite.
replace_one(
    "src/lib/simulation/game.ts",
    "  maxActions?: number;\n  maxRounds?: number;\n};",
    "  maxActions?: number;\n  maxRounds?: number;\n  forcedAugmentId?: string;\n  forcedAcquisitionIndex?: number;\n};",
)
replace_one(
    "src/lib/simulation/game.ts",
    "  seed: string;\n  ruleset: BalanceRuleset;\n  tokenCounter: number;",
    "  seed: string;\n  ruleset: BalanceRuleset;\n  forcedAugmentId?: string;\n  forcedAcquisitionIndex?: number;\n  tokenCounter: number;",
)
replace_one(
    "src/lib/simulation/game.ts",
    '''      const currentlyEligible = visible.filter((id) => id !== "A10" || playerHasWaitingPiece(context, offer.userId));\n      const selectedId = context.rng.augment.pick(currentlyEligible.length > 0 ? currentlyEligible : visible);''',
    '''      const currentlyEligible = visible.filter((id) => id !== "A10" || playerHasWaitingPiece(context, offer.userId));\n      const numericSeed = Number(context.seed);\n      const forcedSeat = (Number.isFinite(numericSeed) ? numericSeed : 0) % context.engine.players.length + 1;\n      const forceEligible = context.forcedAugmentId !== "A10" || playerHasWaitingPiece(context, offer.userId);\n      const shouldForce = Boolean(context.forcedAugmentId)\n        && forceEligible\n        && eventIndex + 1 === (context.forcedAcquisitionIndex ?? 1)\n        && player.seat === forcedSeat;\n      const selectedId = shouldForce\n        ? context.forcedAugmentId!\n        : context.rng.augment.pick(currentlyEligible.length > 0 ? currentlyEligible : visible);''',
)
replace_one(
    "src/lib/simulation/game.ts",
    "    seed: options.seed,\n    ruleset: options.ruleset,\n    tokenCounter: 0,",
    "    seed: options.seed,\n    ruleset: options.ruleset,\n    forcedAugmentId: options.forcedAugmentId,\n    forcedAcquisitionIndex: options.forcedAcquisitionIndex,\n    tokenCounter: 0,",
)

runner = Path("scripts/critical-precision-run.ts")
text = runner.read_text(encoding="utf-8")
text = text.replace('import { mkdirSync, readFileSync, writeFileSync } from "node:fs";', 'import { mkdirSync, writeFileSync } from "node:fs";')
start = text.index('const gamePath = join(process.cwd(), "src/lib/simulation/game.ts");')
end_marker = 'process.env.SIM_FORCED_AUGMENT_ID = augmentId;\nwriteFileSync(gamePath, originalGameSource.replace(selectionBlock, forcedSelectionBlock), "utf-8");\n\n'
end = text.index(end_marker, start) + len(end_marker)
text = text[:start] + text[end:]
text = text.replace('try {\n  const [{ AUGMENTS, AUGMENT_BY_ID }, { getBalanceRuleset }, { simulateGame }] = await Promise.all([', '{\n  const [{ AUGMENTS, AUGMENT_BY_ID }, { getBalanceRuleset }, { simulateGame }] = await Promise.all([')
text = text.replace('    process.env.SIM_FORCED_ACQUISITION_INDEX = String(acquisitionIndex);\n\n', '')
text = text.replace(
    '''          maxActions: 20_000,\n          maxRounds,\n        });''',
    '''          maxActions: 20_000,\n          maxRounds,\n          forcedAugmentId: augmentId,\n          forcedAcquisitionIndex: acquisitionIndex,\n        });''',
)
text = text.replace('    "- current post-v10 acquisition flow is applied before forcing",', '    "- canonical acquisition flow is used directly; forcing is passed as simulation input",')
finally_block = '''} finally {\n  writeFileSync(gamePath, originalGameSource, "utf-8");\n  delete process.env.SIM_FORCED_AUGMENT_ID;\n  delete process.env.SIM_FORCED_ACQUISITION_INDEX;\n}\n'''
if finally_block not in text:
    raise SystemExit("critical precision cleanup block not found")
text = text.replace(finally_block, '}\n', 1)
runner.write_text(text, encoding="utf-8")

print("Refactored forced precision to use explicit simulation options without source mutation.")
