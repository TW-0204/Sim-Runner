import { queueA04BonusForNextBasic, type PlayerAugmentSetups } from "@/lib/augments/effects";
import {
  advanceTurn,
  applyBombExplosion,
  applyGravityExplosion,
  currentPlayer,
  discardUnusableResults,
  expireWormholeForCurrentRound,
} from "./engine";
import { applyPassiveSpecialWinner } from "./passive-win";
import type { GameEngineState } from "./types";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export type AutomaticAugmentEvent = {
  engine: GameEngineState;
  actorUserId: string | null;
  applied: boolean;
};

export function activatePlagueTurnIfNeeded(engineInput: GameEngineState): GameEngineState {
  const turnOwner = currentPlayer(engineInput);
  const runtime = engineInput.augmentRuntime?.[turnOwner.userId];
  if (!runtime || Object.keys(runtime.plaguePieceIds ?? {}).length === 0 || runtime.plagueTurnActive === true) {
    return engineInput;
  }
  const engine = clone(engineInput);
  engine.augmentRuntime![turnOwner.userId]!.plagueTurnActive = true;
  return engine;
}

/** Applies one due mandatory augment event in effective-v11 order: A07 before A01. */
export function resolveDueAutomaticAugmentEvent(
  engineInput: GameEngineState,
  ownedByUser: Record<string, string[]>,
  random: () => number = Math.random,
): AutomaticAugmentEvent {
  if (engineInput.round >= 6) {
    const bombOwners = engineInput.players
      .filter((player) => (ownedByUser[player.userId] ?? []).includes("A07"))
      .filter((player) => !engineInput.augmentRuntime?.[player.userId]?.bombResolved)
      .map((player) => player.userId);
    if (bombOwners.length > 0) {
      const result = applyBombExplosion(engineInput, bombOwners, ownedByUser);
      return {
        engine: applyPassiveSpecialWinner(result.engine, ownedByUser),
        actorUserId: bombOwners[0] ?? null,
        applied: true,
      };
    }
  }

  for (const player of engineInput.players) {
    if (!(ownedByUser[player.userId] ?? []).includes("A01")) continue;
    const runtime = engineInput.augmentRuntime?.[player.userId];
    if (runtime?.gravityExplosionRound == null || engineInput.round < runtime.gravityExplosionRound) continue;
    return {
      engine: applyGravityExplosion(engineInput, player.userId, ownedByUser, random),
      actorUserId: player.userId,
      applied: true,
    };
  }

  return { engine: engineInput, actorUserId: null, applied: false };
}

export function resolveUniverseFreezeTurn(engineInput: GameEngineState): { engine: GameEngineState; applied: boolean } {
  if (engineInput.stage !== "AWAITING_ROLL" || engineInput.pendingRolls[0] !== "BASIC") {
    return { engine: engineInput, applied: false };
  }
  const player = currentPlayer(engineInput);
  const remaining = engineInput.augmentRuntime?.[player.userId]?.universeFreezeTurnsRemaining ?? 0;
  if (remaining <= 0) return { engine: engineInput, applied: false };

  const engine = clone(engineInput);
  engine.augmentRuntime ??= {};
  engine.augmentRuntime[player.userId] ??= {};
  engine.augmentRuntime[player.userId].universeFreezeTurnsRemaining = remaining - 1;
  advanceTurn(engine);
  engine.lastAction = `${player.displayName}: 우주의 중심 · 이동 정지`;
  return { engine, applied: true };
}

export function resolveVacancyTurn(
  engineInput: GameEngineState,
  ownedIds: string[],
): { engine: GameEngineState; applied: boolean } {
  if (engineInput.stage !== "AWAITING_ROLL" || engineInput.pendingRolls[0] !== "BASIC" || !ownedIds.includes("S13")) {
    return { engine: engineInput, applied: false };
  }
  const player = currentPlayer(engineInput);
  const engine = clone(engineInput);
  engine.augmentRuntime ??= {};
  engine.augmentRuntime[player.userId] ??= {};
  const runtime = engine.augmentRuntime[player.userId];
  if (!runtime.vacancyInitialized) {
    runtime.vacancyInitialized = true;
    runtime.vacancySkipsRemaining = 2;
  }

  const remaining = runtime.vacancySkipsRemaining ?? 0;
  if (remaining <= 0) {
    if (runtime.vacancyReturnBonusPending && !runtime.vacancyReturnBonusGranted) {
      runtime.vacancyReturnBonusPending = false;
      runtime.vacancyReturnBonusGranted = true;
      engine.pendingRolls.push("AUGMENT");
      engine.lastAction = `${player.displayName}: 자리비움 복귀 · 추가 던지기 1회`;
      return { engine, applied: true };
    }
    return { engine: engineInput, applied: false };
  }

  runtime.vacancySkipsRemaining = remaining - 1;
  const remainingAfter = runtime.vacancySkipsRemaining;
  if (remainingAfter <= 0) runtime.vacancyReturnBonusPending = true;
  const afterExpiry = expireWormholeForCurrentRound(engine, player.userId, ownedIds);
  advanceTurn(afterExpiry);
  const following = currentPlayer(afterExpiry);
  afterExpiry.lastAction = remainingAfter > 0
    ? `${player.displayName}: 자리비움 · 턴 스킵 (${remainingAfter}회 남음) · ${following.displayName}의 턴`
    : `${player.displayName}: 자리비움 종료 · 다음 자기 턴 추가 던지기 1회 · 이후 전진 이동 +1 · ${following.displayName}의 턴`;
  return { engine: afterExpiry, applied: true };
}

export function injectBombBonusRolls(
  engineInput: GameEngineState,
  userId: string,
  ownedIds: string[],
): GameEngineState {
  if (!ownedIds.includes("A07") || engineInput.stage !== "AWAITING_ROLL") return engineInput;
  const pending = engineInput.augmentRuntime?.[userId]?.bombBonusRollsPending ?? 0;
  if (pending <= 0) return engineInput;
  const engine = clone(engineInput);
  engine.augmentRuntime ??= {};
  engine.augmentRuntime[userId] ??= {};
  engine.augmentRuntime[userId].bombBonusRollsPending = 0;
  for (let index = 0; index < pending; index += 1) engine.pendingRolls.push("AUGMENT");
  return engine;
}

export function prepareBasicRollAugments(
  engine: GameEngineState,
  userId: string,
  ownedIds: string[],
) {
  queueA04BonusForNextBasic(engine, userId, ownedIds);
}

export type S16NakResolution = {
  engine: GameEngineState;
  checked: boolean;
  occurred: boolean;
};

export function resolveS16Nak(
  engineInput: GameEngineState,
  userId: string,
  ownedByUser: Record<string, string[]>,
  setups: PlayerAugmentSetups,
  random: () => number,
  createCompensationTokenId: () => string,
): S16NakResolution {
  const nakActive = Object.values(ownedByUser).some((ids) => ids.includes("S16"));
  if (engineInput.pendingRolls[0] !== "BASIC" || !nakActive) {
    return { engine: engineInput, checked: false, occurred: false };
  }
  if (random() >= 0.05) return { engine: engineInput, checked: true, occurred: false };

  const owned = ownedByUser[userId] ?? [];
  const engine = clone(engineInput);
  engine.pendingRolls.shift();
  const actorName = currentPlayer(engine).displayName;

  if (!owned.includes("S16") && engine.pendingRolls.length === 0) {
    discardUnusableResults(engine, owned, setups);
  }

  if (owned.includes("S16")) {
    engine.results.push({
      id: createCompensationTokenId(),
      face: "MOVE1",
      baseSteps: 1,
      finalSteps: 1,
      source: "AUGMENT",
      suppressMovementBonuses: true,
    });
    engine.stage = "MOVING";
    engine.lastAction = `${actorName}: 낙! · 1칸 이동권`;
  } else if (engine.pendingRolls.length > 0) {
    engine.stage = "AWAITING_ROLL";
    engine.lastAction = `${actorName}: 낙!`;
  } else if (engine.results.length > 0) {
    engine.stage = "MOVING";
    engine.lastAction = `${actorName}: 낙!`;
  } else {
    advanceTurn(engine);
    engine.lastAction = `${actorName}: 낙! · ${currentPlayer(engine).displayName}의 턴`;
  }

  return { engine, checked: true, occurred: true };
}
