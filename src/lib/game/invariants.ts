import type { PlayerAugmentSetups } from "@/lib/augments/effects";
import { augmentSetupProblems } from "@/lib/augments/setup";
import type { GameEngineState, PieceState, TurnStage } from "./types";

type InvariantContext = {
  ownedByUser?: Record<string, string[]>;
  setupsByUser?: Record<string, PlayerAugmentSetups>;
  label?: string;
};

const SPECIAL_WIN_AUGMENT: Partial<Record<NonNullable<GameEngineState["winnerCondition"]>, string>> = {
  SOLO_RUN: "P14",
  FOUR_GUARDIANS: "P03",
  CENTER_STACK: "P04",
  HUNT: "P16",
  MOONWALK: "P02",
};

function invariantError(message: string, label?: string): never {
  throw new Error(`[game invariant${label ? `:${label}` : ""}] ${message}`);
}

function assertStageChoice(
  stage: TurnStage,
  expectedStage: TurnStage,
  value: unknown,
  name: string,
  label?: string,
) {
  if (stage === expectedStage && value == null) {
    invariantError(`${expectedStage} requires ${name}.`, label);
  }
  if (stage !== expectedStage && value != null) {
    invariantError(`${name} is set while stage is ${stage}.`, label);
  }
}

function assertPieceState(piece: PieceState, label?: string) {
  if (piece.status === "ON_BOARD") {
    if (piece.node == null) invariantError(`${piece.id} is ON_BOARD without a node.`, label);
  } else if (piece.node != null) {
    invariantError(`${piece.id} is ${piece.status} but still has node ${piece.node}.`, label);
  }
}

export function assertGameStateInvariants(
  engine: GameEngineState,
  context: InvariantContext = {},
) {
  const { ownedByUser, setupsByUser, label } = context;
  const userIds = new Set<string>();
  const seats = new Set<number>();
  const pieceIds = new Set<string>();

  for (const player of engine.players) {
    if (userIds.has(player.userId)) invariantError(`duplicate player userId ${player.userId}.`, label);
    if (seats.has(player.seat)) invariantError(`duplicate player seat ${player.seat}.`, label);
    userIds.add(player.userId);
    seats.add(player.seat);

    const playerPieceIds = new Set(player.pieces.map((piece) => piece.id));
    for (const piece of player.pieces) {
      if (pieceIds.has(piece.id)) invariantError(`piece ${piece.id} exists in more than one player container.`, label);
      pieceIds.add(piece.id);
      if (piece.ownerUserId !== player.userId) {
        invariantError(`piece ${piece.id} ownerUserId=${piece.ownerUserId} but container=${player.userId}.`, label);
      }
      if (piece.seat !== player.seat) {
        invariantError(`piece ${piece.id} seat=${piece.seat} but container seat=${player.seat}.`, label);
      }
      if (!playerPieceIds.has(piece.groupId)) {
        invariantError(`piece ${piece.id} has dangling groupId ${piece.groupId}.`, label);
      }
      if (piece.betrayalOriginalOwnerUserId != null) {
        if (!userIds.has(piece.betrayalOriginalOwnerUserId)
          && !engine.players.some((candidate) => candidate.userId === piece.betrayalOriginalOwnerUserId)) {
          invariantError(`piece ${piece.id} references missing betrayal original owner ${piece.betrayalOriginalOwnerUserId}.`, label);
        }
        if (piece.betrayalOriginalOwnerUserId === piece.ownerUserId) {
          invariantError(`piece ${piece.id} has identical current and betrayal original owner.`, label);
        }
      }
      assertPieceState(piece, label);
    }
  }

  if (!seats.has(engine.currentSeat)) invariantError(`currentSeat ${engine.currentSeat} has no player.`, label);

  assertStageChoice(engine.stage, "ROLL_CHOICE", engine.pendingRollChoice, "pendingRollChoice", label);
  assertStageChoice(engine.stage, "SPLIT_CHOICE", engine.pendingSplitChoice, "pendingSplitChoice", label);
  assertStageChoice(engine.stage, "CAPTURE_CHOICE", engine.pendingCaptureChoice, "pendingCaptureChoice", label);
  assertStageChoice(engine.stage, "RELOCATION_CHOICE", engine.pendingRelocationChoice, "pendingRelocationChoice", label);
  assertStageChoice(engine.stage, "STACK_CHOICE", engine.pendingStackChoice, "pendingStackChoice", label);

  if (engine.winnerUserId != null) {
    if (!userIds.has(engine.winnerUserId)) invariantError(`winner ${engine.winnerUserId} is not a player.`, label);
    if (engine.stage !== "FINISHED") invariantError(`winner exists while stage=${engine.stage}.`, label);
    if (engine.pendingRolls.length) invariantError("finished game still has pendingRolls.", label);
    if (engine.results.length) invariantError("finished game still has movement results.", label);
    if (engine.pendingRollChoice || engine.pendingSplitChoice || engine.pendingCaptureChoice
      || engine.pendingRelocationChoice || engine.pendingStackChoice) {
      invariantError("finished game still has a pending choice.", label);
    }
    const requiredAugment = engine.winnerCondition ? SPECIAL_WIN_AUGMENT[engine.winnerCondition] : undefined;
    if (requiredAugment && ownedByUser && !(ownedByUser[engine.winnerUserId] ?? []).includes(requiredAugment)) {
      invariantError(`${engine.winnerCondition} winner does not own ${requiredAugment}.`, label);
    }
  } else if (engine.stage === "FINISHED") {
    invariantError("stage is FINISHED without a winner.", label);
  }

  for (const problem of augmentSetupProblems(engine, ownedByUser, setupsByUser)) {
    invariantError(problem, label);
  }

  return true;
}
