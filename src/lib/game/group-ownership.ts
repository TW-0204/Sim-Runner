import type { GameEngineState, PieceState, PlayerAugmentRuntime } from "./types";

function stableGroupRoot(pieces: PieceState[]) {
  return [...pieces].sort((left, right) => {
    const borrowedDelta = Number(left.betrayalOriginalOwnerUserId != null) - Number(right.betrayalOriginalOwnerUserId != null);
    if (borrowedDelta !== 0) return borrowedDelta;
    return left.id.localeCompare(right.id);
  })[0]?.id;
}

function moveRuntimeKey<T>(
  record: Record<string, T> | undefined,
  oldGroupId: string,
  newGroupId: string,
) {
  if (!record || oldGroupId === newGroupId || !Object.prototype.hasOwnProperty.call(record, oldGroupId)) return;
  const value = record[oldGroupId];
  delete record[oldGroupId];
  if (value !== undefined) record[newGroupId] = value;
}

function rehomeRuntimeGroupKeys(
  runtime: PlayerAugmentRuntime | undefined,
  oldGroupId: string,
  newGroupId: string,
) {
  if (!runtime || oldGroupId === newGroupId) return;

  moveRuntimeKey(runtime.fixedOneGroups, oldGroupId, newGroupId);
  moveRuntimeKey(runtime.junctionBoostGroups, oldGroupId, newGroupId);
  moveRuntimeKey(runtime.sanctuaryGroups, oldGroupId, newGroupId);
  moveRuntimeKey(runtime.sanctuaryPassBlocks, oldGroupId, newGroupId);
  moveRuntimeKey(runtime.alleyBlockades, oldGroupId, newGroupId);
  moveRuntimeKey(runtime.universeCenterGroups, oldGroupId, newGroupId);
  moveRuntimeKey(runtime.wormholeTransit, oldGroupId, newGroupId);

  if (runtime.athleteAcceleratingGroupId === oldGroupId) {
    runtime.athleteAcceleratingGroupId = newGroupId;
  }
}

/**
 * Re-roots a surviving group when the piece whose id was used as groupId leaves the
 * player's container. Native pieces are preferred as the new root so a borrowed AUG-053
 * piece cannot keep the group dependent on another future ownership transfer.
 */
export function rehomeGroupAfterPieceRemoval(
  engine: GameEngineState,
  holderUserId: string,
  removedPieceId: string,
  oldGroupId: string,
) {
  if (oldGroupId !== removedPieceId) return null;
  const holder = engine.players.find((player) => player.userId === holderUserId);
  if (!holder) return null;

  const survivors = holder.pieces.filter((piece) => (
    piece.id !== removedPieceId && piece.groupId === oldGroupId
  ));
  const newGroupId = stableGroupRoot(survivors);
  if (!newGroupId) return null;

  for (const piece of survivors) piece.groupId = newGroupId;
  rehomeRuntimeGroupKeys(engine.augmentRuntime?.[holderUserId], oldGroupId, newGroupId);
  return newGroupId;
}
