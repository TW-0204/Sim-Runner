from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one occurrence in {path}, got {count}: {old[:220]!r}")
    write(path, text.replace(old, new, 1))


# P14 + A10: never pick a borrowed Betrayal piece as the designated runner.
# If the current runner is transferred, choose a remaining native piece.
replace_once(
    "src/lib/simulation/game.ts",
    '''function setupPieceId(player: GameEngineState["players"][number]) {
  const ranked = [...player.pieces].sort((left, right) => {
    const statusScore = (piece: PieceState) => piece.status === "FINISHED" ? 3 : piece.status === "ON_BOARD" ? 2 : piece.hasEntered ? 1 : 0;
    const statusDelta = statusScore(right) - statusScore(left);
    if (statusDelta !== 0) return statusDelta;
    const historyDelta = right.pathHistory.length - left.pathHistory.length;
    if (historyDelta !== 0) return historyDelta;
    return left.id.localeCompare(right.id);
  });
  return ranked[0]?.id ?? player.pieces[0]?.id;
}

function playerHasWaitingPiece(context: SimulationContext, userId: string) {
  return Boolean(context.engine.players.find((player) => player.userId === userId)?.pieces.some((piece) => piece.status === "WAITING"));
}

function repairTransferredSetup(context: SimulationContext, sourceUserId: string, transferredPieceId: string) {
  const setups = context.setupsByUser[sourceUserId];
  if (!setups) return;
  const source = context.engine.players.find((player) => player.userId === sourceUserId);
  const replacementId = source?.pieces[0]?.id;
  for (const augmentId of ["G16", "P14"] as const) {
    if (setups[augmentId]?.pieceId !== transferredPieceId) continue;
    if (replacementId) setups[augmentId] = { pieceId: replacementId };
    else delete setups[augmentId];
  }
}
''',
    '''function rankedSetupPiece(pieces: PieceState[]) {
  return [...pieces].sort((left, right) => {
    const statusScore = (piece: PieceState) => piece.status === "FINISHED" ? 3 : piece.status === "ON_BOARD" ? 2 : piece.hasEntered ? 1 : 0;
    const statusDelta = statusScore(right) - statusScore(left);
    if (statusDelta !== 0) return statusDelta;
    const historyDelta = right.pathHistory.length - left.pathHistory.length;
    if (historyDelta !== 0) return historyDelta;
    return left.id.localeCompare(right.id);
  })[0];
}

function setupPieceId(player: GameEngineState["players"][number], augmentId?: string) {
  const candidates = augmentId === "P14"
    ? player.pieces.filter((piece) => piece.betrayalOriginalOwnerUserId == null)
    : player.pieces;
  return rankedSetupPiece(candidates)?.id;
}

function playerHasWaitingPiece(context: SimulationContext, userId: string) {
  return Boolean(context.engine.players.find((player) => player.userId === userId)?.pieces.some((piece) => piece.status === "WAITING"));
}

function repairTransferredSetup(context: SimulationContext, sourceUserId: string, transferredPieceId: string) {
  const setups = context.setupsByUser[sourceUserId];
  if (!setups) return;
  const source = context.engine.players.find((player) => player.userId === sourceUserId);
  for (const augmentId of ["G16", "P14"] as const) {
    if (setups[augmentId]?.pieceId !== transferredPieceId) continue;

    if (augmentId === "P14") {
      const nativePieces = source?.pieces.filter((piece) => piece.betrayalOriginalOwnerUserId == null) ?? [];
      const nonFinished = nativePieces.filter((piece) => piece.status !== "FINISHED");
      const replacement = rankedSetupPiece(nonFinished.length > 0 ? nonFinished : nativePieces);
      if (!replacement) {
        delete setups[augmentId];
        continue;
      }
      if (replacement.status === "FINISHED") {
        replacement.status = "WAITING";
        replacement.node = null;
        replacement.groupId = replacement.id;
      }
      setups[augmentId] = { pieceId: replacement.id };
      continue;
    }

    const replacementId = source?.pieces[0]?.id;
    if (replacementId) setups[augmentId] = { pieceId: replacementId };
    else delete setups[augmentId];
  }
}
''',
)

replace_once(
    "src/lib/simulation/game.ts",
    '''      if (acquiredId === "G16" || acquiredId === "P14") {
        const pieceId = setupPieceId(player);
''',
    '''      if (acquiredId === "G16" || acquiredId === "P14") {
        const pieceId = setupPieceId(player, acquiredId);
''',
)

# P02 + A10: Moonwalk tracks the player's original four pieces, not borrowed pieces.
replace_once(
    "src/lib/game/passive-win.ts",
    '''export function passiveMoonwalkWinner(
  engine: GameEngineState,
  ownedByUser: Record<string, string[]>,
) {
  if (engine.winnerUserId) return null;
  for (const player of engine.players) {
    if (!(ownedByUser[player.userId] ?? []).includes("P02")) continue;
    if (!player.pieces.every((piece) => piece.status === "WAITING")) continue;
    return player;
  }
  return null;
}
''',
    '''export function isMoonwalkHome(engine: GameEngineState, userId: string) {
  const originalPieces = engine.players.flatMap((player) => player.pieces).filter((piece) => (
    piece.betrayalOriginalOwnerUserId === userId
    || (piece.ownerUserId === userId && piece.betrayalOriginalOwnerUserId == null)
  ));
  return originalPieces.length === 4 && originalPieces.every((piece) => (
    piece.ownerUserId === userId && piece.status === "WAITING"
  ));
}

export function passiveMoonwalkWinner(
  engine: GameEngineState,
  ownedByUser: Record<string, string[]>,
) {
  if (engine.winnerUserId) return null;
  for (const player of engine.players) {
    if (!(ownedByUser[player.userId] ?? []).includes("P02")) continue;
    if (!isMoonwalkHome(engine, player.userId)) continue;
    return player;
  }
  return null;
}
''',
)

replace_once(
    "src/lib/game/engine.ts",
    '''import { returnPiecesAfterEnemyCapture } from "./capture-return";
import { baseStepsForFace, faceLabel } from "./roll";
''',
    '''import { returnPiecesAfterEnemyCapture } from "./capture-return";
import { isMoonwalkHome } from "./passive-win";
import { baseStepsForFace, faceLabel } from "./roll";
''',
)

replace_once(
    "src/lib/game/engine.ts",
    '''  if (ownedIds.includes("P02") && player.pieces.every((piece) => piece.status === "WAITING")) {
''',
    '''  if (ownedIds.includes("P02") && isMoonwalkHome(engine, player.userId)) {
''',
)

# Re-check passive Moonwalk after every simulation transition.
replace_once(
    "src/lib/simulation/game.ts",
    '''  context.engine = after;
}

function applyDueAugmentEvents(context: SimulationContext) {
''',
    '''  context.engine = applyPassiveSpecialWinner(after, context.ownedByUser);
}

function applyDueAugmentEvents(context: SimulationContext) {
''',
)

# P14 lap can make an already-rolled BACKDO unusable; reuse the normal cleanup.
replace_once(
    "src/lib/game/engine.ts",
    '''  if (finished) {
    const soloResult = moonwalk ? null : resolveSoloLap(engine, group, ownedIds, setups);
    if (soloResult === "WIN") return engine;
    if (!soloResult) engine.lastAction = `${mover.displayName}의 말 ${group.length}개가 완주했습니다.${pathMessage}${cleanerText}`;
    finishResolvedMove(engine, captures.captureExtraRollCount, 0, ownedIds);
    return engine;
  }
''',
    '''  if (finished) {
    const soloResult = moonwalk ? null : resolveSoloLap(engine, group, ownedIds, setups);
    if (soloResult === "WIN") return engine;
    if (soloResult === "LAP") discardUnusableResults(engine, ownedIds, setups);
    if (!soloResult) engine.lastAction = `${mover.displayName}의 말 ${group.length}개가 완주했습니다.${pathMessage}${cleanerText}`;
    finishResolvedMove(engine, captures.captureExtraRollCount, 0, ownedIds);
    return engine;
  }
''',
)

print("Applied stall fixes v11: P14 betrayal setup/runner repair, post-lap BACKDO cleanup, and P02 original-piece Moonwalk semantics.")
