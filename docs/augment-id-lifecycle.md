# Augment ID lifecycle

Canonical IDs are permanent identity keys and do not encode tier or family.

## Rules

1. Balance tuning, tier changes, renames, and ordinary numeric changes keep the same canonical ID.
2. Removal means `status: "retired"`; keep the catalog record forever and exclude it from the active pool.
3. Merge means retire source IDs and create a new ID. `replacedBy` is lineage only, not an alias.
4. Split means retire the source ID and create new IDs.
5. Canonical numbers are never reused.
6. Legacy S/G/P/A aliases exist only for pre-migration inputs and history.
7. Historical artifacts keep their original IDs; readers may resolve them through `resolveAugmentId`.
8. Seeded offer generation is independent from canonical IDs. Migrated augments retain their old alias as `randomizationKey`; new augments default to their canonical ID.

## Current allocation

- `AUG-001` through `AUG-059`: active identities at migration time.
- `AUG-060` through `AUG-067`: already removed/inactive historical identities.
- Next unused ID: `AUG-068`.

## Initial migration map

| Legacy alias | Canonical ID |
|---|---|
| `S01` | `AUG-001` |
| `S02` | `AUG-002` |
| `S03` | `AUG-003` |
| `S04` | `AUG-004` |
| `S05` | `AUG-005` |
| `S06` | `AUG-006` |
| `S07` | `AUG-007` |
| `S08` | `AUG-008` |
| `S09` | `AUG-009` |
| `S10` | `AUG-010` |
| `S11` | `AUG-011` |
| `S12` | `AUG-012` |
| `S13` | `AUG-013` |
| `S14` | `AUG-014` |
| `S15` | `AUG-015` |
| `S16` | `AUG-016` |
| `G01` | `AUG-017` |
| `G03` | `AUG-018` |
| `G04` | `AUG-019` |
| `G05` | `AUG-020` |
| `G06` | `AUG-021` |
| `G07` | `AUG-022` |
| `G08` | `AUG-023` |
| `G09` | `AUG-024` |
| `G10` | `AUG-025` |
| `G11` | `AUG-026` |
| `G12` | `AUG-027` |
| `G13` | `AUG-028` |
| `G15` | `AUG-029` |
| `G16` | `AUG-030` |
| `P02` | `AUG-031` |
| `P03` | `AUG-032` |
| `P04` | `AUG-033` |
| `P06` | `AUG-034` |
| `P08` | `AUG-035` |
| `P09` | `AUG-036` |
| `P10` | `AUG-037` |
| `P11` | `AUG-038` |
| `P12` | `AUG-039` |
| `P13` | `AUG-040` |
| `P14` | `AUG-041` |
| `P16` | `AUG-042` |
| `P17` | `AUG-043` |
| `P19` | `AUG-044` |
| `A01` | `AUG-045` |
| `A02` | `AUG-046` |
| `A04` | `AUG-047` |
| `A05` | `AUG-048` |
| `A06` | `AUG-049` |
| `A07` | `AUG-050` |
| `A08` | `AUG-051` |
| `A09` | `AUG-052` |
| `A10` | `AUG-053` |
| `A11` | `AUG-054` |
| `A12` | `AUG-055` |
| `A13` | `AUG-056` |
| `A14` | `AUG-057` |
| `A15` | `AUG-058` |
| `A16` | `AUG-059` |
| `G02` | `AUG-060` |
| `G14` | `AUG-061` |
| `P01` | `AUG-062` |
| `P05` | `AUG-063` |
| `P07` | `AUG-064` |
| `P15` | `AUG-065` |
| `P18` | `AUG-066` |
| `A03` | `AUG-067` |
