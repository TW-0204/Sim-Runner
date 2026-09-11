import type { GameEngineState } from "./types";

export function markAthleteMovement(_engine: GameEngineState, _userId: string, _ownedIds: string[]) {}

export function markAthleteDisqualified(_engine: GameEngineState, _userId: string, _ownedIds: string[]) {}

export function moveOwnedIdsForAthlete(ownedIds: string[]) {
  return ownedIds;
}

export function prepareAthleteCoexistence(
  _engine: GameEngineState,
  _actorUserId: string,
  _actorOwnedIds: string[],
  ownedByUser: Record<string, string[]>,
) {
  return {
    ownedByUser,
    restore: (_nextEngine: GameEngineState) => undefined,
  };
}

export function maybeGrantAthleteExtraRoll(
  _before: GameEngineState,
  after: GameEngineState,
  _actorUserId: string,
  _actorOwnedIds: string[],
) {
  return after;
}
