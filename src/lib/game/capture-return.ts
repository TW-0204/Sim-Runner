import type { PieceState, PieceStatus } from "./types";

export function captureReturnStatus(ownedIds: string[]): PieceStatus {
  return ownedIds.includes("AUG-031") ? "FINISHED" : "WAITING";
}

export function enemyCaptureReturnStatus(ownedIds: string[]): PieceStatus {
  return captureReturnStatus(ownedIds);
}

export function returnPiecesAfterEnemyCapture(pieces: PieceState[], ownedIds: string[]) {
  const status = captureReturnStatus(ownedIds);
  for (const piece of pieces) {
    piece.status = status;
    piece.node = null;
    piece.groupId = piece.id;
  }
}
