import { consumeFaceExtraRollGrant, finalStepsForRoll, type PlayerAugmentSetups } from "@/lib/augments/effects";
import { applyRoll, currentPlayer } from "./engine";
import { baseStepsForFace, faceLabel } from "./roll";
import { settleAfterRollResolution } from "./turn-settlement";
import type { GameEngineState, RollFace, RollToken } from "./types";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function runtimeFor(engine: GameEngineState, userId: string) {
  engine.augmentRuntime ??= {};
  const runtime = engine.augmentRuntime[userId] ?? {};
  engine.augmentRuntime[userId] = runtime;
  return runtime;
}

function has(ownedIds: string[], id: string) {
  return ownedIds.includes(id);
}

function applyRevengeBasicBonus(engine: GameEngineState, userId: string, ownedIds: string[], token: RollToken) {
  if (!has(ownedIds, "AUG-007") || token.source !== "BASIC" || token.face === "BACKDO") return token;
  const runtime = runtimeFor(engine, userId);
  if (!runtime.revengeBasicPending) return token;
  runtime.revengeBasicPending = false;
  return { ...token, finalSteps: token.finalSteps + 1 };
}

function applyBasicMovementBonuses(engine: GameEngineState, userId: string, ownedIds: string[], token: RollToken) {
  return applyRevengeBasicBonus(engine, userId, ownedIds, token);
}

export function godHandChargeCount(engine: GameEngineState, userId: string, ownedIds: string[]) {
  if (!has(ownedIds, "AUG-044")) return 0;
  return engine.augmentRuntime?.[userId]?.godHandCharges ?? 0;
}

function recordGodHandBasicRoll(engine: GameEngineState, userId: string, ownedIds: string[]) {
  if (!has(ownedIds, "AUG-044")) return;
  const runtime = runtimeFor(engine, userId);
  runtime.godHandCharges ??= 0;
  runtime.godHandBasicProgress ??= 0;

  if (runtime.godHandSkipNextBasicProgress) {
    runtime.godHandSkipNextBasicProgress = false;
    runtime.godHandBasicProgress = 0;
    return;
  }

  if (runtime.godHandCharges >= 1) {
    runtime.godHandBasicProgress = 0;
    return;
  }

  runtime.godHandBasicProgress += 1;
  if (runtime.godHandBasicProgress >= 2) {
    runtime.godHandCharges = 1;
    runtime.godHandBasicProgress = 0;
  }
}

function canUseDoReroll(engine: GameEngineState, userId: string, ownedIds: string[]) {
  if (!has(ownedIds, "AUG-012")) return false;
  return (engine.augmentRuntime?.[userId]?.doRerollsUsed ?? 0) < 2;
}

function pauseForDoRerollIfNeeded(
  engine: GameEngineState,
  tokenId: string,
  userId: string,
  ownedIds: string[],
) {
  const tokenIndex = engine.results.findIndex((result) => result.id === tokenId);
  const token = tokenIndex >= 0 ? engine.results[tokenIndex] : null;
  if (!token || token.source !== "BASIC" || token.face !== "DO" || !canUseDoReroll(engine, userId, ownedIds)) {
    if (token && tokenIndex >= 0) engine.results[tokenIndex] = applyBasicMovementBonuses(engine, userId, ownedIds, token);
    recordGodHandBasicRoll(engine, userId, ownedIds);
    return engine;
  }

  engine.results = engine.results.filter((result) => result.id !== tokenId);
  engine.stage = "ROLL_CHOICE";
  engine.pendingRollChoice = { kind: "DO_REROLL", token };
  const player = engine.players.find((candidate) => candidate.userId === userId);
  engine.lastAction = `${player?.displayName ?? "플레이어"}: 도가 나왔습니다. 다시 던질까요?`;
  return engine;
}

export function beginRollFlow(
  engineInput: GameEngineState,
  rolledFaces: [RollFace, RollFace],
  tokenId: string,
  ownedIds: string[] = [],
  setups: PlayerAugmentSetups = {},
) {
  if (engineInput.stage !== "AWAITING_ROLL") throw new Error("지금은 윷을 던질 수 없습니다.");
  const source = engineInput.pendingRolls[0];
  if (!source) throw new Error("처리할 던지기가 없습니다.");
  const userId = currentPlayer(engineInput).userId;

  if (source === "BASIC") {
    const engine = clone(engineInput);
    const player = currentPlayer(engine);
    const runtime = runtimeFor(engine, player.userId);
    const counter = Boolean(runtime.counterRollPending && has(ownedIds, "AUG-011"));
    const either = has(ownedIds, "AUG-039");

    if (counter || either) {
      if (counter) runtime.counterRollPending = false;
      engine.stage = "ROLL_CHOICE";
      engine.pendingRollChoice = {
        kind: "DUAL",
        reason: either ? "EITHER" : "COUNTER",
        faces: rolledFaces,
      };
      engine.lastAction = either
        ? `${player.displayName}: 양자택일 · 두 결과 중 하나를 고르세요.`
        : `${player.displayName}: 반격의 서막 · 두 결과 중 하나를 고르세요.`;
      return engine;
    }
  }

  const next = applyRoll(engineInput, rolledFaces[0], tokenId, ownedIds, setups);
  if (source === "BASIC") return pauseForDoRerollIfNeeded(next, tokenId, userId, ownedIds);
  return next;
}

export function resolveDualRollChoice(
  engineInput: GameEngineState,
  choiceIndex: number,
  tokenId: string,
  ownedIds: string[] = [],
  setups: PlayerAugmentSetups = {},
) {
  const pending = engineInput.pendingRollChoice;
  if (engineInput.stage !== "ROLL_CHOICE" || pending?.kind !== "DUAL") {
    throw new Error("선택할 던지기 결과가 없습니다.");
  }
  if (choiceIndex !== 0 && choiceIndex !== 1) throw new Error("잘못된 결과 선택입니다.");

  const userId = currentPlayer(engineInput).userId;
  const face = pending.faces[choiceIndex];
  const engine = clone(engineInput);
  engine.pendingRollChoice = null;
  engine.stage = "AWAITING_ROLL";
  const next = applyRoll(engine, face, tokenId, ownedIds, setups);
  return pauseForDoRerollIfNeeded(next, tokenId, userId, ownedIds);
}

export function keepDoResult(engineInput: GameEngineState, ownedIds: string[] = []) {
  const pending = engineInput.pendingRollChoice;
  if (engineInput.stage !== "ROLL_CHOICE" || pending?.kind !== "DO_REROLL") {
    throw new Error("유지할 도 결과가 없습니다.");
  }

  const engine = clone(engineInput);
  const player = currentPlayer(engine);
  const token = applyBasicMovementBonuses(engine, player.userId, ownedIds, pending.token);
  engine.pendingRollChoice = null;
  engine.results.push(token);
  recordGodHandBasicRoll(engine, player.userId, ownedIds);
  engine.stage = engine.pendingRolls.length > 0 ? "AWAITING_ROLL" : "MOVING";
  engine.lastAction = `${player.displayName}: 도를 그대로 사용합니다.`;
  return engine;
}

export function rerollDoResult(
  engineInput: GameEngineState,
  rerolledFace: RollFace,
  tokenId: string,
  ownedIds: string[] = [],
  setups: PlayerAugmentSetups = {},
) {
  if (engineInput.stage !== "ROLL_CHOICE" || engineInput.pendingRollChoice?.kind !== "DO_REROLL") {
    throw new Error("다시 던질 도 결과가 없습니다.");
  }

  const engine = clone(engineInput);
  const player = currentPlayer(engine);
  const runtime = runtimeFor(engine, player.userId);
  if ((runtime.doRerollsUsed ?? 0) >= 2) throw new Error("아깝다 리롤을 모두 사용했습니다.");
  runtime.doRerollsUsed = (runtime.doRerollsUsed ?? 0) + 1;
  engine.pendingRollChoice = null;

  let token: RollToken = {
    id: tokenId,
    face: rerolledFace,
    baseSteps: baseStepsForFace(rerolledFace),
    finalSteps: finalStepsForRoll(rerolledFace, "BASIC", ownedIds),
    source: "BASIC",
  };
  token = applyBasicMovementBonuses(engine, player.userId, ownedIds, token);
  engine.results.push(token);
  if (consumeFaceExtraRollGrant(engine, player.userId, rerolledFace, ownedIds)) engine.pendingRolls.push("YUT_MO");
  recordGodHandBasicRoll(engine, player.userId, ownedIds);
  engine.lastAction = `${player.displayName}: 다시 던져 ${faceLabel(rerolledFace)}!`;
  return settleAfterRollResolution(engine, ownedIds, setups);
}

export function applyGodHandRoll(
  engineInput: GameEngineState,
  face: RollFace,
  tokenId: string,
  ownedIds: string[] = [],
  setups: PlayerAugmentSetups = {},
) {
  if (!has(ownedIds, "AUG-044")) throw new Error("신의 손을 보유하고 있지 않습니다.");
  if (!["DO", "GAE", "GEOL", "YUT", "MO"].includes(face)) {
    throw new Error("신의 손으로 선택할 수 없는 결과입니다.");
  }
  if (engineInput.stage !== "AWAITING_ROLL" || engineInput.pendingRolls[0] !== "BASIC") {
    throw new Error("신의 손은 다음 기본 던지기에만 사용할 수 있습니다.");
  }

  const engine = clone(engineInput);
  const player = currentPlayer(engine);
  const runtime = runtimeFor(engine, player.userId);
  runtime.godHandCharges ??= 0;
  runtime.godHandBasicProgress ??= 0;
  if (runtime.godHandCharges < 1) throw new Error("신의 손 충전이 없습니다.");
  runtime.godHandCharges -= 1;
  runtime.godHandBasicProgress = 0;
  runtime.godHandSkipNextBasicProgress = true;

  const next = applyRoll(engine, face, tokenId, ownedIds, setups);
  return pauseForDoRerollIfNeeded(next, tokenId, player.userId, ownedIds);
}
