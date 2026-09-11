from pathlib import Path

path = Path("src/lib/game/engine.ts")
text = path.read_text(encoding="utf-8")

old_import = 'import { returnPiecesAfterEnemyCapture } from "./capture-return";\nimport { isMoonwalkHome } from "./passive-win";'
new_import = 'import { returnPiecesAfterEnemyCapture } from "./capture-return";\nimport { rehomeGroupAfterPieceRemoval } from "./group-ownership";\nimport { isMoonwalkHome } from "./passive-win";'
if old_import not in text:
    raise SystemExit("engine import anchor not found")
text = text.replace(old_import, new_import, 1)

old_block = '''    const index = holder.pieces.findIndex((piece) => piece.id === item.pieceId);\n    if (index < 0) continue;\n    const [piece] = holder.pieces.splice(index, 1);\n    if (!piece) continue;\n'''
new_block = '''    const index = holder.pieces.findIndex((piece) => piece.id === item.pieceId);\n    if (index < 0) continue;\n    const departing = holder.pieces[index];\n    if (!departing) continue;\n    rehomeGroupAfterPieceRemoval(engine, holder.userId, departing.id, departing.groupId);\n    const [piece] = holder.pieces.splice(index, 1);\n    if (!piece) continue;\n'''
if old_block not in text:
    raise SystemExit("betrayal return anchor not found")
text = text.replace(old_block, new_block, 1)

path.write_text(text, encoding="utf-8")
