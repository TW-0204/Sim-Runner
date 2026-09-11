from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:200]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_all(path: str, old: str, new: str, expected: int):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"Unexpected replacement count in {path}: got {count}, expected {expected}")
    p.write_text(text.replace(old, new), encoding="utf-8")


# Batch 3 intentionally contains only A09/A10.
# Their final tiers are undecided in the design document; Silver/Gold are test-only placements.
replace_once(
    "src/lib/augments/catalog.ts",
    '''  { id: "A06", name: "금빛 아수라장", tier: "gold", description: "무작위 Prism 증강 1개를 즉시 획득합니다." },
  { id: "A11", name: "도를 아십니까", tier: "gold", description: "자신의 윷에서는 도가 등장하지 않으며 백도는 그대로 등장합니다. 도의 확률은 개, 걸, 윷, 모에 기존 비율대로 재분배됩니다." },''',
    '''  { id: "A06", name: "금빛 아수라장", tier: "gold", description: "무작위 Prism 증강 1개를 즉시 획득합니다." },
  { id: "A09", name: "메아리", tier: "silver", timing: "first", description: "가장 먼저 완주한 자신의 말의 경로 선택을 저장합니다. 다음으로 새롭게 출발하는 자신의 말 1기는 같은 갈림길 경로를 따라갑니다." },
  { id: "A10", name: "배반", tier: "gold", description: "자신의 대기 중인 말 1기를 무작위 상대 플레이어의 소유로 변경합니다." },
  { id: "A11", name: "도를 아십니까", tier: "gold", description: "자신의 윷에서는 도가 등장하지 않으며 백도는 그대로 등장합니다. 도의 확률은 개, 걸, 윷, 모에 기존 비율대로 재분배됩니다." },''',
)

# A09 runtime: save branch decisions from the first finisher and bind the next departing piece.
replace_once(
    "src/lib/game/types.ts",
    '''  a04UpgradeNextAugment?: boolean;
  walkingTrailSegment?: number;
''',
    '''  a04UpgradeNextAugment?: boolean;
  walkingTrailSegment?: number;
  echoRouteCaptured?: boolean;
  echoBranchChoices?: Record<string, number>;
  echoSourcePieceId?: string;
  echoFollowerPieceId?: string;
  echoCompleted?: boolean;
''',
)

# A09 helpers and A10 ownership transfer live in effects while the ideas remain experimental.
replace_once(
    "src/lib/augments/effects.ts",
    '''export function grantsBackdoMoveToken(ownedIds: string[]) {
''',
    '''const ECHO_BRANCH_OPTIONS = new Map<number, Set<number>>([
  [5, new Set([6, 13])],
  [10, new Set([18, 11])],
  [15, new Set([16, 23])],
]);

function echoBranchChoicesFromHistory(history: number[]) {
  const choices: Record<string, number> = {};
  for (let index = 0; index + 1 < history.length; index += 1) {
    const node = history[index];
    const next = history[index + 1];
    const valid = ECHO_BRANCH_OPTIONS.get(node);
    if (!valid?.has(next) || choices[String(node)] != null) continue;
    choices[String(node)] = next;
  }
  return choices;
}

function groupContainsPiece(engine: GameEngineState, userId: string, groupId: string, pieceId: string) {
  const player = engine.players.find((candidate) => candidate.userId === userId);
  return Boolean(player?.pieces.some((piece) => piece.id === pieceId && piece.groupId === groupId));
}

export function echoAllowsForwardPath(
  engine: GameEngineState,
  userId: string,
  piece: PieceState,
  startNode: number,
  traversed: number[],
  ownedIds: string[],
) {
  if (!has(ownedIds, "A09") || has(ownedIds, "P02")) return true;
  const runtime = engine.augmentRuntime?.[userId];
  if (!runtime?.echoRouteCaptured || runtime.echoCompleted) return true;

  const followerId = runtime.echoFollowerPieceId;
  const affected = followerId
    ? groupContainsPiece(engine, userId, piece.groupId, followerId)
    : piece.status === "WAITING";
  if (!affected) return true;

  const choices = runtime.echoBranchChoices ?? {};
  const nodes = [startNode, ...traversed];
  for (let index = 0; index + 1 < nodes.length; index += 1) {
    const requiredNext = choices[String(nodes[index])];
    if (requiredNext != null && nodes[index + 1] !== requiredNext) return false;
  }
  return true;
}

export function armEchoFollowerForDeparture(
  engine: GameEngineState,
  userId: string,
  groupId: string,
  startedWaiting: boolean,
  ownedIds: string[],
) {
  if (!has(ownedIds, "A09") || has(ownedIds, "P02") || !startedWaiting) return;
  const runtime = runtimeForPlayer(engine, userId);
  if (!runtime.echoRouteCaptured || runtime.echoCompleted || runtime.echoFollowerPieceId) return;
  const player = engine.players.find((candidate) => candidate.userId === userId);
  const piece = player?.pieces.find((candidate) => candidate.groupId === groupId && candidate.status === "WAITING");
  if (piece) runtime.echoFollowerPieceId = piece.id;
}

export function recordEchoFinish(
  engine: GameEngineState,
  userId: string,
  groupId: string,
  finished: boolean,
  ownedIds: string[],
) {
  if (!finished || !has(ownedIds, "A09") || has(ownedIds, "P02")) return;
  const runtime = runtimeForPlayer(engine, userId);
  const player = engine.players.find((candidate) => candidate.userId === userId);
  const group = player?.pieces.filter((piece) => piece.groupId === groupId) ?? [];
  if (!group.length) return;

  if (!runtime.echoRouteCaptured) {
    const source = group[0];
    runtime.echoRouteCaptured = true;
    runtime.echoSourcePieceId = source.id;
    runtime.echoBranchChoices = echoBranchChoicesFromHistory(source.pathHistory);
    return;
  }

  const followerId = runtime.echoFollowerPieceId;
  if (followerId && group.some((piece) => piece.id === followerId)) runtime.echoCompleted = true;
}

export function applyBetrayalTransfer(
  engineInput: GameEngineState,
  sourceUserId: string,
  random: () => number = Math.random,
) {
  const engine = structuredClone(engineInput);
  const source = engine.players.find((player) => player.userId === sourceUserId);
  if (!source) throw new Error("배반 소유자를 찾지 못했습니다.");
  const waiting = source.pieces.filter((piece) => piece.status === "WAITING");
  if (!waiting.length) throw new Error("배반으로 넘길 대기 중인 말이 없습니다.");
  const opponents = engine.players.filter((player) => player.userId !== sourceUserId);
  if (!opponents.length) throw new Error("배반으로 말을 받을 상대가 없습니다.");

  const piece = waiting[Math.floor(random() * waiting.length)] ?? waiting[0];
  const recipient = opponents[Math.floor(random() * opponents.length)] ?? opponents[0];
  const index = source.pieces.findIndex((candidate) => candidate.id === piece.id);
  if (index < 0) throw new Error("배반 대상 말을 찾지 못했습니다.");
  const [transferred] = source.pieces.splice(index, 1);
  if (!transferred) throw new Error("배반 대상 말을 옮기지 못했습니다.");

  transferred.ownerUserId = recipient.userId;
  transferred.seat = recipient.seat;
  transferred.status = "WAITING";
  transferred.node = null;
  transferred.groupId = transferred.id;
  transferred.hasEntered = false;
  transferred.pathHistory = [];
  recipient.pieces.push(transferred);

  const sourceRuntime = engine.augmentRuntime?.[sourceUserId];
  if (sourceRuntime?.echoFollowerPieceId === transferred.id) sourceRuntime.echoCompleted = true;

  return { engine, transferredPieceId: transferred.id, recipientUserId: recipient.userId };
}

export function grantsBackdoMoveToken(ownedIds: string[]) {
''',
)

# A09 integration: constrain forward branch choices, bind the follower on departure, and capture/complete the echo route.
replace_once(
    "src/lib/game/engine.ts",
    '''  adjustedResultForGroup,
  applyWaterGhostOne,
''',
    '''  adjustedResultForGroup,
  applyWaterGhostOne,
  armEchoFollowerForDeparture,
''',
)
replace_once(
    "src/lib/game/engine.ts",
    '''  finalStepsForRoll,
  firstForwardPathInterruption,
''',
    '''  echoAllowsForwardPath,
  finalStepsForRoll,
  firstForwardPathInterruption,
''',
)
replace_once(
    "src/lib/game/engine.ts",
    '''  recordCaptureAgainstPlayer,
  recordEnemyCaptures,
''',
    '''  recordCaptureAgainstPlayer,
  recordEchoFinish,
  recordEnemyCaptures,
''',
)
replace_once(
    "src/lib/game/engine.ts",
    '''  const movements = forwardMoveOptions(start, result.finalSteps, {
    forbidShortcutEntry: result.forbidShortcuts,
    allowPassingShortcutEntry: ownedIds.includes("P09"),
    allowUniversalCenterChoice: ownedIds.includes("P04"),
  });
  const plans: ForwardTargetPlan[] = [];

  for (const movement of movements) {
''',
    '''  const movements = forwardMoveOptions(start, result.finalSteps, {
    forbidShortcutEntry: result.forbidShortcuts,
    allowPassingShortcutEntry: ownedIds.includes("P09"),
    allowUniversalCenterChoice: ownedIds.includes("P04"),
  });
  const echoMovements = movements.filter((movement) => (
    echoAllowsForwardPath(engine, userId, piece, start, movement.traversed, ownedIds)
  ));
  // If another effect makes the stored route impossible, that forced route takes priority.
  const routedMovements = echoMovements.length > 0 ? echoMovements : movements;
  const plans: ForwardTargetPlan[] = [];

  for (const movement of routedMovements) {
''',
)
replace_once(
    "src/lib/game/engine.ts",
    '''  const representative = group[0];
  const movementStartNode = moonwalk && representative.status === "FINISHED"
    ? FINISH_NODE
    : representative.status === "WAITING" ? 0 : (representative.node ?? 0);
  const effectiveResult = adjustedMoonwalkResult(engine, mover.userId, args.groupId, result, ownedIds, setups);
''',
    '''  const representative = group[0];
  const startedWaiting = representative.status === "WAITING";
  const movementStartNode = moonwalk && representative.status === "FINISHED"
    ? FINISH_NODE
    : startedWaiting ? 0 : (representative.node ?? 0);
  if (!moonwalk) armEchoFollowerForDeparture(engine, mover.userId, args.groupId, startedWaiting, ownedIds);
  const effectiveResult = adjustedMoonwalkResult(engine, mover.userId, args.groupId, result, ownedIds, setups);
''',
)
replace_once(
    "src/lib/game/engine.ts",
    '''  engine.results.splice(resultIndex, 1);
''',
    '''  if (!moonwalk) recordEchoFinish(engine, mover.userId, args.groupId, finished, ownedIds);
  engine.results.splice(resultIndex, 1);
''',
)

# Offer builder: A10 is unavailable to a player who has no waiting piece at that acquisition event.
replace_all(
    "src/lib/augments/server.ts",
    '''  ownedByUser?: Record<string, string[]>;
  excludedIds?: string[];
''',
    '''  ownedByUser?: Record<string, string[]>;
  excludedIds?: string[];
  excludedIdsByUser?: Record<string, string[]>;
''',
    expected=2,
)
replace_once(
    "src/lib/augments/server.ts",
    '''    const excluded = new Set([...(args.excludedIds ?? []), ...additionalExcluded]);
''',
    '''    const excluded = new Set([
      ...(args.excludedIds ?? []),
      ...(args.excludedIdsByUser?.[player.userId] ?? []),
      ...additionalExcluded,
    ]);
''',
)
replace_once(
    "src/lib/augments/server.ts",
    '''      ownedByUser: args.ownedByUser,
      excludedIds: args.excludedIds,
      specialChancePerDraw: args.specialChancePerDraw,
''',
    '''      ownedByUser: args.ownedByUser,
      excludedIds: args.excludedIds,
      excludedIdsByUser: args.excludedIdsByUser,
      specialChancePerDraw: args.specialChancePerDraw,
''',
)
replace_once(
    "src/lib/augments/server.ts",
    '''    const excludedIds = new Set(args.excludedIds ?? []);
''',
    '''    const excludedIds = new Set([
      ...(args.excludedIds ?? []),
      ...(args.excludedIdsByUser?.[player.userId] ?? []),
    ]);
''',
)

# Simulation acquisition logic for A10, including setup repair if the transferred waiting piece was a designated G16/P14 piece.
replace_once(
    "src/lib/simulation/game.ts",
    '''  adjustedResultForGroup,
  armA04OnAcquisition,
''',
    '''  adjustedResultForGroup,
  applyBetrayalTransfer,
  armA04OnAcquisition,
''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''function upgradedAugmentTier(tier: AugmentTier): AugmentTier {
''',
    '''function playerHasWaitingPiece(context: SimulationContext, userId: string) {
  return Boolean(context.engine.players.find((player) => player.userId === userId)?.pieces.some((piece) => piece.status === "WAITING"));
}

function repairTransferredSetup(context: SimulationContext, sourceUserId: string, transferredPieceId: string) {
  const setups = context.setupsByUser[sourceUserId];
  if (!setups) return;
  const source = context.engine.players.find((player) => player.userId === sourceUserId);
  const replacementId = source?.pieces[0]?.id;
  for (const augmentId of ["G16", "P14"] as const) {
    if (setups[augmentId]?.pieceId !== transferredPieceId) continue;
    if (replacementId) setups[augmentId] = { pieceId: replacementId };
    else delete setups[augmentId];
  }
}

function upgradedAugmentTier(tier: AugmentTier): AugmentTier {
''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''    .filter((augment) => augment.id !== "A04" || canReceiveA04(context, eventIndex))
    .filter((augment) => canOffer(augment, phase, ownedIds))
''',
    '''    .filter((augment) => augment.id !== "A04" || canReceiveA04(context, eventIndex))
    .filter((augment) => augment.id !== "A10" || playerHasWaitingPiece(context, userId))
    .filter((augment) => canOffer(augment, phase, ownedIds))
''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''    const excludedIds = [...baseExcludedIds, ...(canReceiveA04(context, eventIndex) ? [] : ["A04"])];
    const a04UpgradePendingByUser = Object.fromEntries(context.engine.players.map((player) => [
''',
    '''    const excludedIds = [...baseExcludedIds, ...(canReceiveA04(context, eventIndex) ? [] : ["A04"])];
    const excludedIdsByUser = Object.fromEntries(context.engine.players.map((player) => [
      player.userId,
      player.pieces.some((piece) => piece.status === "WAITING") ? [] : ["A10"],
    ]));
    const a04UpgradePendingByUser = Object.fromEntries(context.engine.players.map((player) => [
''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''      tierByUser,
      players: context.engine.players.map((player) => ({ userId: player.userId, seat: player.seat })),
''',
    '''      tierByUser,
      players: context.engine.players.map((player) => ({ userId: player.userId, seat: player.seat })),
      excludedIdsByUser,
''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''      if (acquiredId === "A04") armA04OnAcquisition(context.engine, offer.userId);
      if (acquiredId === "A12") ideaRuntime.walkingTrailSegment = context.rng.effect.int(4);
      if (acquiredId === "G16" || acquiredId === "P14") {
''',
    '''      if (acquiredId === "A04") armA04OnAcquisition(context.engine, offer.userId);
      if (acquiredId === "A12") ideaRuntime.walkingTrailSegment = context.rng.effect.int(4);
      if (acquiredId === "A10") {
        const betrayal = applyBetrayalTransfer(context.engine, offer.userId, context.rng.effect.next);
        context.engine = betrayal.engine;
        repairTransferredSetup(context, offer.userId, betrayal.transferredPieceId);
      }
      if (acquiredId === "G16" || acquiredId === "P14") {
''',
)

print("Applied ideas batch 3: A09 Echo route binding and A10 Betrayal ownership transfer.")
