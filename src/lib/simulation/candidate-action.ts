export type CandidateAction<TState> = {
  key: string;
  action: string;
  augmentId?: string;
  payload: Record<string, unknown>;
  execute: () => TState;
  evaluate?: () => number;
};

export type RankedCandidateAction<TState> = {
  candidate: CandidateAction<TState>;
  previewState?: TState;
  score: number;
};

export type ResolvedCandidateAction<TState> = {
  candidate: CandidateAction<TState>;
  state: TState;
  score: number;
};

export function rankCandidateActions<TState>(
  input: readonly CandidateAction<TState>[],
  options: { scoreState: (state: TState) => number },
): RankedCandidateAction<TState>[] {
  const unique = new Map<string, CandidateAction<TState>>();
  for (const candidate of input) {
    if (!unique.has(candidate.key)) unique.set(candidate.key, candidate);
  }

  const ranked: RankedCandidateAction<TState>[] = [];
  for (const candidate of unique.values()) {
    try {
      if (candidate.evaluate) {
        const score = candidate.evaluate();
        if (Number.isFinite(score)) ranked.push({ candidate, score });
        continue;
      }
      const previewState = candidate.execute();
      const score = options.scoreState(previewState);
      if (Number.isFinite(score)) ranked.push({ candidate, previewState, score });
    } catch {
      // Authoritative game execution is the legality filter.
    }
  }

  ranked.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.candidate.key.localeCompare(right.candidate.key);
  });
  return ranked;
}

export function resolveCandidateActions<TState>(
  input: readonly CandidateAction<TState>[],
  options: { scoreState: (state: TState) => number },
): ResolvedCandidateAction<TState> | null {
  const best = rankCandidateActions(input, options)[0];
  if (!best) return null;
  try {
    return {
      candidate: best.candidate,
      state: best.previewState ?? best.candidate.execute(),
      score: best.score,
    };
  } catch {
    return null;
  }
}
