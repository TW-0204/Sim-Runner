import { createHash } from "node:crypto";

export type SeededRandom = {
  next: () => number;
  int: (maxExclusive: number) => number;
  pick: <T>(items: readonly T[]) => T;
  chance: (probability: number) => boolean;
};

export type SimulationRandomStreams = {
  roll: SeededRandom;
  augment: SeededRandom;
  effect: SeededRandom;
  decision: SeededRandom;
};

function seedToUint32(seed: string) {
  return createHash("sha256").update(seed).digest().readUInt32LE(0);
}

export function createSeededRandom(seed: string): SeededRandom {
  let state = seedToUint32(seed) || 0x6d2b79f5;

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int(maxExclusive) {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new Error(`maxExclusive must be a positive integer: ${maxExclusive}`);
      }
      return Math.floor(next() * maxExclusive);
    },
    pick<T>(items: readonly T[]) {
      if (!items.length) throw new Error("Cannot pick from an empty list.");
      return items[Math.floor(next() * items.length)] as T;
    },
    chance(probability) {
      if (probability <= 0) return false;
      if (probability >= 1) return true;
      return next() < probability;
    },
  };
}

export function createSimulationRandomStreams(seed: string, rulesetId: string): SimulationRandomStreams {
  return {
    // Physical Yut throws intentionally ignore rulesetId so paired rulesets consume the same base roll sequence.
    roll: createSeededRandom(`roll:${seed}`),
    // These streams may consume different counts when rulesets expose different choices/effects.
    augment: createSeededRandom(`augment:${rulesetId}:${seed}`),
    effect: createSeededRandom(`effect:${rulesetId}:${seed}`),
    decision: createSeededRandom(`decision:${rulesetId}:${seed}`),
  };
}
