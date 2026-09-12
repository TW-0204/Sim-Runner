# Balance Diagnostics

## Game result classification

Simulation outcomes are intentionally separated so a round cap is not reported as a normal draw.

- `COMPLETED`: a winner was determined.
- `DRAW`: reserved for a future rules-level draw. The current balance ruleset does not normally produce this status.
- `LONG_GAME`: the configured round cap was exceeded without a winner.
- `STALLED`: simulation or game progression raised an error and could not continue.
- `ACTION_LIMIT`: the action safety cap was reached.

For balance review, use these duration bands in addition to win rate:

- 1-15 rounds: normal target window
- 16-20 rounds: long
- 21-30 rounds: very long
- over 30 rounds: round-cap problem candidate (`LONG_GAME` when the cap is 30)

`LONG_GAME`, `STALLED`, and `ACTION_LIMIT` are all problem-game signals, but they must remain separate because their causes are different.

## Long-game audit

`scripts/long-game-diagnose.ts` records 15/20/30-round rates by player count and augment ownership. A game that reaches the 30-round cap is rerun to an extended cap so we can distinguish:

1. a game that simply ends somewhat late,
2. a severe long game,
3. an actual progression/stall problem.

`scripts/long-game-merge.ts` merges independent batches and ranks augments by association with long games. Association is diagnostic evidence, not proof that the augment caused the long game.

## Cause diagnostic for a single augment

`scripts/augment-diagnostic-run.ts` runs paired same-seed simulations.

Treatment:

- the target augment is forced into a valid acquisition context,
- the natural card-selection RNG draw is still consumed before the force is applied.

Control:

- the same seed is run with the normal natural card selection.

This keeps the augment-selection RNG stream aligned at the intervention point. The game can still diverge afterwards because the augment changes decisions, state, legal actions, and later random-event eligibility. The result should therefore be interpreted as a paired gameplay-control estimate, not as a mathematically pure isolated treatment effect.

The report compares:

- owner win rate versus the same seat in control,
- paired win gains and losses,
- 15/20-round long-game rates,
- target trigger count and win rate by trigger bucket,
- captures,
- pieces lost back to waiting,
- pieces finished,
- average game round.

## Running a future augment diagnosis

Update `diagnostics/augment-request.json` with a canonical `AUG-###` ID, sample count, and max round cap. The `Augment Cause Diagnostic` workflow runs automatically on that request change and stores JSON and Markdown artifacts.

Use this workflow after a natural balance scan identifies an abnormal win rate. Do not decide a numeric buff or nerf from win rate alone. Check at least:

1. player-count scaling,
2. acquisition timing,
3. trigger frequency,
4. paired win delta,
5. duration effect,
6. captures/losses/finishes,
7. special-win contribution where applicable.
