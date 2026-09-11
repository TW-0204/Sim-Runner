from pathlib import Path

path = Path("src/lib/simulation/game.ts")
text = path.read_text(encoding="utf-8")

anchor = 'import { applyAugmentAcquisitionLifecycle } from "@/lib/game/augment-lifecycle";\n'
insert = '''import { applyAugmentAcquisitionLifecycle } from "@/lib/game/augment-lifecycle";\nimport {\n  executeGrandUnityAction,\n  executeMoveAction,\n  executeRelocationAction,\n  executeStackAction,\n  finalizeAction,\n  type GameMoveArgs,\n} from "@/lib/game/action-lifecycle";\n'''
if anchor not in text:
    raise SystemExit("action lifecycle import anchor not found")
text = text.replace(anchor, insert, 1)

old_athlete = '''import {\n  markAthleteDisqualified,\n  markAthleteMovement,\n  maybeGrantAthleteExtraRoll,\n  moveOwnedIdsForAthlete,\n  prepareAthleteCoexistence,\n} from "@/lib/game/athlete";\n'''
new_athlete = 'import { moveOwnedIdsForAthlete } from "@/lib/game/athlete";\n'
if old_athlete not in text:
    raise SystemExit("athlete import block not found")
text = text.replace(old_athlete, new_athlete, 1)

old_capture = 'import { applyCaptureChoice, maybePauseCaptureChoices } from "@/lib/game/capture-choice";'
new_capture = 'import { applyCaptureChoice } from "@/lib/game/capture-choice";'
if old_capture not in text:
    raise SystemExit("capture import not found")
text = text.replace(old_capture, new_capture, 1)

for line in [
    '  applyGrandUnity,\n',
    '  applyMove,\n',
    '  applyRelocationChoice,\n',
    '  applyStackChoice,\n',
]:
    if line not in text:
        raise SystemExit(f"engine import line not found: {line.strip()}")
    text = text.replace(line, '', 1)

old_numbers = '''import {\n  allocateNumberPool,\n  markNumberSplitSibling,\n  normalizeNumberPool,\n  splitNumberResult,\n} from "@/lib/game/number-cells";'''
new_numbers = '''import {\n  allocateNumberPool,\n  normalizeNumberPool,\n  splitNumberResult,\n} from "@/lib/game/number-cells";'''
if old_numbers not in text:
    raise SystemExit("number-cells import block not found")
text = text.replace(old_numbers, new_numbers, 1)

old_self = 'import { applySelfRelianceSplit, maybePauseSelfRelianceAfterMovement } from "@/lib/game/self-reliance";'
new_self = 'import { applySelfRelianceSplit } from "@/lib/game/self-reliance";'
if old_self not in text:
    raise SystemExit("self-reliance import not found")
text = text.replace(old_self, new_self, 1)

old_type = 'type MoveArgs = Parameters<typeof applyMove>[1];'
new_type = 'type MoveArgs = GameMoveArgs;'
if old_type not in text:
    raise SystemExit("MoveArgs alias not found")
text = text.replace(old_type, new_type, 1)

start = text.find('function finalizeAction(\n')
end = text.find('function playerPositionScore(', start)
if start < 0 or end < 0:
    raise SystemExit("local action lifecycle block not found")
text = text[:start] + text[end:]

path.write_text(text, encoding="utf-8")
