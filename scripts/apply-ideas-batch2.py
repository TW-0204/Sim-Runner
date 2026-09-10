from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:180]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_all(path: str, old: str, new: str, expected: int):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"Unexpected replacement count in {path}: got {count}, expected {expected}")
    p.write_text(text.replace(old, new), encoding="utf-8")


# Batch 2 intentionally contains only A04/A11/A12.
# A11/A12 still have undecided final tiers in the design document; Gold/Silver here are test-only placements.
replace_once(
    "src/lib/augments/catalog.ts",
    '''  { id: "A05", name: "아수라장", tier: "silver", description: "무작위 Gold 증강 1개를 즉시 획득합니다." },
  { id: "A06", name: "금빛 아수라장", tier: "gold", description: "무작위 Prism 증강 1개를 즉시 획득합니다." },
];''',
    '''  { id: "A04", name: "강해져서 돌아오마", tier: "gold", timing: "first", description: "선택 후 바로 다음 기본 던지기가 끝나면 추가 던지기 1회를 얻고, 다음 증강의 등급이 한 단계 상승합니다." },
  { id: "A05", name: "아수라장", tier: "silver", description: "무작위 Gold 증강 1개를 즉시 획득합니다." },
  { id: "A06", name: "금빛 아수라장", tier: "gold", description: "무작위 Prism 증강 1개를 즉시 획득합니다." },
  { id: "A11", name: "도를 아십니까", tier: "gold", description: "자신의 윷에서는 도가 등장하지 않으며 백도는 그대로 등장합니다. 도의 확률은 개, 걸, 윷, 모에 기존 비율대로 재분배됩니다." },
  { id: "A12", name: "산책로", tier: "silver", description: "외곽의 네 구간 중 하나가 무작위 산책로가 됩니다. 자신의 말이 산책로에서 이동을 시작하면 전진 이동량이 +1칸 증가합니다." },
];''',
)

# Runtime state for A04 and A12.
replace_once(
    "src/lib/game/types.ts",
    '''  athleteAcceleratingGroupId?: string;
  athleteConsecutiveMoves?: number;
''',
    '''  athleteAcceleratingGroupId?: string;
  athleteConsecutiveMoves?: number;
  a04NextBasicBonusPending?: boolean;
  a04UpgradeNextAugment?: boolean;
  walkingTrailSegment?: number;
''',
)

# Offer builder: allow a per-player tier so A04 can upgrade only its owner's next augment.
replace_all(
    "src/lib/augments/server.ts",
    '''  tier: AugmentTier;
  players: PlayerSeed[];
''',
    '''  tier: AugmentTier;
  tierByUser?: Record<string, AugmentTier>;
  players: PlayerSeed[];
''',
    expected=2,
)
replace_all(
    "src/lib/augments/server.ts",
    '''    const ownedIds = args.ownedByUser?.[player.userId] ?? [];
''',
    '''    const ownedIds = args.ownedByUser?.[player.userId] ?? [];
    const playerTier = args.tierByUser?.[player.userId] ?? args.tier;
''',
    expected=2,
)
replace_all(
    "src/lib/augments/server.ts",
    'augment.tier === args.tier',
    'augment.tier === playerTier',
    expected=2,
)
replace_all(
    "src/lib/augments/server.ts",
    '${args.tier}',
    '${playerTier}',
    expected=2,
)
replace_once(
    "src/lib/augments/server.ts",
    '''      tier: args.tier,
      players: args.players,
''',
    '''      tier: args.tier,
      tierByUser: args.tierByUser,
      players: args.players,
''',
)

# A11: DO can never survive the player's final roll transformation.
# BACKDO is untouched; removed DO probability is redistributed across GAE/GEOL/YUT/MO
# using their original relative probabilities (3456:3456:1296:256).
replace_once(
    "src/lib/augments/effects.ts",
    '''export function transformRollFace(
  engine: GameEngineState,
  userId: string,
  face: RollFace,
  source: RollSource,
  ownedIds: string[],
  random: () => number = Math.random,
) {
  if (source === "CAPTURE" && has(ownedIds, "P01")) return "YUT" as RollFace;
  if (source !== "BASIC") return face;

  const controlled = has(ownedIds, "G03") || has(ownedIds, "G04") || has(ownedIds, "G05");
  if (!controlled) return face;

  const runtime = runtimeForPlayer(engine, userId);
  const used = runtime.controlledBasicRollsUsed ?? 0;
  if (has(ownedIds, "G05")) {
    runtime.g05StartRound ??= engine.round;
    if (engine.round >= runtime.g05StartRound + 3) return face;
  } else {
    if (used >= 5) return face;
    runtime.controlledBasicRollsUsed = used + 1;
  }

  if (has(ownedIds, "G03")) return FORWARD_SEQUENCE[used] ?? face;
  if (has(ownedIds, "G04")) return REVERSE_SEQUENCE[used] ?? face;
  if (has(ownedIds, "G05")) return random() < 0.5 ? "MO" : "DO";
  return face;
}
''',
    '''function withoutDo(face: RollFace, ownedIds: string[], random: () => number) {
  if (!has(ownedIds, "A11") || face !== "DO") return face;
  const roll = random() * 0.8464;
  if (roll < 0.3456) return "GAE" as RollFace;
  if (roll < 0.6912) return "GEOL" as RollFace;
  if (roll < 0.8208) return "YUT" as RollFace;
  return "MO" as RollFace;
}

export function transformRollFace(
  engine: GameEngineState,
  userId: string,
  face: RollFace,
  source: RollSource,
  ownedIds: string[],
  random: () => number = Math.random,
) {
  let transformed = face;
  if (source === "CAPTURE" && has(ownedIds, "P01")) {
    transformed = "YUT";
  } else if (source === "BASIC") {
    const controlled = has(ownedIds, "G03") || has(ownedIds, "G04") || has(ownedIds, "G05");
    if (controlled) {
      const runtime = runtimeForPlayer(engine, userId);
      const used = runtime.controlledBasicRollsUsed ?? 0;
      let active = true;
      if (has(ownedIds, "G05")) {
        runtime.g05StartRound ??= engine.round;
        if (engine.round >= runtime.g05StartRound + 3) active = false;
      } else if (used >= 5) {
        active = false;
      } else {
        runtime.controlledBasicRollsUsed = used + 1;
      }

      if (active) {
        if (has(ownedIds, "G03")) transformed = FORWARD_SEQUENCE[used] ?? face;
        else if (has(ownedIds, "G04")) transformed = REVERSE_SEQUENCE[used] ?? face;
        else if (has(ownedIds, "G05")) transformed = random() < 0.5 ? "MO" : "DO";
      }
    }
  }
  return withoutDo(transformed, ownedIds, random);
}
''',
)

# A04 helper: arm once on acquisition, then append exactly one AUGMENT roll behind the next BASIC roll.
replace_once(
    "src/lib/augments/effects.ts",
    '''export function grantsBackdoMoveToken(ownedIds: string[]) {
''',
    '''export function armA04OnAcquisition(engine: GameEngineState, userId: string) {
  const runtime = runtimeForPlayer(engine, userId);
  runtime.a04NextBasicBonusPending = true;
  runtime.a04UpgradeNextAugment = true;
}

export function queueA04BonusForNextBasic(engine: GameEngineState, userId: string, ownedIds: string[]) {
  if (!has(ownedIds, "A04") || engine.stage !== "AWAITING_ROLL" || engine.pendingRolls[0] !== "BASIC") return false;
  const runtime = runtimeForPlayer(engine, userId);
  if (!runtime.a04NextBasicBonusPending) return false;
  runtime.a04NextBasicBonusPending = false;
  engine.pendingRolls.push("AUGMENT");
  return true;
}

export function grantsBackdoMoveToken(ownedIds: string[]) {
''',
)

# A12: one random outer side is stored on acquisition; starting a positive move there grants +1.
replace_once(
    "src/lib/augments/effects.ts",
    '''const REVERSE_SEQUENCE: RollFace[] = ["MO", "YUT", "GEOL", "GAE", "DO"];
''',
    '''const REVERSE_SEQUENCE: RollFace[] = ["MO", "YUT", "GEOL", "GAE", "DO"];
const WALKING_TRAIL_SEGMENTS = [
  new Set([1, 2, 3, 4, 5]),
  new Set([5, 6, 7, 8, 9, 10]),
  new Set([10, 18, 19, 20, 21, 22]),
  new Set([22, 25, 26, 27, 28, 29]),
] as const;
''',
)
replace_once(
    "src/lib/augments/effects.ts",
    '''  if (has(ownedIds, "S06") && representative.status === "WAITING") bonus += 1;
''',
    '''  if (has(ownedIds, "A12") && representative.status === "ON_BOARD" && representative.node != null) {
    const segment = engine.augmentRuntime?.[userId]?.walkingTrailSegment;
    if (segment != null && WALKING_TRAIL_SEGMENTS[segment]?.has(representative.node)) bonus += 1;
  }
  if (has(ownedIds, "S06") && representative.status === "WAITING") bonus += 1;
''',
)

# Simulation acquisition logic for A04 tier upgrade and A12 random side.
replace_once(
    "src/lib/simulation/game.ts",
    '''  adjustedResultForGroup,
  canGrantFaceExtraRoll,
''',
    '''  adjustedResultForGroup,
  armA04OnAcquisition,
  canGrantFaceExtraRoll,
  queueA04BonusForNextBasic,
''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''function immediateReplacementId(
''',
    '''function upgradedAugmentTier(tier: AugmentTier): AugmentTier {
  if (tier === "silver") return "gold";
  if (tier === "gold") return "prism";
  return "prism";
}

function canReceiveA04(context: SimulationContext, eventIndex: number) {
  const nextEvent = context.ruleset.augmentEvents[eventIndex + 1];
  if (!nextEvent) return false;
  const sequence = pickTierSequence(context.seed);
  return sequence[nextEvent.logicalPhase - 1] !== "prism";
}

function immediateReplacementId(
''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''  phase: number,
  sourceId: "A05" | "A06",
''',
    '''  phase: number,
  eventIndex: number,
  sourceId: "A05" | "A06",
''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''    .filter((augment) => augment.id !== "A05" && augment.id !== "A06")
    .filter((augment) => canOffer(augment, phase, ownedIds))
''',
    '''    .filter((augment) => augment.id !== "A05" && augment.id !== "A06")
    .filter((augment) => augment.id !== "A04" || canReceiveA04(context, eventIndex))
    .filter((augment) => canOffer(augment, phase, ownedIds))
''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''    const tier = sequence[event.logicalPhase - 1];
    const excludedIds = context.ruleset.excludedAugmentIdsByLogicalPhase?.[event.logicalPhase];
''',
    '''    const tier = sequence[event.logicalPhase - 1];
    const baseExcludedIds = context.ruleset.excludedAugmentIdsByLogicalPhase?.[event.logicalPhase] ?? [];
    const excludedIds = [...baseExcludedIds, ...(canReceiveA04(context, eventIndex) ? [] : ["A04"])];
    const a04UpgradePendingByUser = Object.fromEntries(context.engine.players.map((player) => [
      player.userId,
      Boolean(context.engine.augmentRuntime?.[player.userId]?.a04UpgradeNextAugment),
    ]));
    const tierByUser = Object.fromEntries(context.engine.players.map((player) => [
      player.userId,
      a04UpgradePendingByUser[player.userId] ? upgradedAugmentTier(tier) : tier,
    ])) as Record<string, AugmentTier>;
''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''      tier,
      players: context.engine.players.map((player) => ({ userId: player.userId, seat: player.seat })),
''',
    '''      tier,
      tierByUser,
      players: context.engine.players.map((player) => ({ userId: player.userId, seat: player.seat })),
''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''        ? immediateReplacementId(context, offer.userId, event.logicalPhase, selectedId)
''',
    '''        ? immediateReplacementId(context, offer.userId, event.logicalPhase, eventIndex, selectedId)
''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''      context.ownedByUser[offer.userId] = upgradeOwnedList(context.ownedByUser[offer.userId] ?? [], acquiredId);
      if (acquiredId === "G16" || acquiredId === "P14") {
''',
    '''      context.ownedByUser[offer.userId] = upgradeOwnedList(context.ownedByUser[offer.userId] ?? [], acquiredId);
      context.engine.augmentRuntime ??= {};
      context.engine.augmentRuntime[offer.userId] ??= {};
      const ideaRuntime = context.engine.augmentRuntime[offer.userId];
      if (a04UpgradePendingByUser[offer.userId]) delete ideaRuntime.a04UpgradeNextAugment;
      if (acquiredId === "A04") armA04OnAcquisition(context.engine, offer.userId);
      if (acquiredId === "A12") ideaRuntime.walkingTrailSegment = context.rng.effect.int(4);
      if (acquiredId === "G16" || acquiredId === "P14") {
''',
)
replace_once(
    "src/lib/simulation/game.ts",
    '''  const actor = currentPlayer(context.engine);
  const userId = actor.userId;

  if (context.engine.stage === "AWAITING_ROLL") {
''',
    '''  const actor = currentPlayer(context.engine);
  const userId = actor.userId;

  if (context.engine.stage === "AWAITING_ROLL") {
    queueA04BonusForNextBasic(context.engine, userId, actorOwned(context, userId));
''',
)

print("Applied ideas batch 2: A04 Strength Return, A11 no-DO redistribution, A12 Walking Trail.")
