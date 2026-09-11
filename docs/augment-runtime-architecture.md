# Augment Runtime Architecture

## Goal

Adding or changing an augment must not require editing simulator-specific code or remembering scattered cleanup rules.

The canonical model is:

1. **Catalog** — player-visible metadata, tier, timing, conflicts, family.
2. **Runtime registry** — mechanic lifecycle hooks and mutable reference policy.
3. **Game lifecycles** — emit canonical acquisition/action/turn events.
4. **Simulation** — chooses legal actions and measures results; it does not own game rules.
5. **Invariant + regression gates** — reject stale references and historical failure modes.

## Files

| Concern | Canonical file |
|---|---|
| Player-visible definition | `src/lib/augments/catalog.ts` |
| Runtime registration and hooks | `src/lib/augments/runtime-registry.ts` |
| Piece setup/reference policy | `src/lib/augments/setup.ts` |
| Acquisition | `src/lib/game/augment-lifecycle.ts` |
| Player actions / post-action | `src/lib/game/action-lifecycle.ts` |
| Automatic turn events | `src/lib/game/turn-lifecycle.ts` |
| Low-level board primitives | `src/lib/game/engine.ts` |
| State invariants | `src/lib/game/invariants.ts` |
| Bot policy only | `src/lib/simulation/game.ts` |

## Runtime hook model

The registry exposes stable lifecycle names:

- `onAcquire`
- `onTurnStart`
- `beforeRoll`
- `afterRoll`
- `beforeMove`
- `afterMove`
- `afterCapture`
- `afterAction`
- `onTurnEnd`
- `checkWin`

A new augment should implement only the hooks it needs. Core game code should dispatch a lifecycle event instead of branching on a new augment ID whenever the mechanic can be expressed through an existing hook.

If a genuinely new mechanic needs a new lifecycle event, add one reusable event to the registry contract and emit it from the game layer. Do not add a one-off branch in the simulator.

## Mutable references

Augments may keep references to mutable game entities. Those references are dangerous when ownership, grouping, capture, return, or forced relocation changes the board.

Reference policy must therefore be declared centrally.

Current piece-reference policies:

- `G16` — may reference any currently owned piece, including a borrowed Betrayal piece. If the piece leaves the player's container, choose a valid replacement.
- `P14` — may reference only a native piece. If the representative becomes invalid, choose a native replacement; if only a finished native piece remains, reset the selected replacement to waiting as required by the existing rule lifecycle.

`repairInvalidAugmentSetups()` runs at canonical state-transition boundaries. Invariants use the same registry policies, so repair and validation cannot silently diverge.

Future group/result/entity references should follow the same pattern instead of embedding cleanup logic inside unrelated augments such as A10.

## Adding a new augment

1. Add metadata to `catalog.ts`.
2. Add a runtime registration. New augments should be `implementation: "hooked"`.
3. Add the needed lifecycle hook(s).
4. Declare mutable-reference policy if the augment stores any entity ID.
5. Add exact regression seeds for interactions that can invalidate state.
6. Update `docs/augment-visual-manifest.md` when player-visible behavior changes.
7. Run:
   - augment runtime registry check
   - canonical smoke
   - canonical exact regressions
   - targeted precision
   - natural population validation when balance-impacting

## Migration policy

Existing augments are explicitly listed as `legacy` in the runtime registry so the current behavior remains stable while refactoring continues. This is a migration baseline, not the pattern for new work.

When an existing augment is substantially edited, prefer migrating that augment's affected behavior into registry hooks in the same change. Over time the legacy count should decrease, never increase for newly created augments.
