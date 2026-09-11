import {
  applyWaterGhostOne,
  betrayalCaptureBonusRoll,
  blocksCaptureExtraRoll,
  clearGroupMoveFixedToOne,
  clearJunctionBoostForGroup,
  clearPathControlForGroup,
  clearPlagueForGroup,
  clearTurtleLockForGroup,
  infectPlagueGroup,
  infectPlaguePieceIds,
  isCaptureImmune,
  isPlagueGroup,
  isSanctuaryGroup,
  recordCaptureAgainstPlayer,
  recordEnemyCaptures,
  resetAthleteAccelerationForGroup,
  shouldReturnAttackerWithWaterGhostTwo,
  specialWinForPlayer,
} from "@/lib/augments/effects";
import { backwardTargets, FINISH_NODE, forwardMoveOptions, reverseMoveOptions } from "./board";
import { enemyCaptureReturnStatus, returnPiecesAfterEnemyCapture } from "./capture-return";
import { applyPassiveSpecialWinner } from "./passive-win";
import type {
  CaptureDecision,
  CaptureTarget,
  GameEngineState,
  PendingCaptureChoice,
  PieceState,
  RollToken,
} from "./types";

function playerFor(engine: GameEngineState, userId: string) {
  return engine.players.find((player) => player.userId === userId) ?? null;
}

function groupAt(player: { pieces: PieceState[] }, groupId: string, node?: number) {
  return player.pieces.filter((piece) => (
    piece.groupId === groupId
    && piece.status === "ON_BOARD"
    && (node == null || piece.node === node)
  ));
}

function groupedOpponentsAt(engine: GameEngineState, attackerUserId: string, node: number) {
  const groups = new Map<string, PieceState[]>();
  for (const player of engine.players) {
    if (player.userId === attackerUserId) continue;
    for (const piece of player.pieces) {
      if (piece.status !== "ON_BOARD" || piece.node !== node) continue;
      const key = `${player.userId}:${piece.groupId}`;
      const list = groups.get(key) ?? [];
      list.push(piece);
      groups.set(key, list);
    }
  }
  return [...groups.entries()].map(([key, pieces]) => ({ key, pieces }));
}

function movedPath(
  before: GameEngineState,
  after: GameEngineState,
  attackerUserId: string,
  attackerGroupId: string,
) {
  const beforePlayer = playerFor(before, attackerUserId);
  const afterPlayer = playerFor(after, attackerUserId);
  const beforePiece = beforePlayer?.pieces.find((piece) => piece.groupId === attackerGroupId);
  if (!beforePiece || !afterPlayer) return null;
  const afterPiece = afterPlayer.pieces.find((piece) => piece.id === beforePiece.id);
  if (!afterPiece) return null;
  const path = afterPiece.pathHistory.slice(beforePiece.pathHistory.length);
  if (!path.length) return null;
  const startNode = beforePiece.status === "FINISHED"
    ? FINISH_NODE
    : beforePiece.status === "WAITING" ? 0 : (beforePiece.node ?? 0);
  return { startNode, path, physicalPieceId: beforePiece.id };
}

function resultBeforeMove(before: GameEngineState, resultId: string) {
  return before.results.find((result) => result.id === resultId) ?? null;
}

function wasCaptured(
  after: GameEngineState,
  pieces: PieceState[],
  ownedByUser: Record<string, string[]>,
) {
  const ownerUserId = pieces[0]?.ownerUserId ?? "";
  const owner = playerFor(after, ownerUserId);
  if (!owner) return false;
  const expectedStatus = enemyCaptureReturnStatus(ownedByUser[ownerUserId] ?? []);
  return pieces.every((beforePiece) => {
    const next = owner.pieces.find((piece) => piece.id === beforePiece.id);
    return next?.status === expectedStatus && next.node == null;
  });
}

function capturedGroupsOnPath(
  before: GameEngineState,
  after: GameEngineState,
  attackerUserId: string,
  nodes: number[],
  ownedByUser: Record<string, string[]>,
) {
  const nodeSet = new Set(nodes);
  const groups = new Map<string, { node: number; pieces: PieceState[] }>();
  for (const player of before.players) {
    if (player.userId === attackerUserId) continue;
    for (const piece of player.pieces) {
      if (piece.status !== "ON_BOARD" || piece.node == null || !nodeSet.has(piece.node)) continue;
      const key = `${player.userId}:${piece.groupId}`;
      const entry = groups.get(key) ?? { node: piece.node, pieces: [] };
      entry.pieces.push(piece);
      groups.set(key, entry);
    }
  }
  return [...groups.values()].filter((entry) => entry.pieces.length > 0 && wasCaptured(after, entry.pieces, ownedByUser));
}

function restoreOneInsuredPiece(after: GameEngineState, beforePieces: PieceState[]) {
  const original = [...beforePieces].sort((left, right) => left.id.localeCompare(right.id))[0];
  if (!original) return null;
  const player = playerFor(after, original.ownerUserId);
  const piece = player?.pieces.find((candidate) => candidate.id === original.id);
  if (!piece) return null;
  piece.status = "ON_BOARD";
  piece.node = original.node;
  piece.groupId = piece.id;
  piece.hasEntered = original.hasEntered;
  return piece.id;
}

function nextNodesAfterDestination(destination: number, result: RollToken, ownedIds: string[]) {
  const forbidShortcutEntry = result.forbidShortcuts || ownedIds.includes("P10");
  const allowPassingShortcutEntry = ownedIds.includes("P09");

  if (ownedIds.includes("P02")) {
    if (result.face === "BACKDO") {
      const options = forwardMoveOptions(destination, 1, { forbidShortcutEntry, allowPassingShortcutEntry });
      return options.filter((move) => !move.finished && move.node != null).map((move) => move.node as number);
    }
    const options = reverseMoveOptions(destination, 1, { forbidShortcutEntry, allowPassingShortcutEntry });
    return options.filter((move) => !move.home && move.node != null).map((move) => move.node as number);
  }

  if (result.face === "BACKDO") return backwardTargets(destination);
  const options = forwardMoveOptions(destination, 1, { forbidShortcutEntry, allowPassingShortcutEntry });
  return options.filter((move) => !move.finished && move.node != null).map((move) => move.node as number);
}

function doubleHitTargets(
  engine: GameEngineState,
  attackerUserId: string,
  destination: number,
  previousNode: number | null,
  result: RollToken,
  ownedByUser: Record<string, string[]>,
) {
  const nodes = new Set<number>();
  if (previousNode != null && previousNode > 0 && previousNode !== destination && previousNode !== FINISH_NODE) nodes.add(previousNode);
  for (const node of nextNodesAfterDestination(destination, result, ownedByUser[attackerUserId] ?? [])) {
    if (node !== destination) nodes.add(node);
  }

  const targets: CaptureTarget[] = [];
  for (const node of nodes) {
    for (const { key, pieces } of groupedOpponentsAt(engine, attackerUserId, node)) {
      const victim = pieces[0];
      if (!victim) continue;
      const victimOwned = ownedByUser[victim.ownerUserId] ?? [];
      if (isSanctuaryGroup(engine, victim.ownerUserId, victim.groupId, node)) continue;
      if (isCaptureImmune(engine, victim.ownerUserId, victimOwned)) continue;
      targets.push({
        key: `${node}:${key}`,
        victimUserId: victim.ownerUserId,
        victimGroupId: victim.groupId,
        node,
        pieceIds: pieces.map((piece) => piece.id),
      });
    }
  }
  return targets;
}

function saveContinuation(engine: GameEngineState, decisions: CaptureDecision[], attackerUserId: string, attackerGroupId: string) {
  const pending: PendingCaptureChoice = {
    decisions,
    attackerUserId,
    attackerGroupId,
    resumeStage: engine.stage === "CAPTURE_CHOICE" ? "MOVING" : engine.stage,
    resumeCurrentSeat: engine.currentSeat,
    resumeRound: engine.round,
    resumeTurnNumber: engine.turnNumber,
    resumePendingRolls: structuredClone(engine.pendingRolls),
    resumeResults: structuredClone(engine.results),
    resumePendingRollChoice: structuredClone(engine.pendingRollChoice ?? null),
    resumePendingSplitChoice: structuredClone(engine.pendingSplitChoice ?? null),
    resumePendingRelocationChoice: structuredClone(engine.pendingRelocationChoice ?? null),
    resumePendingStackChoice: structuredClone(engine.pendingStackChoice ?? null),
    resumeLastAction: engine.lastAction,
  };
  engine.pendingCaptureChoice = pending;
  engine.stage = "CAPTURE_CHOICE";
  engine.pendingRollChoice = null;
  engine.pendingSplitChoice = null;
  engine.pendingRelocationChoice = null;
  engine.pendingStackChoice = null;
  const first = decisions[0];
  const chooser = first ? playerFor(engine, first.chooserUserId) : null;
  if (chooser) engine.currentSeat = chooser.seat;
  return pending;
}

export function maybePauseCaptureChoices(
  before: GameEngineState,
  afterInput: GameEngineState,
  args: {
    attackerUserId: string;
    attackerGroupId: string;
    resultId: string;
    ownedByUser: Record<string, string[]>;
  },
) {
  if (afterInput.winnerUserId || before.stage !== "MOVING") return afterInput;
  const movement = movedPath(before, afterInput, args.attackerUserId, args.attackerGroupId);
  const result = resultBeforeMove(before, args.resultId);
  if (!movement || !result) return afterInput;
  const destination = movement.path[movement.path.length - 1];
  if (destination == null) return afterInput;

  const captured = capturedGroupsOnPath(before, afterInput, args.attackerUserId, movement.path, args.ownedByUser);
  if (!captured.length) return afterInput;
  const destinationCaptured = captured.filter((entry) => entry.node === destination);

  const after = structuredClone(afterInput);
  const decisions: CaptureDecision[] = [];

  for (const { pieces: beforePieces } of captured) {
    const victim = beforePieces[0];
    if (!victim || beforePieces.length < 2) continue;
    const victimOwned = args.ownedByUser[victim.ownerUserId] ?? [];
    if (!victimOwned.includes("G11")) continue;
    restoreOneInsuredPiece(after, beforePieces);
  }

  const attackerOwned = args.ownedByUser[args.attackerUserId] ?? [];
  if (attackerOwned.includes("P08") && destinationCaptured.length > 0) {
    const attacker = playerFor(after, args.attackerUserId);
    const attackerStillAtDestination = attacker?.pieces.some((piece) => (
      piece.id === movement.physicalPieceId && piece.status === "ON_BOARD" && piece.node === destination
    ));
    if (attackerStillAtDestination) {
      const previousNode = movement.path.length >= 2
        ? movement.path[movement.path.length - 2]
        : movement.startNode > 0 ? movement.startNode : null;
      const targets = doubleHitTargets(after, args.attackerUserId, destination, previousNode, result, args.ownedByUser);
      if (targets.length) {
        decisions.push({
          kind: "DOUBLE_HIT",
          chooserUserId: args.attackerUserId,
          attackerUserId: args.attackerUserId,
          attackerGroupId: args.attackerGroupId,
          targets,
        });
      }
    }
  }

  if (!decisions.length) return applyPassiveSpecialWinner(afterInput, args.ownedByUser);
  saveContinuation(after, decisions, args.attackerUserId, args.attackerGroupId);
  after.lastAction = decisions[0]?.kind === "INSURANCE"
    ? "보험 들었습니다 · 남길 말을 선택합니다."
    : "일타쌍피 · 추가로 잡을 상대를 선택합니다.";
  return after;
}

function restoreContinuation(engine: GameEngineState, pending: PendingCaptureChoice, message: string) {
  engine.stage = pending.resumeStage;
  engine.currentSeat = pending.resumeCurrentSeat;
  engine.round = pending.resumeRound;
  engine.turnNumber = pending.resumeTurnNumber;
  engine.pendingRolls = structuredClone(pending.resumePendingRolls);
  engine.results = structuredClone(pending.resumeResults);
  engine.pendingRollChoice = structuredClone(pending.resumePendingRollChoice);
  engine.pendingSplitChoice = structuredClone(pending.resumePendingSplitChoice);
  engine.pendingRelocationChoice = structuredClone(pending.resumePendingRelocationChoice);
  engine.pendingStackChoice = structuredClone(pending.resumePendingStackChoice);
  engine.pendingCaptureChoice = null;
  engine.lastAction = message;
}

function showNextDecision(engine: GameEngineState, pending: PendingCaptureChoice, message: string) {
  const next = pending.decisions[0];
  if (!next) {
    restoreContinuation(engine, pending, `${message} · ${pending.resumeLastAction}`);
    return;
  }
  engine.stage = "CAPTURE_CHOICE";
  const chooser = playerFor(engine, next.chooserUserId);
  if (chooser) engine.currentSeat = chooser.seat;
  engine.lastAction = next.kind === "INSURANCE"
    ? `${message} · 보험 들었습니다 · 남길 말을 선택합니다.`
    : `${message} · 일타쌍피 · 추가로 잡을 상대를 선택합니다.`;
}

function returnAttackerAfterEnemyEffect(
  engine: GameEngineState,
  attackerUserId: string,
  attackerGroupId: string,
  attackerOwned: string[],
) {
  const player = playerFor(engine, attackerUserId);
  if (!player) return;
  clearGroupMoveFixedToOne(engine, attackerUserId, attackerGroupId);
  clearJunctionBoostForGroup(engine, attackerUserId, attackerGroupId);
  clearPathControlForGroup(engine, attackerUserId, attackerGroupId);
  resetAthleteAccelerationForGroup(engine, attackerUserId, attackerGroupId, attackerOwned);
  const group = player.pieces.filter((piece) => piece.groupId === attackerGroupId && piece.status === "ON_BOARD");
  returnPiecesAfterEnemyCapture(group, attackerOwned);
}

function declareSpecialWinner(engine: GameEngineState, userId: string, ownedIds: string[]) {
  const win = specialWinForPlayer(engine, userId, ownedIds);
  if (!win) return false;
  engine.winnerUserId = userId;
  engine.winnerCondition = win.condition;
  engine.stage = "FINISHED";
  engine.pendingRolls = [];
  engine.results = [];
  engine.pendingRollChoice = null;
  engine.pendingSplitChoice = null;
  engine.pendingCaptureChoice = null;
  engine.pendingRelocationChoice = null;
  engine.pendingStackChoice = null;
  engine.lastAction = win.message;
  return true;
}

function captureDoubleHitTarget(
  engine: GameEngineState,
  pending: PendingCaptureChoice,
  decision: Extract<CaptureDecision, { kind: "DOUBLE_HIT" }>,
  target: CaptureTarget,
  ownedByUser: Record<string, string[]>,
) {
  const victim = playerFor(engine, target.victimUserId);
  const pieces = victim?.pieces.filter((piece) => (
    target.pieceIds.includes(piece.id)
    && piece.groupId === target.victimGroupId
    && piece.status === "ON_BOARD"
    && piece.node === target.node
  )) ?? [];
  if (pieces.length !== target.pieceIds.length || !pieces.length) throw new Error("추가로 잡을 상대의 상태가 변경되었습니다.");

  const victimOwned = ownedByUser[target.victimUserId] ?? [];
  if (isSanctuaryGroup(engine, target.victimUserId, target.victimGroupId, target.node)) throw new Error("성역의 말은 잡을 수 없습니다.");
  if (isCaptureImmune(engine, target.victimUserId, victimOwned)) throw new Error("잡기 면역 상태의 말입니다.");

  const insuredOriginals = victimOwned.includes("G11") && pieces.length >= 2
    ? pieces.map((piece) => structuredClone(piece))
    : null;

  if (!blocksCaptureExtraRoll(pieces.length, victimOwned)) pending.resumePendingRolls.push("CAPTURE");
  if (betrayalCaptureBonusRoll(engine, decision.attackerUserId, decision.attackerGroupId, target.victimUserId) > 0) pending.resumePendingRolls.push("AUGMENT");
  recordCaptureAgainstPlayer(engine, target.victimUserId, victimOwned);
  applyWaterGhostOne(engine, decision.attackerUserId, decision.attackerGroupId, victimOwned);
  const attackerReturned = shouldReturnAttackerWithWaterGhostTwo(victimOwned);
  clearGroupMoveFixedToOne(engine, target.victimUserId, target.victimGroupId);
  clearJunctionBoostForGroup(engine, target.victimUserId, target.victimGroupId);
  clearPathControlForGroup(engine, target.victimUserId, target.victimGroupId);
  resetAthleteAccelerationForGroup(engine, target.victimUserId, target.victimGroupId, victimOwned);
  clearTurtleLockForGroup(engine, target.victimUserId, target.victimGroupId);
  const capturedPieceIds = pieces.map((piece) => piece.id);
  clearPlagueForGroup(engine, target.victimUserId, target.victimGroupId);
  returnPiecesAfterEnemyCapture(pieces, victimOwned);
  const attackerOwned = ownedByUser[decision.attackerUserId] ?? [];
  if (attackerOwned.includes("A14")) infectPlaguePieceIds(engine, target.victimUserId, capturedPieceIds);
  recordEnemyCaptures(engine, decision.attackerUserId, 1, attackerOwned);
  if (attackerReturned) {
    returnAttackerAfterEnemyEffect(engine, decision.attackerUserId, decision.attackerGroupId, attackerOwned);
  }

  const won = declareSpecialWinner(engine, decision.attackerUserId, attackerOwned);
  if (won) return true;

  if (insuredOriginals?.length) restoreOneInsuredPiece(engine, insuredOriginals);
  return false;
}

export function applyCaptureChoice(
  engineInput: GameEngineState,
  chooserUserId: string,
  choice: { pieceId?: string | null; targetKey?: string | null },
  ownedByUser: Record<string, string[]>,
) {
  if (engineInput.stage !== "CAPTURE_CHOICE" || !engineInput.pendingCaptureChoice) {
    throw new Error("지금은 잡기 후 선택을 할 수 없습니다.");
  }
  const engine = structuredClone(engineInput);
  const pending = engine.pendingCaptureChoice;
  if (!pending) throw new Error("잡기 선택 상태를 찾지 못했습니다.");
  const decision = pending.decisions[0];
  if (!decision || decision.chooserUserId !== chooserUserId) throw new Error("현재 선택할 플레이어가 아닙니다.");

  let message = "";
  if (decision.kind === "INSURANCE") {
    const pieceId = String(choice.pieceId ?? "");
    if (!decision.pieceIds.includes(pieceId)) throw new Error("대기로 돌려보낼 말을 선택해주세요.");
    const player = playerFor(engine, decision.victimUserId);
    const group = player?.pieces.filter((piece) => (
      decision.pieceIds.includes(piece.id)
      && piece.groupId === decision.victimGroupId
      && piece.status === "ON_BOARD"
      && piece.node === decision.node
    )) ?? [];
    if (group.length !== decision.pieceIds.length) throw new Error("보험 대상 묶음의 상태가 변경되었습니다.");
    const selected = group.find((piece) => piece.id === pieceId);
    if (!selected) throw new Error("선택한 말을 찾지 못했습니다.");
    returnPiecesAfterEnemyCapture([selected], ownedByUser[decision.victimUserId] ?? []);

    const remaining = group.filter((piece) => piece.id !== selected.id);
    if (remaining.length > 0 && decision.victimGroupId === selected.id) {
      const replacementGroupId = remaining[0].id;
      for (const piece of remaining) piece.groupId = replacementGroupId;
    }

    const returnLabel = (ownedByUser[decision.victimUserId] ?? []).includes("P02") ? "문워크 출발점" : "대기";
    message = `보험 들었습니다 · 말 ${pieceId.split("-")[1] ?? pieceId}만 ${returnLabel}로 복귀`;
  } else {
    const targetKey = typeof choice.targetKey === "string" && choice.targetKey ? choice.targetKey : null;
    if (targetKey) {
      const target = decision.targets.find((candidate) => candidate.key === targetKey);
      if (!target) throw new Error("선택할 수 없는 일타쌍피 대상입니다.");
      const won = captureDoubleHitTarget(engine, pending, decision, target, ownedByUser);
      message = `일타쌍피 · ${target.node}번의 상대 묶음을 추가로 잡았습니다.`;
      if (won) return engine;
    } else {
      message = "일타쌍피 · 추가 잡기를 사용하지 않았습니다.";
    }
  }

  pending.decisions = pending.decisions.slice(1);
  showNextDecision(engine, pending, message);
  if (engine.stage !== "CAPTURE_CHOICE") return applyPassiveSpecialWinner(engine, ownedByUser);
  return engine;
}
