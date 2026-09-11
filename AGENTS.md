# Repository Agent Rules

## Augment source of truth

`src/` is the canonical source of truth for the current game and simulation behavior.

Do not apply legacy patch scripts before running tests or simulations. Historical patch machinery is preserved under `archive/legacy-patches/` for audit only and must not be used as an execution dependency.

## Augment runtime architecture

Every active augment in `src/lib/augments/catalog.ts` must have a matching runtime registration.

For new augments:
1. Add the player-visible metadata to `catalog.ts`.
2. Create `src/lib/augments/runtime/<AUG-###>.ts` exporting an `implementation: "hooked"` runtime registration.
3. Add that module to `HOOKED_AUGMENT_RUNTIMES` in `src/lib/augments/runtime/index.ts`.
4. Implement behavior through the shared lifecycle hooks instead of adding simulator-only branches.
5. If the augment keeps a reference to a piece, group, roll result, player, map entity, or other mutable game entity, declare a setup/reference policy and repair/validation behavior in the runtime registration.
6. Add exact regression coverage for newly introduced state transitions or interaction edge cases.
7. Run the runtime-registry check, canonical smoke, and historical regression suite before balance precision tests.

Existing augments may remain `implementation: "legacy"` while they are migrated incrementally. The legacy allowlist is frozen: do not add a new augment to it merely to bypass runtime hooks.

Canonical lifecycle ownership:
- runtime contract/dispatchers: `src/lib/augments/runtime-registry.ts`
- new/migrated augment modules: `src/lib/augments/runtime/<ID>.ts`
- acquisition side effects: `src/lib/game/augment-lifecycle.ts`
- roll execution: `src/lib/game/roll-lifecycle.ts`
- player action execution: `src/lib/game/action-lifecycle.ts`
- cross-cutting transition events: `src/lib/game/transition-lifecycle.ts`
- automatic turn rules: `src/lib/game/turn-lifecycle.ts`
- mutable augment reference setup/repair: `src/lib/augments/setup.ts`
- low-level movement/capture primitives: `src/lib/game/engine.ts`
- bot choice/scoring only: `src/lib/simulation/game.ts`

Do not put canonical game-rule mutations in `src/lib/simulation/game.ts`. Simulation may choose among legal actions and record telemetry, but actual state transitions belong to the game layer.

A normal new augment must not require edits to `simulation/game.ts`, unrelated augment modules, legacy patch scripts, or ownership-changing effects such as AUG-053 merely because it stores a reference. If it appears to require those edits, first add or extend a reusable lifecycle/reference contract in the game layer.

## Visual manifest synchronization

`docs/augment-visual-manifest.md` is the required snapshot for image-generation, UI, card-art, and visual-asset agents.

If any change affects an augment's player-visible definition, **update `docs/augment-visual-manifest.md` in the same commit**.

This requirement applies to:
- adding, removing, or reactivating an augment
- ID or name changes
- tier changes
- first/second/either acquisition timing
- natural-pool availability
- conflicts
- effect wording or mechanics
- numeric balance changes that alter player-visible behavior
- changes that alter the correct visual interpretation

A change is incomplete if the code/patch changes but the manifest remains stale.

Logging-only changes, diagnostics, refactors, tests, and simulation instrumentation do not require a manifest update when player-visible rules do not change.

## Image-generation agents

For augment visuals:
1. Read `docs/augment-visual-manifest.md` first.
2. Do not infer current rules from raw `catalog.ts` alone.
3. Do not generate assets for IDs listed as removed/inactive unless the rules explicitly reactivate them.
4. Visualize the mechanic rather than the literal Korean augment name.

## Augment identity lifecycle

Canonical augment IDs are permanent `AUG-###` identifiers and never encode tier, mechanic family, or balance state. Tier is mutable metadata.

- Never reuse a canonical ID, even after an augment is removed.
- Rename, tier changes, numeric tuning, and normal balance edits keep the same canonical ID.
- Removed augments stay in `AUGMENT_CATALOG` with `status: "retired"`; they are excluded from `AUGMENTS`, the active pool.
- A merger creates a new canonical ID. Retire source IDs and use `replacedBy` only as lineage metadata.
- A split retires the source ID and creates new canonical IDs for each result.
- `legacyAliases` are identity aliases only for the one-time S/G/P/A -> AUG migration, never for reworks or mergers.
- Historical files under `archive/` may keep old IDs. Active code must use canonical IDs.
- After this migration the next unused canonical ID is `AUG-068`.
- Never derive seeded gameplay randomness directly from mutable identity presentation. Use the catalog randomization key so an ID migration cannot change deterministic outcomes.

See `docs/augment-id-lifecycle.md`.
