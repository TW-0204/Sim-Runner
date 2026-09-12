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

The earlier Gaepan threshold evidence that counted GAE rolls from the start of the game is superseded and must not be used as final balance evidence. That includes the old `6/7/8` player-count recommendation.

The corrected candidate starts the GAE counter when AUG-017 is acquired. GAE rolls before acquisition are ignored. Before unlock, YUT/MO keep their normal extra-roll behavior. The GAE that reaches the unlock threshold only unlocks the augment and does not grant an extra roll. After unlock, each later GAE grants one extra roll without a per-turn cap, while YUT/MO stop granting their normal face extra rolls. The legacy maximum-two stack restriction is also removed for this candidate.

With the corrected acquisition-scoped counter, the originally screened low thresholds were too strong. At first acquisition, threshold 6 produced paired win deltas of +10.2%p at 2P, +20.6%p at 3P, and +23.0%p at 4P. Second-acquisition thresholds 3/4/5 were also strongly positive, with threshold 5 still producing +4.6%p, +9.2%p, and +12.0%p at 2P/3P/4P.

A wider threshold sweep therefore tested substantially higher unlock counts. The stable candidate from that sweep is:

- first acquisition: unlock after 14 post-acquisition GAE rolls,
- second acquisition: unlock after 10 post-acquisition GAE rolls.

A 500-valid-pair confirmation per player count produced:

| Acquisition slot | Threshold | Players | Paired win delta | Unlock rate | Avg unlock round | Extra rolls/game | Extra rolls when unlocked |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| first | 14 | 2P | -3.0%p | 15.8% | 17.29 | 0.42 | 2.65 |
| first | 14 | 3P | +4.6%p | 28.2% | 14.13 | 1.37 | 4.85 |
| first | 14 | 4P | +3.6%p | 43.2% | 13.59 | 2.47 | 5.73 |
| second | 10 | 2P | -4.0%p | 15.6% | 16.95 | 0.40 | 2.59 |
| second | 10 | 3P | -0.6%p | 30.8% | 14.35 | 1.32 | 4.29 |
| second | 10 | 4P | +0.6%p | 43.2% | 13.84 | 1.97 | 4.56 |

The current balance candidate is therefore `14` for first acquisition and `10` for second acquisition. It keeps the high-impact post-unlock identity while reducing the previous multiplayer win-rate spike. The main tradeoff is a low unlock rate in 2P, around 16%, so this remains a candidate rather than a canonical rule until the design accepts that rarity.

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
