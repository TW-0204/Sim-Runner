# Augment Runtime Architecture

## Goal

Adding or changing an augment must not require editing simulator-specific code or remembering scattered cleanup rules.

The canonical model is:

1. **Catalog** — player-visible metadata, tier, timing, conflicts, family.
2. **Per-augment runtime module** — mechanic lifecycle hooks and mutable reference policy.
3. **Runtime registry** — loads legacy compatibility registrations and hooked modules through one dispatcher.
4. **Game lifecycles** — emit canonical acquisition/roll/move/capture/action/turn/win events.
5. **Simulation** — chooses among legal actions and measures results; it does not own game rules.
6. **Invariant + regression gates** — reject stale references and historical failure modes.

## Files

| Concern | Canonical file |
|---|---|
| Player-visible definition | `src/lib/augments/catalog.ts` |
| Runtime contract / dispatchers | `src/lib/augments/runtime-registry.ts` |
| New or migrated augment modules | `src/lib/augments/runtime/<ID>.ts` + `runtime/index.ts` |
| Setup and mutable-reference repair | `src/lib/augments/setup.ts` |
| Acquisition | `src/lib/game/augment-lifecycle.ts` |
| Roll execution | `src/lib/game/roll-lifecycle.ts` |
| Player actions | `src/lib/game/action-lifecycle.ts` |
| Cross-cutting transition events | `src/lib/game/transition-lifecycle.ts` |
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

A new augment should implement only the hooks it needs. Core game code dispatches lifecycle events instead of branching on a new augment ID whenever the mechanic can be expressed through an existing hook.

If a genuinely new mechanic needs a new lifecycle event, add one reusable event to the registry contract and emit it from the game layer. Do not add a one-off branch in the simulator.

### Hook ordering

High-level game transitions should preserve this conceptual order where applicable:

1. `beforeRoll` or `beforeMove`
2. canonical engine operation
3. `afterRoll` or `afterMove`
4. `afterCapture` when the transition captured a piece
5. `afterAction`
6. `checkWin`
7. `onTurnEnd` and `onTurnStart` when the active player changes
8. mutable-reference repair
9. invariant validation at the caller/test boundary

Legacy mechanics retain their current internal ordering until migrated, but new hooked mechanics should rely on these stable boundaries.

## Mutable references

Augments may keep references to mutable game entities. Those references are dangerous when ownership, grouping, capture, return, or forced relocation changes the board.

Reference policy must therefore be declared centrally.

Current piece-reference policies:

- `AUG-030` — may reference any currently owned piece, including a borrowed Betrayal piece. If the piece leaves the player's container, choose a valid replacement.
- `AUG-041` — may reference only a native piece. If the representative becomes invalid, choose a native replacement; if only a finished native piece remains, reset the selected replacement to waiting as required by the existing rule lifecycle.

`repairInvalidAugmentSetups()` runs at canonical state-transition boundaries. Invariants use the same registry policies, so repair and validation cannot silently diverge.

The registry also supports custom `AugmentReferencePolicy` adapters. Future augments that remember group IDs, result/token IDs, target players, map entities, spawned objects, or other mutable identifiers must register `repair` and/or `problems` there rather than adding cleanup code to unrelated augments such as AUG-053.

## Adding a new augment

1. Add player-visible metadata to `catalog.ts`.
2. Create `src/lib/augments/runtime/<ID>.ts` exporting one `AugmentRuntimeRegistration` with `implementation: "hooked"`.
3. Add that registration to `HOOKED_AUGMENT_RUNTIMES` in `runtime/index.ts`.
4. Implement only the lifecycle hook(s) the mechanic needs.
5. Declare `setup` and/or `references` if the augment stores mutable entity IDs.
6. Add exact regression coverage for interactions that can invalidate state.
7. Update `docs/augment-visual-manifest.md` when player-visible behavior changes.
8. Run:
   - augment runtime registry check
   - canonical smoke
   - canonical exact regressions
   - targeted precision
   - natural population validation when balance-impacting

### What a new augment should not require

A normal new augment should **not** require edits to:

- `src/lib/simulation/game.ts`
- unrelated augment runtime modules
- AUG-053 or another ownership-changing augment merely because it stores a reference
- legacy patch scripts
- test-time source-rewrite scripts

If a new mechanic cannot be expressed without one of those edits, first decide whether a reusable lifecycle event or generic reference policy is missing.

## Migration policy

Existing augments are explicitly listed as `legacy` in the runtime registry so the current behavior remains stable while refactoring continues. This is a migration baseline, not the pattern for new work.

The legacy allowlist is frozen. New IDs belong in `runtime/<ID>.ts`, not in that list. When an existing augment is substantially edited, prefer migrating that augment's affected behavior into a hooked runtime module in the same change. Over time the legacy count should decrease, never increase for newly created augments.
