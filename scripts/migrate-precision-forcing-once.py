from pathlib import Path


def refactor_runner(path_str: str, *, special: bool) -> None:
    path = Path(path_str)
    text = path.read_text(encoding="utf-8")
    text = text.replace(
        'import { mkdirSync, readFileSync, writeFileSync } from "node:fs";',
        'import { mkdirSync, writeFileSync } from "node:fs";',
    )

    start = text.find('const gamePath = join(process.cwd(), "src/lib/simulation/game.ts");')
    if start < 0:
        raise SystemExit(f"{path}: source-mutation setup block not found")

    if special:
        end_marker = 'writeFileSync(gamePath, originalGameSource.replace(selectionBlock, forcedSelectionBlock), "utf-8");\n\n'
    else:
        end_marker = 'process.env.SIM_FORCED_AUGMENT_ID = augmentId;\n\n'
    end_start = text.find(end_marker, start)
    if end_start < 0:
        raise SystemExit(f"{path}: source-mutation setup end not found")
    text = text[:start] + text[end_start + len(end_marker):]

    if not special:
        text = text.replace('    process.env.SIM_FORCED_ACQUISITION_INDEX = String(acquisitionIndex);\n', '')

    if special:
        old_call = '''      const result = simulateGame({\n        seed: String(seed),\n        ruleset,\n        playerCount,\n        maxActions: 20_000,\n      });'''
        new_call = '''      const result = simulateGame({\n        seed: String(seed),\n        ruleset,\n        playerCount,\n        maxActions: 20_000,\n        forcedAugmentId: augmentId,\n        forcedAcquisitionIndex: acquisitionIndex,\n      });'''
    else:
        old_call = '        const result = simulateGame({ seed: String(seed), ruleset, playerCount, maxActions: 20_000, maxRounds });'
        new_call = '''        const result = simulateGame({\n          seed: String(seed),\n          ruleset,\n          playerCount,\n          maxActions: 20_000,\n          maxRounds,\n          forcedAugmentId: augmentId,\n          forcedAcquisitionIndex: acquisitionIndex,\n        });'''

    if text.count(old_call) != 1:
        raise SystemExit(f"{path}: simulateGame call match count is {text.count(old_call)}, expected 1")
    text = text.replace(old_call, new_call, 1)

    if special:
        old_finally = '''try {\n  const [{ getBalanceRuleset }, { simulateGame }] = await Promise.all(['''
        if old_finally not in text:
            raise SystemExit(f"{path}: try block start not found")
        text = text.replace(old_finally, '''{\n  const [{ getBalanceRuleset }, { simulateGame }] = await Promise.all([''', 1)
        cleanup = '''} finally {\n  writeFileSync(gamePath, originalGameSource, "utf-8");\n  delete process.env.SIM_FORCED_AUGMENT_ID;\n  delete process.env.SIM_FORCED_ACQUISITION_INDEX;\n}\n'''
    else:
        old_finally = '''try {\n  const [{ AUGMENTS, AUGMENT_BY_ID }, { getBalanceRuleset }, { simulateGame }] = await Promise.all(['''
        if old_finally not in text:
            raise SystemExit(f"{path}: try block start not found")
        text = text.replace(old_finally, '''{\n  const [{ AUGMENTS, AUGMENT_BY_ID }, { getBalanceRuleset }, { simulateGame }] = await Promise.all([''', 1)
        cleanup = '''} finally {\n  writeFileSync(gamePath, originalGameSource, "utf-8");\n  delete process.env.SIM_FORCED_AUGMENT_ID;\n  delete process.env.SIM_FORCED_ACQUISITION_INDEX;\n}\n'''

    if cleanup not in text:
        raise SystemExit(f"{path}: cleanup block not found")
    text = text.replace(cleanup, '}\n', 1)

    forbidden = ['readFileSync', 'originalGameSource', 'SIM_FORCED_AUGMENT_ID', 'SIM_FORCED_ACQUISITION_INDEX']
    remaining = [item for item in forbidden if item in text]
    if remaining:
        raise SystemExit(f"{path}: source-mutation remnants remain: {remaining}")

    path.write_text(text, encoding="utf-8")


refactor_runner("scripts/precision-all-augment-run.ts", special=False)
refactor_runner("scripts/precision-special-run.ts", special=True)
print("Precision runners now use explicit simulation forcing options without mutating source files.")
