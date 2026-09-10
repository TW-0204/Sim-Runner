import { isGroupUsableWithAugments, type PlayerAugmentSetups } from "@/lib/augments/effects";
import type { GameEngineState } from "./types";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function currentPlayer(engine: GameEngineState) {
  const player = engine.players.find((candidate) => candidate.seat === engine.currentSeat);
  if (!player) throw new Error("Current player is missing.");
  return player;
}

function advanceTurn(engine: GameEngineState) {
  if (engine.winnerUserId) return;
  const seats = engine.players.map((player) => player.seat).sort((a, b) => a - b);
  const index = seats.indexOf(engine.currentSeat);
  const nextIndex = (index + 1) % seats.length;
  if (nextIndex === 0) engine.round += 1;
  engine.turnNumber += 1;
  engine.currentSeat = seats[nextIndex];
  engine.stage = "AWAITING_ROLL";
  engine.pendingRolls = ["BASIC"];
  engine.results = [];
  engine.pendingRollChoice = null;
  engine.pendingSplitChoice = null;
  engine.pendingCaptureChoice = null;
  engine.pendingRelocationChoice = null;
  engine.pendingStackChoice = null;
  engine.lastAction = `${currentPlayer(engine).displayName}의 턴입니다.`;
}

function discardUnusableBackdos(
  engine: GameEngineState,
  ownedIds: string[] = [],
  setups: PlayerAugmentSetups = {},
) {
  const player = currentPlayer(engine);
  const usableOnBoard = player.pieces.some((piece) => (
    piece.status === "ON_BOARD"
    && isGroupUsableWithAugments(engine, player.userId, piece.groupId, ownedIds, setups)
  ));
  if (usableOnBoard) return;
  if (engine.results.some((result) => result.face !== "BACKDO")) return;
  const before = engine.results.length;
  engine.results = engine.results.filter((result) => result.face !== "BACKDO");
  if (engine.results.length !== before) {
    engine.lastAction = "현재 움직일 수 있는 말이 없어 백도가 소멸했습니다.";
  }
}

/**
 * Roll-choice helpers such as S12 can create a result without going through
 * engine.applyRoll's normal settle path. Keep those paths consistent with the
 * authoritative engine: finish pending rolls first, discard an all-BACKDO pool
 * when no piece is on board, then either enter MOVING or advance the turn.
 */
export function settleAfterRollResolution(
  engineInput: GameEngineState,
  ownedIds: string[] = [],
  setups: PlayerAugmentSetups = {},
) {
  const engine = clone(engineInput);
  if (engine.winnerUserId) return engine;
  if (engine.pendingRolls.length > 0) {
    engine.stage = "AWAITING_ROLL";
    return engine;
  }

  discardUnusableBackdos(engine, ownedIds, setups);
  if (engine.results.length > 0) {
    engine.stage = "MOVING";
    return engine;
  }

  advanceTurn(engine);
  return engine;
}

/**
 * Result-pool normalizers may remove a result after another action has already
 * settled. If MOVING is left with no result and no queued roll, the turn must
 * advance instead of leaving an empty MOVING deadlock.
 */
export function settleAfterResultPoolChange(engineInput: GameEngineState) {
  const engine = clone(engineInput);
  if (
    engine.winnerUserId
    || engine.stage !== "MOVING"
    || engine.pendingRolls.length > 0
    || engine.results.length > 0
  ) {
    return engine;
  }

  advanceTurn(engine);
  return engine;
}
