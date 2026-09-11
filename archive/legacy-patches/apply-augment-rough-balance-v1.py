from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:240]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# A10 배반 rough balance v1
# - Ownership transfer remains real: source temporarily has 3 pieces and recipient has 5.
# - The transferred piece remembers its original owner.
# - When that piece reaches FINISHED under its temporary owner, it immediately returns
#   to the original owner's WAITING pool instead of staying FINISHED for the recipient.
replace_once(
    "src/lib/augments/catalog.ts",
    '''  { id: "A10", name: "배반", tier: "gold", description: "자신의 대기 중인 말 1기를 무작위 상대 플레이어의 소유로 변경합니다." },\n''',
    '''  { id: "A10", name: "배반", tier: "gold", description: "자신의 대기 중인 말 1기를 무작위 상대 플레이어의 소유로 변경합니다. 배반한 말이 새 주인 쪽에서 완주하면 원래 주인의 대기 상태로 돌아갑니다." },\n''',
)

replace_once(
    "src/lib/game/types.ts",
    '''  pathHistory: number[];\n};\n\nexport type EnginePlayer = {\n''',
    '''  pathHistory: number[];\n  betrayalOriginalOwnerUserId?: string;\n};\n\nexport type EnginePlayer = {\n''',
)

replace_once(
    "src/lib/augments/effects.ts",
    '''  transferred.hasEntered = false;\n  transferred.pathHistory = [];\n  recipient.pieces.push(transferred);\n''',
    '''  transferred.hasEntered = false;\n  transferred.pathHistory = [];\n  transferred.betrayalOriginalOwnerUserId ??= source.userId;\n  recipient.pieces.push(transferred);\n''',
)

replace_once(
    "src/lib/game/engine.ts",
    '''function allPieces(engine: GameEngineState) {\n  return engine.players.flatMap((player) => player.pieces);\n}\n\nfunction hasUsableOnBoardGroup(\n''',
    '''function allPieces(engine: GameEngineState) {\n  return engine.players.flatMap((player) => player.pieces);\n}\n\nfunction returnFinishedBetrayals(engine: GameEngineState) {\n  const returns = engine.players.flatMap((holder) => holder.pieces\n    .filter((piece) => (\n      piece.status === "FINISHED"\n      && piece.betrayalOriginalOwnerUserId != null\n      && piece.betrayalOriginalOwnerUserId !== holder.userId\n    ))\n    .map((piece) => ({\n      holderUserId: holder.userId,\n      pieceId: piece.id,\n      originalOwnerUserId: piece.betrayalOriginalOwnerUserId!,\n    })));\n\n  let returned = 0;\n  for (const item of returns) {\n    const holder = engine.players.find((player) => player.userId === item.holderUserId);\n    const originalOwner = engine.players.find((player) => player.userId === item.originalOwnerUserId);\n    if (!holder || !originalOwner) throw new Error("배반 말 반환에 필요한 플레이어를 찾지 못했습니다.");\n    const index = holder.pieces.findIndex((piece) => piece.id === item.pieceId);\n    if (index < 0) continue;\n    const [piece] = holder.pieces.splice(index, 1);\n    if (!piece) continue;\n\n    // Finishing clears temporary per-holder piece states before control is returned.\n    for (const runtime of Object.values(engine.augmentRuntime ?? {})) {\n      if (runtime.plaguePieceIds) delete runtime.plaguePieceIds[piece.id];\n      if (runtime.turtleLockedUntilRoundByPiece) delete runtime.turtleLockedUntilRoundByPiece[piece.id];\n      if (runtime.marginOriginByPiece) delete runtime.marginOriginByPiece[piece.id];\n    }\n\n    piece.ownerUserId = originalOwner.userId;\n    piece.seat = originalOwner.seat;\n    piece.status = "WAITING";\n    piece.node = null;\n    piece.groupId = piece.id;\n    piece.hasEntered = false;\n    piece.pathHistory = [];\n    delete piece.betrayalOriginalOwnerUserId;\n    originalOwner.pieces.push(piece);\n    returned += 1;\n  }\n\n  return returned;\n}\n\nfunction hasUsableOnBoardGroup(\n''',
)

replace_once(
    "src/lib/game/engine.ts",
    '''function finishResolvedMove(engine: GameEngineState, captureExtraRollCount: number, augmentExtraRolls = 0, ownedIds: string[] = []) {\n  if (checkSpecialWinner(engine, ownedIds)) return;\n''',
    '''function finishResolvedMove(engine: GameEngineState, captureExtraRollCount: number, augmentExtraRolls = 0, ownedIds: string[] = []) {\n  const betrayalReturns = returnFinishedBetrayals(engine);\n  if (betrayalReturns > 0) engine.lastAction += ` · 배반 말 ${betrayalReturns}개가 원래 주인의 대기로 돌아갔습니다.`;\n  if (checkSpecialWinner(engine, ownedIds)) return;\n''',
)

# A08 can set pieces directly to FINISHED without going through finishResolvedMove.
# Normalize completed betrayal pieces before its immediate normal-win scan too.
replace_once(
    "src/lib/game/engine.ts",
    '''  // The reshuffle can itself complete a normal win. If more than one player completes\n  // simultaneously, the A08 owner takes priority, then normal seat order.\n''',
    '''  returnFinishedBetrayals(engine);\n\n  // The reshuffle can itself complete a normal win. If more than one player completes\n  // simultaneously, the A08 owner takes priority, then normal seat order.\n''',
)


# A14 역병 rough balance v1: forward movement penalty -2 -> -3.
replace_once(
    "src/lib/augments/catalog.ts",
    '''  { id: "A14", name: "역병", tier: "gold", description: "자신의 말은 상대를 잡는 대신 감염시킵니다. 감염된 말은 전진 이동량이 -2칸 감소하며, 보정 후 0 이하가 되면 대기로 돌아갑니다." },\n''',
    '''  { id: "A14", name: "역병", tier: "gold", description: "자신의 말은 상대를 잡는 대신 감염시킵니다. 감염된 말은 전진 이동량이 -3칸 감소하며, 보정 후 0 이하가 되면 대기로 돌아갑니다." },\n''',
)

replace_once(
    "src/lib/augments/effects.ts",
    '''  const plaguePenalty = result.face === "BACKDO" || !isPlagueGroup(engine, userId, groupId) ? 0 : 2;\n''',
    '''  const plaguePenalty = result.face === "BACKDO" || !isPlagueGroup(engine, userId, groupId) ? 0 : 3;\n''',
)

print("Applied augment rough balance v1: A10 Betrayal finish-return and A14 Plague -3.")
