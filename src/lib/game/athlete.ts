import type { GameEngineState } from "./types";

function has(ownedIds: string[], id: string) {
  return ownedIds.includes(id);
}

function runtimeFor(engine: GameEngineState, userId: string) {
  engine.augmentRuntime ??= {};
  const runtime = engine.augmentRuntime[userId] ?? {};
  engine.augmentRuntime[userId] = runtime;
  return runtime;
}

function ensureAthleteTurn(engine: GameEngineState, userId: string, ownedIds: string[]) {
  if (!has(ownedIds, "G15")) return null;
  const runtime = runtimeFor(engine, userId);
  if (runtime.athleteTurnNumber !== engine.turnNumber) {
    runtime.athleteTurnNumber = engine.turnNumber;
    runtime.athleteMoved = false;
    runtime.athleteDisqualified = false;
    runtime.athleteRewarded = false;
  }
  return runtime;
}

export function markAthleteMovement(engine: GameEngineState, userId: string, ownedIds: string[]) {
  const runtime = ensureAthleteTurn(engine, userId, ownedIds);
  if (runtime) runtime.athleteMoved = true;
}

export function markAthleteDisqualified(engine: GameEngineState, userId: string, ownedIds: string[]) {
  const runtime = ensureAthleteTurn(engine, userId, ownedIds);
  if (runtime) runtime.athleteDisqualified = true;
}

export function moveOwnedIdsForAthlete(ownedIds: string[]) {
  if (!has(ownedIds, "G15")) return ownedIds;
  return ownedIds.filter((id) => id !== "G10");
}

type RuntimeSnapshot = {
  userId: string;
  hadRuntime: boolean;
  timesCaptured: number | undefined;
};

export function prepareAthleteCoexistence(
  engine: GameEngineState,
  actorUserId: string,
  actorOwnedIds: string[],
  ownedByUser: Record<string, string[]>,
) {
  const effectiveOwnedByUser = Object.fromEntries(
    Object.entries(ownedByUser).map(([userId, ids]) => [userId, [...ids]]),
  ) as Record<string, string[]>;
  const snapshots: RuntimeSnapshot[] = [];

  if (!has(actorOwnedIds, "G15")) {
    return {
      ownedByUser: effectiveOwnedByUser,
      restore: (_nextEngine: GameEngineState) => undefined,
    };
  }

  engine.augmentRuntime ??= {};
  for (const player of engine.players) {
    if (player.userId === actorUserId) continue;
    const hadRuntime = Boolean(engine.augmentRuntime[player.userId]);
    const runtime = runtimeFor(engine, player.userId);
    snapshots.push({
      userId: player.userId,
      hadRuntime,
      timesCaptured: runtime.timesCaptured,
    });
    runtime.timesCaptured = Math.max(runtime.timesCaptured ?? 0, 4);
    effectiveOwnedByUser[player.userId] = [...new Set([...(effectiveOwnedByUser[player.userId] ?? []), "S04"])];
  }

  return {
    ownedByUser: effectiveOwnedByUser,
    restore(nextEngine: GameEngineState) {
      for (const snapshot of snapshots) {
        const runtime = nextEngine.augmentRuntime?.[snapshot.userId];
        if (!runtime) continue;
        if (snapshot.timesCaptured == null) delete runtime.timesCaptured;
        else runtime.timesCaptured = snapshot.timesCaptured;
        if (!snapshot.hadRuntime && Object.keys(runtime).length === 0) {
          delete nextEngine.augmentRuntime?.[snapshot.userId];
        }
      }
    },
  };
}

function actorActuallyMoved(before: GameEngineState, after: GameEngineState, actorUserId: string) {
  const previous = before.players.find((player) => player.userId === actorUserId);
  const next = after.players.find((player) => player.userId === actorUserId);
  if (!previous || !next) return false;
  const nextById = new Map(next.pieces.map((piece) => [piece.id, piece]));
  return previous.pieces.some((piece) => {
    const candidate = nextById.get(piece.id);
    if (!candidate) return true;
    return candidate.status !== piece.status
      || candidate.node !== piece.node
      || candidate.pathHistory.length !== piece.pathHistory.length;
  });
}

export function maybeGrantAthleteExtraRoll(
  before: GameEngineState,
  after: GameEngineState,
  actorUserId: string,
  actorOwnedIds: string[],
) {
  if (!has(actorOwnedIds, "G15") || after.winnerUserId) return after;
  const actor = before.players.find((player) => player.userId === actorUserId);
  const runtime = after.augmentRuntime?.[actorUserId];
  if (!actor || !runtime) return after;
  if (runtime.athleteTurnNumber !== before.turnNumber) return after;
  if (!runtime.athleteMoved || runtime.athleteDisqualified || runtime.athleteRewarded) return after;

  const hadMovementBeforeAction = Boolean(before.augmentRuntime?.[actorUserId]?.athleteMoved);
  if (!hadMovementBeforeAction && !actorActuallyMoved(before, after, actorUserId)) {
    runtime.athleteMoved = false;
    return after;
  }
  if (after.currentSeat === actor.seat) return after;

  runtime.athleteRewarded = true;
  after.currentSeat = actor.seat;
  after.round = before.round;
  after.turnNumber = before.turnNumber;
  after.stage = "AWAITING_ROLL";
  after.pendingRolls = ["AUGMENT"];
  after.results = [];
  after.pendingRollChoice = null;
  after.pendingSplitChoice = null;
  after.pendingCaptureChoice = null;
  after.pendingRelocationChoice = null;
  after.pendingStackChoice = null;
  after.lastAction = `${actor.displayName}: 육상선수 · 이번 턴 잡기/업기 없이 이동을 마쳐 추가 던지기!`;
  return after;
}
