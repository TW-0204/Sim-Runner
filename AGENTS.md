# Repository Agent Rules

## Augment source of truth

This repository uses a patch stack. Raw files such as `src/lib/augments/catalog.ts` may contain stale pre-patch values.

For the current effective rules, treat the state after:

```bash
bash scripts/apply-v3-stack.sh
```

as canonical.

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
