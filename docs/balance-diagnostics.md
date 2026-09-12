# Balance Diagnostics

## Game result classification

Simulation outcomes are intentionally separated so a round cap is not reported as a normal draw.

- `COMPLETED`: a winner was determined.
- `DRAW`: reserved for a future rules-level draw. The current balance ruleset does not normally produce this status.
- `LONG_GAME`: the configured round cap was exceeded without a winner.
- `STALLED`: simulation or game progression raised an error and could not continue.
- `ACTION_LIMIT`: the action safety cap was reached.

For balance review, use these duration bands as descriptive diagnostics, not as target game lengths:

- 1-15 rounds: early completion band
- 16-20 rounds: middle duration band
- 21-30 rounds: long-tail band
- over 30 rounds: extended-tail candidate (`LONG_GAME` when the cap is 30)

Do not classify a game as unhealthy merely because it exceeds 15 rounds. In a no-augment control audit, average game length was 16.75 rounds at 2 players, 17.84 at 3 players, and 18.26 at 4 players. The corresponding augment-enabled baseline was approximately 14.6-14.7 rounds. The bands are therefore for comparison and tail diagnosis, not a pass/fail balance target.

`LONG_GAME`, `STALLED`, and `ACTION_LIMIT` are all problem-game signals, but they must remain separate because their causes are different. A `LONG_GAME` is not automatically an engine failure: extended-cap reruns must determine whether it eventually completes normally.

## Long-game audit

`scripts/long-game-diagnose.ts` records 15/20/30-round rates by player count and augment ownership. A game that reaches the 30-round cap is rerun to an extended cap so we can distinguish:

1. a game that simply ends somewhat late,
2. a severe long game,
3. an actual progression/stall problem.

The 90,000-game extended audit found 750 games over 30 rounds (0.83%). All 750 completed by the 100-round extended cap. Treat this as a long-tail reference, not evidence of a progression deadlock.

A direct 6,000-seed comparison between the pre-diagnostics baseline and diagnostics implementation produced the same 40 over-30-round seeds in both versions. This confirms that the diagnostics instrumentation itself did not change natural simulation behavior in the investigated batch.

`scripts/long-game-merge.ts` merges independent batches and ranks augments by association with long games. Association is diagnostic evidence, not proof that the augment caused the long game.

## Bot policy baseline and capture sensitivity

The official balance bot remains `balance-bot-v0.2.1`.

The current move utility assigns +85 for each enemy piece captured. A sensitivity policy was tested where this capture value is divided by the number of opponents: 85 in 2-player, 42.5 in 3-player, and about 28.3 in 4-player games.

This alternative policy shortens many 3-player and 4-player games, but there is no real-player telemetry yet proving that its decision pattern is more human-like. It also changes the measured magnitude of some capture-sensitive augments. For continuity and reproducibility, it is therefore a sensitivity lane only and must not replace the official baseline without separate evidence.

A 400-pair same-seed audit per context produced these paired win-delta comparisons:

| Augment | Context | Official v0.2.1 | Player-scaled capture | Interpretation |
| --- | --- | ---: | ---: | --- |
| AUG-025 추격자 | first, 3P | -4.50%p | -9.00%p | weak under both |
| AUG-025 추격자 | first, 4P | -8.50%p | -7.75%p | weak under both |
| AUG-025 추격자 | second, 3P | -6.25%p | -3.25%p | weak under both |
| AUG-025 추격자 | second, 4P | -12.75%p | -5.00%p | weak under both |
| AUG-042 추노 | first, 3P | -10.75%p | -12.25%p | weak under both |
| AUG-042 추노 | first, 4P | -11.25%p | -13.00%p | weak under both |
| AUG-044 신의 손 | first, 3P | +24.00%p | +24.25%p | extremely strong under both |
| AUG-044 신의 손 | first, 4P | +22.25%p | +21.25%p | extremely strong under both |
| AUG-053 배반 | first, 3P | +17.75%p | +15.25%p | strong under both |
| AUG-053 배반 | first, 4P | +12.25%p | +12.25%p | strong under both |
| AUG-053 배반 | second, 3P | +17.00%p | +15.00%p | strong under both |
| AUG-053 배반 | second, 4P | +14.75%p | +12.75%p | strong under both |

All 2-player current/scaled results matched exactly, as required because the sensitivity divisor is 1 with one opponent.

Use the official bot for primary balance numbers. For augments whose value is strongly tied to capturing, rerun the player-scaled policy as a robustness check. A balance conclusion is higher-confidence when its direction remains the same under both policies.

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
- 15/20-round duration-band rates,
- target trigger count and win rate by trigger bucket,
- captures,
- pieces lost back to waiting,
- pieces finished,
- average game round.

## 2026-09-12 candidate tuning snapshot

These are experiment results only. None of the candidate mechanics in this section are part of the canonical game rules yet.

### AUG-044 신의 손

The original repeating recharge mechanic was strongly positive in paired tests, around +18 to +22.5 percentage points depending on player count.

A finite-use rework was tested where acquisition grants a fixed number of upcoming basic-roll overrides and no later recharge occurs. Extra rolls do not consume the finite uses because only basic rolls invoke the override.

Initial 200-pair first-acquisition results:

| Finite basic-roll uses | 2P | 3P | 4P |
| ---: | ---: | ---: | ---: |
| 1 | -5.0%p | -6.0%p | +0.0%p |
| 2 | +4.0%p | -1.5%p | -0.5%p |
| 3 | +6.0%p | +6.5%p | +7.5%p |

The 3-use candidate was repeated at 500 valid pairs per player count and produced +11.0%p at 2P, +7.0%p at 3P, and +7.0%p at 4P. This is the leading finite-use candidate from the current bot baseline.

Important limitation: the current simulation bot selects `MO` whenever it uses God Hand. A human can choose DO, GAE, GEOL, YUT, or MO situationally. The finite-use result should therefore be treated as a strong screening result, not the final ceiling of optimal human play.

### AUG-017 개판

The rework removes the old per-turn extra-roll cap and two-piece stack limit. GAE rolls are counted across the whole game, including rolls before acquisition. The unlock-th GAE only unlocks the augment; only later GAE rolls grant extra rolls. After unlock, YUT/MO no longer grant their normal face extra roll while GAE can grant extra rolls without a per-turn cap.

A single shared unlock threshold did not balance player counts well:

- 6: weak in 2P but strongly positive in 3P/4P.
- 7: improved 3P/4P but remained weak in 2P.
- 8: approximately neutral in 3P/4P but too weak in 2P.

Player-count-scaled thresholds were therefore screened. `5/7/8` at 300 valid pairs per context produced:

| Acquisition slot | 2P | 3P | 4P |
| --- | ---: | ---: | ---: |
| first | -3.67%p | +0.67%p | -2.67%p |
| second | +5.67%p | +6.67%p | +1.00%p |

For comparison, `5/7/7` produced +6.33%p in 4P first acquisition and +9.33%p in 4P second acquisition, so an 8-GAE 4P threshold is more stable.

The leading design recommendation is `6/7/8` for 2P/3P/4P respectively. This starts from the originally proposed six-GAE unlock and raises only the multiplayer thresholds where the unlimited post-unlock chain is more valuable. The recommendation combines independently tested player-count slices: 2P threshold 6, 3P threshold 7, and 4P threshold 8. It has not yet been written into canonical rules.

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
