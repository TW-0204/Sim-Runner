export type PieceSetupPayload = {
  pieceId: string;
};

const PIECE_SETUP_AUGMENTS = new Set(["G16", "P14"]);

export function requiresPieceSetup(augmentId: string | null | undefined) {
  return Boolean(augmentId && PIECE_SETUP_AUGMENTS.has(augmentId));
}

export function pieceSetupOptions(seat: number) {
  return Array.from({ length: 4 }, (_, index) => ({
    pieceId: `${seat}-${index + 1}`,
    label: `말 ${index + 1}`,
  }));
}

export function isValidPieceSetup(seat: number, payload: unknown): payload is PieceSetupPayload {
  if (!payload || typeof payload !== "object") return false;
  const pieceId = (payload as { pieceId?: unknown }).pieceId;
  return typeof pieceId === "string" && pieceSetupOptions(seat).some((option) => option.pieceId === pieceId);
}
