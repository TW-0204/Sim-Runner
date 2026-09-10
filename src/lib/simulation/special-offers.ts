import { buildSpecialOfferCandidateIds, deterministicInt } from "@/lib/augments/server";

export type SimulationPhaseOffer = { userId: string; offerIds: string[] };

export type SpecialOfferShown = {
  eventIndex: number;
  logicalPhase: 1 | 2 | 3;
  userId: string;
  augmentId: string;
  slot: number;
};

function hitsChance(seed: string, eventIndex: number, logicalPhase: number, chance: number) {
  if (chance <= 0) return false;
  if (chance >= 1) return true;
  const scale = 1_000_000;
  return deterministicInt(`rare-special-hit:${seed}:${eventIndex}:${logicalPhase}`, scale) < Math.floor(chance * scale);
}

export function injectRareSpecialOffer(args: {
  seed: string;
  eventIndex: number;
  logicalPhase: 1 | 2 | 3;
  chance: number;
  offers: SimulationPhaseOffer[];
  ownedByUser: Record<string, string[]>;
  excludedIds?: string[];
}) {
  if (!hitsChance(args.seed, args.eventIndex, args.logicalPhase, args.chance)) {
    return { offers: args.offers, shown: null as SpecialOfferShown | null };
  }

  const eligible = args.offers.flatMap((offer) => {
    const candidateIds = buildSpecialOfferCandidateIds({
      seed: args.seed,
      phase: args.logicalPhase,
      userId: offer.userId,
      ownedIds: args.ownedByUser[offer.userId] ?? [],
      excludedIds: args.excludedIds,
    });
    return candidateIds.length ? [{ offer, candidateIds }] : [];
  });
  if (!eligible.length) return { offers: args.offers, shown: null as SpecialOfferShown | null };

  const playerIndex = deterministicInt(
    `rare-special-player:${args.seed}:${args.eventIndex}:${args.logicalPhase}`,
    eligible.length,
  );
  const target = eligible[playerIndex];
  if (!target) return { offers: args.offers, shown: null as SpecialOfferShown | null };

  const augmentIndex = deterministicInt(
    `rare-special-card:${args.seed}:${args.eventIndex}:${args.logicalPhase}:${target.offer.userId}`,
    target.candidateIds.length,
  );
  const augmentId = target.candidateIds[augmentIndex];
  if (!augmentId) return { offers: args.offers, shown: null as SpecialOfferShown | null };

  const slot = deterministicInt(
    `rare-special-slot:${args.seed}:${args.eventIndex}:${args.logicalPhase}:${target.offer.userId}:${augmentId}`,
    3,
  );
  const offers = args.offers.map((offer) => ({ ...offer, offerIds: [...offer.offerIds] }));
  const targetOffer = offers.find((offer) => offer.userId === target.offer.userId);
  if (!targetOffer || targetOffer.offerIds.length < 3) {
    return { offers: args.offers, shown: null as SpecialOfferShown | null };
  }
  targetOffer.offerIds[slot] = augmentId;

  return {
    offers,
    shown: {
      eventIndex: args.eventIndex,
      logicalPhase: args.logicalPhase,
      userId: target.offer.userId,
      augmentId,
      slot,
    } satisfies SpecialOfferShown,
  };
}
