import { adjustedResultForGroup, isGroupUsableWithAugments } from "@/lib/augments/effects";
import { legalMoveTargetsWithAugments } from "@/lib/game/engine";
import { getBalanceRuleset } from "@/lib/simulation/rulesets";
import { simulateGame } from "@/lib/simulation/game";

const ruleset = getBalanceRuleset("two-aug-start-r4-special-slots-v2");
const cases = [
  { seed: "1500013", playerCount: 4, label: "P14-A08" },
  { seed: "1500032", playerCount: 4, label: "A15-lock" },
  { seed: "1500206", playerCount: 4, label: "A16-A02" },
  { seed: "1501995", playerCount: 4, label: "A13-G13-backdo" },
] as const;

for (const item of cases) {
  const result = simulateGame({ seed: item.seed, ruleset, playerCount: item.playerCount, maxActions: 20_000 });
  const engine = result.failureDiagnostics?.engine;
  const userId = engine?.players.find((player) => player.seat === engine.currentSeat)?.userId;
  const owned = userId ? (result.failureDiagnostics?.ownedByUser[userId] ?? []) : [];
  const setups = userId ? (result.failureDiagnostics?.setupsByUser[userId] ?? {}) : {};
  const player = userId ? engine?.players.find((candidate) => candidate.userId === userId) : undefined;
  const seen = new Set<string>();
  const groups = (player?.pieces ?? []).filter((piece) => {
    if (seen.has(piece.groupId)) return false;
    seen.add(piece.groupId);
    return piece.status !== "WORMHOLE" && piece.status !== "MARGIN" && piece.status !== "FINISHED";
  });
  const candidateDetails = [];
  if (engine && userId) {
    for (const roll of engine.results) {
      for (const piece of groups) {
        const usable = isGroupUsableWithAugments(engine, userId, piece.groupId, owned, setups);
        const effective = adjustedResultForGroup(engine, userId, piece.groupId, roll, owned, setups);
        let targets: unknown[] = [];
        let targetError: string | null = null;
        try {
          targets = legalMoveTargetsWithAugments(engine, userId, piece, effective, owned, result.failureDiagnostics?.ownedByUser ?? {});
        } catch (error) {
          targetError = error instanceof Error ? error.message : String(error);
        }
        candidateDetails.push({
          result: { id: roll.id, face: roll.face, finalSteps: roll.finalSteps, source: roll.source },
          piece: { id: piece.id, groupId: piece.groupId, status: piece.status, node: piece.node },
          usable,
          effective: { face: effective.face, finalSteps: effective.finalSteps, forbidShortcuts: effective.forbidShortcuts },
          targets,
          targetError,
        });
      }
    }
  }
  console.log(JSON.stringify({
    ...item,
    status: result.status,
    error: result.error,
    round: result.round,
    turnNumber: result.turnNumber,
    userId,
    owned,
    setups,
    candidateDetails,
    augmentRuntime: engine?.augmentRuntime,
    players: engine?.players,
  }));
}
