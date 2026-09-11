import { createHash } from "node:crypto";
import { AUGMENTS, AUGMENT_BY_ID, augmentRandomizationKey, type AugmentDefinition, type AugmentTier } from "./catalog";

const TIER_SEQUENCES: Array<{ tiers: [AugmentTier, AugmentTier, AugmentTier]; weight: number }> = [
  { tiers: ["gold", "gold", "gold"], weight: 22 },
  { tiers: ["gold", "silver", "gold"], weight: 18 },
  { tiers: ["silver", "gold", "gold"], weight: 12 },
  { tiers: ["gold", "prism", "gold"], weight: 10 },
  { tiers: ["gold", "prism", "silver"], weight: 6 },
  { tiers: ["silver", "silver", "gold"], weight: 5 },
  { tiers: ["silver", "silver", "prism"], weight: 5 },
  { tiers: ["silver", "gold", "prism"], weight: 5 },
  { tiers: ["prism", "silver", "gold"], weight: 4 },
  { tiers: ["gold", "gold", "prism"], weight: 3 },
  { tiers: ["gold", "silver", "prism"], weight: 2 },
  { tiers: ["prism", "gold", "gold"], weight: 2 },
  { tiers: ["silver", "prism", "prism"], weight: 1 },
  { tiers: ["gold", "prism", "prism"], weight: 1 },
  { tiers: ["prism", "silver", "prism"], weight: 1 },
  { tiers: ["prism", "gold", "prism"], weight: 1 },
  { tiers: ["prism", "prism", "gold"], weight: 1 },
  { tiers: ["prism", "prism", "prism"], weight: 1 },
];

type PlayerSeed = { userId: string; seat: number };

export const SPECIAL_AUGMENT_IDS = new Set(["AUG-031", "AUG-032", "AUG-033", "AUG-041", "AUG-042"]);
export const QUEST_SPECIAL_MAX_GAME_EXPOSURE = 0.10;
export const MOONWALK_SPECIAL_MAX_GAME_EXPOSURE = 0.025;

const SOLO_RUNNER_ZERO_EFFECT = new Set([
  "AUG-002",
  "AUG-005",
  "AUG-008",
  "AUG-015",
  "AUG-022",
  "AUG-023",
  "AUG-024",
  "AUG-026",
  "AUG-061",
  "AUG-038",
  "AUG-065",
  "AUG-066",
]);

export function deterministicInt(key: string, modulo: number) {
  if (modulo <= 0) return 0;
  const digest = createHash("sha256").update(key).digest();
  return digest.readUInt32BE(0) % modulo;
}

function deterministicChance(key: string, chance: number) {
  const normalized = Math.max(0, Math.min(1, chance));
  if (normalized <= 0) return false;
  if (normalized >= 1) return true;
  const digest = createHash("sha256").update(key).digest();
  const roll = digest.readUInt32BE(0) / 0x1_0000_0000;
  return roll < normalized;
}

export function chancePerDrawForMaxGameExposure(maxExposure: number, playerCount: number, drawsPerPlayer = 6) {
  if (maxExposure <= 0 || playerCount <= 0 || drawsPerPlayer <= 0) return 0;
  if (maxExposure >= 1) return 1;
  return 1 - Math.pow(1 - maxExposure, 1 / (playerCount * drawsPerPlayer));
}

export function specialChancePerDrawForPhase(phase: number, playerCount: number) {
  if (phase === 1) return chancePerDrawForMaxGameExposure(QUEST_SPECIAL_MAX_GAME_EXPOSURE, playerCount);
  if (phase === 3) return chancePerDrawForMaxGameExposure(MOONWALK_SPECIAL_MAX_GAME_EXPOSURE, playerCount);
  return 0;
}

export function pickTierSequence(seed: string): [AugmentTier, AugmentTier, AugmentTier] {
  const roll = deterministicInt(`tier-sequence:${seed}`, 100);
  let cursor = 0;
  for (const entry of TIER_SEQUENCES) {
    cursor += entry.weight;
    if (roll < cursor) return entry.tiers;
  }
  return TIER_SEQUENCES[0].tiers;
}

function isStructurallyImpossible(augment: AugmentDefinition, ownedIds: string[]) {
  if (augment.id === "AUG-008" && ownedIds.some((id) => SPECIAL_AUGMENT_IDS.has(id))) return true;
  if (ownedIds.includes("AUG-041") && SOLO_RUNNER_ZERO_EFFECT.has(augment.id)) return true;
  return false;
}

export function canOffer(augment: AugmentDefinition, phase: number, ownedIds: string[]) {
  if (augment.timing === "first" && phase !== 1) return false;
  if (augment.timing === "last" && phase !== 3) return false;
  if (augment.timing === "not-last" && phase === 3) return false;
  if (ownedIds.includes(augment.id)) return false;
  if (augment.requires && !ownedIds.includes(augment.requires)) return false;

  const owned = ownedIds.map((id) => AUGMENT_BY_ID.get(id)).filter(Boolean) as AugmentDefinition[];
  if (augment.special && owned.some((item) => item.special)) return false;
  if (augment.conflicts?.some((id) => ownedIds.includes(id))) return false;
  if (isStructurallyImpossible(augment, ownedIds)) return false;

  if (augment.family) {
    const sameFamily = owned.filter((item) => item.family === augment.family);
    if (sameFamily.some((item) => item.id !== augment.requires)) return false;
  }

  return true;
}

function deterministicCandidate(candidates: AugmentDefinition[], key: string) {
  return [...candidates].sort((a, b) => {
    const aHash = createHash("sha256").update(`${key}:${augmentRandomizationKey(a.id)}`).digest("hex");
    const bHash = createHash("sha256").update(`${key}:${augmentRandomizationKey(b.id)}`).digest("hex");
    return aHash.localeCompare(bHash);
  })[0] ?? null;
}

export function buildSpecialOfferCandidateIds(args: {
  seed: string;
  phase: number;
  userId: string;
  ownedIds?: string[];
  excludedIds?: string[];
}) {
  const ownedIds = args.ownedIds ?? [];
  const excludedIds = new Set(args.excludedIds ?? []);
  return AUGMENTS
    .filter((augment) => augment.special)
    .filter((augment) => !excludedIds.has(augment.id))
    .filter((augment) => canOffer(augment, args.phase, ownedIds))
    .sort((a, b) => {
      const aHash = createHash("sha256")
        .update(`${args.seed}:special:${args.phase}:${args.userId}:${augmentRandomizationKey(a.id)}`)
        .digest("hex");
      const bHash = createHash("sha256")
        .update(`${args.seed}:special:${args.phase}:${args.userId}:${augmentRandomizationKey(b.id)}`)
        .digest("hex");
      return aHash.localeCompare(bHash);
    })
    .map((augment) => augment.id);
}

function buildSlotPhaseOffers(args: {
  seed: string;
  phase: number;
  tier: AugmentTier;
  tierByUser?: Record<string, AugmentTier>;
  players: PlayerSeed[];
  ownedByUser?: Record<string, string[]>;
  excludedIds?: string[];
  excludedIdsByUser?: Record<string, string[]>;
  specialChancePerDraw: number;
}) {
  const reservedUnique = new Set<string>();
  const sortedPlayers = [...args.players].sort((a, b) => a.seat - b.seat);
  const initialByUser = new Map<string, string[]>();

  const draw = (player: PlayerSeed, drawIndex: number, additionalExcluded: Set<string>) => {
    const ownedIds = args.ownedByUser?.[player.userId] ?? [];
    const playerTier = args.tierByUser?.[player.userId] ?? args.tier;
    const excluded = new Set([
      ...(args.excludedIds ?? []),
      ...(args.excludedIdsByUser?.[player.userId] ?? []),
      ...additionalExcluded,
    ]);
    const available = (augment: AugmentDefinition) => (
      !excluded.has(augment.id)
      && canOffer(augment, args.phase, ownedIds)
      && (!augment.uniquePerGame || !reservedUnique.has(augment.id))
    );

    const normalCandidates = AUGMENTS
      .filter((augment) => !augment.special && augment.tier === playerTier)
      .filter(available);
    const specialCandidates = AUGMENTS
      .filter((augment) => augment.special)
      .filter(available);

    const wantsSpecial = deterministicChance(
      `slot-special:${args.seed}:${args.phase}:${player.userId}:${drawIndex}`,
      args.specialChancePerDraw,
    );
    const key = `slot-card:${args.seed}:${args.phase}:${player.userId}:${drawIndex}`;
    const selected = wantsSpecial
      ? deterministicCandidate(specialCandidates, `${key}:special`) ?? deterministicCandidate(normalCandidates, `${key}:normal-fallback`)
      : deterministicCandidate(normalCandidates, `${key}:normal`);

    if (!selected) {
      throw new Error(`Not enough ${playerTier} augments for player ${player.userId} in phase ${args.phase}.`);
    }
    if (selected.uniquePerGame) reservedUnique.add(selected.id);
    return selected.id;
  };

  // The first three visible cards are distinct. Different Special cards may coexist.
  for (const player of sortedPlayers) {
    const initial: string[] = [];
    for (let slot = 0; slot < 3; slot += 1) {
      const id = draw(player, slot, new Set(initial));
      initial.push(id);
    }
    initialByUser.set(player.userId, initial);
  }

  // A reroll excludes only the card it replaces in that slot.
  // It may match another visible card, and Special <-> normal transitions are allowed.
  const result: Array<{ userId: string; offerIds: string[] }> = [];
  for (const player of sortedPlayers) {
    const initial = initialByUser.get(player.userId) ?? [];
    const rerolls = initial.map((previousId, slot) => draw(player, slot + 3, new Set([previousId])));
    result.push({ userId: player.userId, offerIds: [...initial, ...rerolls] });
  }
  return result;
}

export function buildPhaseOffers(args: {
  seed: string;
  phase: number;
  tier: AugmentTier;
  tierByUser?: Record<string, AugmentTier>;
  players: PlayerSeed[];
  ownedByUser?: Record<string, string[]>;
  excludedIds?: string[];
  excludedIdsByUser?: Record<string, string[]>;
  excludeSpecial?: boolean;
  specialChancePerDraw?: number;
}) {
  if (args.specialChancePerDraw != null) {
    return buildSlotPhaseOffers({
      seed: args.seed,
      phase: args.phase,
      tier: args.tier,
      tierByUser: args.tierByUser,
      players: args.players,
      ownedByUser: args.ownedByUser,
      excludedIds: args.excludedIds,
      excludedIdsByUser: args.excludedIdsByUser,
      specialChancePerDraw: args.specialChancePerDraw,
    });
  }

  const reservedUnique = new Set<string>();
  const sortedPlayers = [...args.players].sort((a, b) => a.seat - b.seat);
  const result: Array<{ userId: string; offerIds: string[] }> = [];

  for (const player of sortedPlayers) {
    const ownedIds = args.ownedByUser?.[player.userId] ?? [];
    const playerTier = args.tierByUser?.[player.userId] ?? args.tier;
    const excludedIds = new Set([
      ...(args.excludedIds ?? []),
      ...(args.excludedIdsByUser?.[player.userId] ?? []),
    ]);
    const candidates = AUGMENTS
      .filter((augment) => augment.tier === playerTier)
      .filter((augment) => !args.excludeSpecial || !augment.special)
      .filter((augment) => !excludedIds.has(augment.id))
      .filter((augment) => canOffer(augment, args.phase, ownedIds))
      .filter((augment) => !augment.uniquePerGame || !reservedUnique.has(augment.id))
      .sort((a, b) => {
        const aHash = createHash("sha256")
          .update(`${args.seed}:${args.phase}:${player.userId}:${augmentRandomizationKey(a.id)}`)
          .digest("hex");
        const bHash = createHash("sha256")
          .update(`${args.seed}:${args.phase}:${player.userId}:${augmentRandomizationKey(b.id)}`)
          .digest("hex");
        return aHash.localeCompare(bHash);
      });

    const offerIds: string[] = [];
    for (const augment of candidates) {
      if (offerIds.length >= 6) break;
      offerIds.push(augment.id);
      if (augment.uniquePerGame) reservedUnique.add(augment.id);
    }

    if (offerIds.length < 6) {
      throw new Error(`Not enough ${playerTier} augments for player ${player.userId} in phase ${args.phase}.`);
    }

    result.push({ userId: player.userId, offerIds });
  }

  return result;
}

export function visibleOfferIds(offerIds: string[], rerolledSlots: boolean[]) {
  return [0, 1, 2].map((slot) => (rerolledSlots[slot] ? offerIds[slot + 3] : offerIds[slot]));
}

export function timeoutChoice(seed: string, phase: number, userId: string, visibleIds: string[]) {
  return visibleIds[deterministicInt(`timeout:${seed}:${phase}:${userId}`, visibleIds.length)] ?? visibleIds[0];
}
