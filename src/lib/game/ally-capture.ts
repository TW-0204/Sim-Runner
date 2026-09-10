import {
  clearGroupMoveFixedToOne,
  clearJunctionBoostForGroup,
  clearPathControlForGroup,
} from "@/lib/augments/effects";
import { markAthleteDisqualified } from "./athlete";
import { captureReturnStatus } from "./capture-return";
import { applyStackChoice, currentPlayer } from "./engine";
import type { GameEngineState } from "./types";

export function applyLoneWolfAllyCapture(
  engineInput: GameEngineState,
  ownedIds: string[] = [],
): GameEngineState {
  if (!ownedIds.includes("P17")) throw new Error("독불장군 증강을 보유하고 있지 않습니다.");
  if (engineInput.stage !== "STACK_CHOICE" || !engineInput.pendingStackChoice) {
    throw new Error("지금은 아군 말을 잡을 수 없습니다.");
  }

  const engine = structuredClone(engineInput);
  const pending = engine.pendingStackChoice;
  if (!pending) throw new Error("아군 잡기 상태를 찾지 못했습니다.");

  const player = currentPlayer(engine);
  const alliedIds = new Set(pending.alliedGroupIds);
  const returnStatus = captureReturnStatus(ownedIds);
  let capturedGroups = 0;
  let capturedPieces = 0;

  for (const groupId of alliedIds) {
    const pieces = player.pieces.filter((piece) => (
      piece.groupId === groupId
      && piece.status === "ON_BOARD"
      && piece.node === pending.destination
    ));
    if (!pieces.length) continue;

    capturedGroups += 1;
    capturedPieces += pieces.length;
    clearGroupMoveFixedToOne(engine, player.userId, groupId);
    clearJunctionBoostForGroup(engine, player.userId, groupId);
    clearPathControlForGroup(engine, player.userId, groupId);
    for (const piece of pieces) {
      piece.status = returnStatus;
      piece.node = null;
      piece.groupId = piece.id;
    }
  }

  if (capturedGroups === 0) throw new Error("잡을 아군 묶음을 찾지 못했습니다.");

  markAthleteDisqualified(engine, player.userId, ownedIds);
  pending.augmentExtraRolls = (pending.augmentExtraRolls ?? 0) + 2;
  const next = applyStackChoice(engine, false, ownedIds);
  next.lastAction = `${player.displayName}: 독불장군 · 아군 ${capturedGroups}묶음(${capturedPieces}말)을 잡고 추가 던지기 +2`;
  return next;
}
