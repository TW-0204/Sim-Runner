# Repository Agent Rules

## Augment source of truth

`src/` is the canonical source of truth for the current game and simulation behavior.

Do not apply legacy patch scripts before running tests or simulations. Historical patch machinery is preserved under `archive/legacy-patches/` for audit only and must not be used as an execution dependency.

## Augment runtime architecture

Every active augment in `src/lib/augments/catalog.ts` must have a matching entry in `src/lib/augments/runtime-registry.ts`.

For new augments:
1. Add the player-visible metadata to `catalog.ts`.
2. Register the augment in `runtime-registry.ts` as `implementation: "hooked"`.
3. Implement behavior through the registry lifecycle hooks instead of adding simulator-only branches.
4. If the augment keeps a reference to a piece, group, roll result, or other mutable game entity, declare that reference policy in the registry and make ownership/removal repair part of the shared lifecycle.
5. Add exact regression coverage for any newly introduced state transition or interaction edge case.
6. Run the runtime-registry check, canonical smoke, and historical regression suite before balance precision tests.

Existing augments may remain `implementation: "legacy"` while they are migrated incrementally. Do not add a new augment to the legacy baseline merely to bypass registry hooks.

Canonical lifecycle ownership:
- acquisition side effects: `src/lib/game/augment-lifecycle.ts`
- player action execution and common post-action rules: `src/lib/game/action-lifecycle.ts`
- automatic turn rules: `src/lib/game/turn-lifecycle.ts`
- mutable augment reference setup/repair: `src/lib/augments/setup.ts`
- augment extension registration: `src/lib/augments/runtime-registry.ts`
- low-level movement/capture primitives: `src/lib/game/engine.ts`
- bot choice/scoring only: `src/lib/simulation/game.ts`

Do not put canonical game-rule mutations in `src/lib/simulation/game.ts`. Simulation may choose among legal actions and record telemetry, but actual state transitions belong to the game layer.

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
