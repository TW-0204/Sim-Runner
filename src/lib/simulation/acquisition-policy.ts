import { AUGMENT_BY_ID } from "@/lib/augments/catalog";
import { getAugmentRuntime } from "@/lib/augments/runtime-registry";
import type { PlayerAugmentSetups } from "@/lib/augments/effects";
import { applyBetrayalTransfer } from "@/lib/augments/effects";
import { applyTurtleAndHarePlacement } from "@/lib/game/engine";
import type { GameEngineState, PieceState } from "@/lib/game/types";
import { resolveCandidateActions, type CandidateAction } from "./candidate-action";

export type AcquisitionDecision = {
  selectedId: string;
  pieceId?: string;
  score: number;
};

type AcquisitionState = {
  engine: GameEngineState;
  ownedByUser: Record<string, string[]>;
  setupsByUser: Record<string, PlayerAugmentSetups>;
};

type AcquisitionPolicyInput = {
  engine: GameEngineState;
  userId: string;
  selectionPool: string[];
  fallbackSelectedId: string;
  forcedSelectedId?: string;
  ownedByUser: Record<string, string[]>;
  setupsByUser: Record<string, PlayerAugmentSetups>;
  scoreState: (
    engine: GameEngineState,
    userId: string,
    ownedByUser: Record<string, string[]>,
    setupsByUser: Record<string, PlayerAugmentSetups>,
  ) => number;
};

function upgradeOwnedList(existing: string[], selectedId: string) {
  const selected = AUGMENT_BY_ID.get(selectedId);
  if (!selected?.family) return existing.includes(selectedId) ? existing : [...existing, selectedId];
  return [...existing.filter((id) => AUGMENT_BY_ID.get(id)?.family !== selected.family), selectedId];
}

function setupFallbackScore(piece: PieceState) {
  if (piece.status === "ON_BOARD") return 2_000 + piece.pathHistory.length * 100;
  if (piece.status === "FINISHED") return 1_200 + piece.pathHistory.length * 20;
  if (piece.hasEntered) return 600;
  return 100;
}

function setupEligiblePieces(engine: GameEngineState, userId: string, augmentId: string) {
  const player = engine.players.find((candidate) => candidate.userId === userId);
  const setup = getAugmentRuntime(augmentId)?.setup;
  if (!player || setup?.kind !== "piece") return [];
  const eligible = setup.allowBorrowed
    ? player.pieces
    : player.pieces.filter((piece) => piece.betrayalOriginalOwnerUserId == null);
  const nonFinished = eligible.filter((piece) => piece.status !== "FINISHED");
  return setup.preferNonFinished && nonFinished.length > 0 ? nonFinished : eligible;
}

function waitingPieces(engine: GameEngineState, userId: string) {
  return engine.players.find((player) => player.userId === userId)?.pieces
    .filter((piece) => piece.status === "WAITING") ?? [];
}

function previewBetrayal(
  engine: GameEngineState,
  userId: string,
  pieceId: string,
) {
  const waiting = waitingPieces(engine, userId);
  const index = waiting.findIndex((piece) => piece.id === pieceId);
  if (index < 0) throw new Error("Betrayal candidate is not waiting.");
  let call = 0;
  const random = () => {
    call += 1;
    if (call === 1) return Math.min(0.999999999999, (index + 0.5) / waiting.length);
    return 0;
  };
  return applyBetrayalTransfer(engine, userId, random).engine;
}

function candidateState(
  input: AcquisitionPolicyInput,
  selectedId: string,
  pieceId?: string,
): AcquisitionState {
  const engine = structuredClone(input.engine);
  const ownedByUser = structuredClone(input.ownedByUser);
  const setupsByUser = structuredClone(input.setupsByUser);
  ownedByUser[input.userId] = upgradeOwnedList(ownedByUser[input.userId] ?? [], selectedId);

  if (pieceId && getAugmentRuntime(selectedId)?.setup?.kind === "piece") {
    setupsByUser[input.userId] ??= {};
    setupsByUser[input.userId][selectedId] = { pieceId };
  }

  if (selectedId === "AUG-058" && pieceId) {
    return {
      engine: applyTurtleAndHarePlacement(engine, input.userId, pieceId),
      ownedByUser,
      setupsByUser,
    };
  }

  if (selectedId === "AUG-053" && pieceId) {
    return {
      engine: previewBetrayal(engine, input.userId, pieceId),
      ownedByUser,
      setupsByUser,
    };
  }

  return { engine, ownedByUser, setupsByUser };
}

function chooseSetupPiece(input: AcquisitionPolicyInput, augmentId: string) {
  const pieces = setupEligiblePieces(input.engine, input.userId, augmentId);
  const candidates: CandidateAction<{ pieceId: string; score: number }>[] = pieces.map((piece) => ({
    key: `acquire:${augmentId}:setup:${piece.id}`,
    action: "acquire_setup_piece",
    augmentId,
    payload: { pieceId: piece.id },
    execute: () => {
      const state = candidateState(input, augmentId, piece.id);
      return {
        pieceId: piece.id,
        score: input.scoreState(state.engine, input.userId, state.ownedByUser, state.setupsByUser)
          + setupFallbackScore(piece),
      };
    },
  }));
  return resolveCandidateActions(candidates, { scoreState: (state) => state.score })?.state.pieceId;
}

function chooseEffectPiece(input: AcquisitionPolicyInput, augmentId: "AUG-053" | "AUG-058") {
  const candidates: CandidateAction<{ pieceId: string; score: number }>[] = waitingPieces(input.engine, input.userId)
    .map((piece) => ({
      key: `acquire:${augmentId}:piece:${piece.id}`,
      action: "acquire_effect_piece",
      augmentId,
      payload: { pieceId: piece.id },
      execute: () => {
        const state = candidateState(input, augmentId, piece.id);
        return {
          pieceId: piece.id,
          score: input.scoreState(state.engine, input.userId, state.ownedByUser, state.setupsByUser),
        };
      },
    }));
  return resolveCandidateActions(candidates, { scoreState: (state) => state.score })?.state.pieceId;
}

function selectedPieceFor(input: AcquisitionPolicyInput, augmentId: string) {
  if (getAugmentRuntime(augmentId)?.setup?.kind === "piece") return chooseSetupPiece(input, augmentId);
  if (augmentId === "AUG-053" || augmentId === "AUG-058") return chooseEffectPiece(input, augmentId);
  return undefined;
}

export function resolveAugmentAcquisition(input: AcquisitionPolicyInput): AcquisitionDecision {
  const allowed = input.forcedSelectedId
    ? [input.forcedSelectedId]
    : input.selectionPool;
  const unique = [...new Set(allowed)];
  if (!unique.length) throw new Error("No augment acquisition CandidateAction.");

  const candidates: CandidateAction<AcquisitionDecision>[] = unique.map((selectedId) => ({
    key: `acquire-card:${selectedId === input.fallbackSelectedId ? "00" : "01"}:${selectedId}`,
    action: "choose_augment",
    augmentId: selectedId,
    payload: { selectedId },
    execute: () => {
      const pieceId = selectedPieceFor(input, selectedId);
      const state = candidateState(input, selectedId, pieceId);
      return {
        selectedId,
        pieceId,
        score: input.scoreState(state.engine, input.userId, state.ownedByUser, state.setupsByUser),
      };
    },
  }));

  const resolved = resolveCandidateActions(candidates, { scoreState: (state) => state.score });
  if (!resolved) throw new Error("No valid augment acquisition CandidateAction.");
  return resolved.state;
}
