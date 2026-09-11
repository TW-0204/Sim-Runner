from pathlib import Path

CATALOG = Path("src/lib/augments/catalog.ts")
SERVER = Path("src/lib/augments/server.ts")
SPECIAL_OFFERS = Path("src/lib/simulation/special-offers.ts")
INTEGRITY = Path("scripts/augment-id-integrity-check.ts")
DOC = Path("docs/augment-id-lifecycle.md")
AGENTS = Path("AGENTS.md")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"missing migration pattern: {label}")
    return text.replace(old, new, 1)


def patch_catalog():
    text = CATALOG.read_text(encoding="utf-8")
    text = replace_once(
        text,
        "  legacyAliases?: string[];\n  replacedBy?: AugmentId[];",
        "  legacyAliases?: string[];\n  /** Stable seeded-randomness identity. Existing migrated augments keep their old ID here. */\n  randomizationKey?: string;\n  replacedBy?: AugmentId[];",
        "catalog randomization field",
    )
    text = replace_once(
        text,
        '''export const AUGMENT_CATALOG: AugmentDefinition[] = AUGMENT_CATALOG_ENTRIES.map((augment) => ({
  ...augment,
  legacyAliases: LEGACY_ALIASES_BY_CANONICAL.get(augment.id) ?? [],
}));''',
        '''export const AUGMENT_CATALOG: AugmentDefinition[] = AUGMENT_CATALOG_ENTRIES.map((augment) => {
  const legacyAliases = LEGACY_ALIASES_BY_CANONICAL.get(augment.id) ?? [];
  return {
    ...augment,
    legacyAliases,
    randomizationKey: legacyAliases[0] ?? augment.id,
  };
});''',
        "catalog enrichment",
    )
    text = replace_once(
        text,
        '''export function getAugment(id: string | null | undefined) {
  const canonicalId = resolveAugmentId(id);
  return canonicalId ? CANONICAL_AUGMENT_BY_ID.get(canonicalId) ?? null : null;
}''',
        '''export function augmentRandomizationKey(id: string) {
  const canonicalId = resolveAugmentId(id);
  if (!canonicalId) return id;
  return CANONICAL_AUGMENT_BY_ID.get(canonicalId)?.randomizationKey ?? canonicalId;
}

export function getAugment(id: string | null | undefined) {
  const canonicalId = resolveAugmentId(id);
  return canonicalId ? CANONICAL_AUGMENT_BY_ID.get(canonicalId) ?? null : null;
}''',
        "catalog randomization helper",
    )
    CATALOG.write_text(text, encoding="utf-8")


def patch_server():
    text = SERVER.read_text(encoding="utf-8")
    text = replace_once(
        text,
        'import { AUGMENTS, AUGMENT_BY_ID, type AugmentDefinition, type AugmentTier } from "./catalog";',
        'import { AUGMENTS, AUGMENT_BY_ID, augmentRandomizationKey, type AugmentDefinition, type AugmentTier } from "./catalog";',
        "server catalog import",
    )
    text = text.replace('${key}:${a.id}', '${key}:${augmentRandomizationKey(a.id)}')
    text = text.replace('${key}:${b.id}', '${key}:${augmentRandomizationKey(b.id)}')
    text = text.replace('${args.seed}:special:${args.phase}:${args.userId}:${a.id}', '${args.seed}:special:${args.phase}:${args.userId}:${augmentRandomizationKey(a.id)}')
    text = text.replace('${args.seed}:special:${args.phase}:${args.userId}:${b.id}', '${args.seed}:special:${args.phase}:${args.userId}:${augmentRandomizationKey(b.id)}')
    text = text.replace('${args.seed}:${args.phase}:${player.userId}:${a.id}', '${args.seed}:${args.phase}:${player.userId}:${augmentRandomizationKey(a.id)}')
    text = text.replace('${args.seed}:${args.phase}:${player.userId}:${b.id}', '${args.seed}:${args.phase}:${player.userId}:${augmentRandomizationKey(b.id)}')
    SERVER.write_text(text, encoding="utf-8")


def patch_special_offers():
    text = SPECIAL_OFFERS.read_text(encoding="utf-8")
    text = replace_once(
        text,
        'import { buildSpecialOfferCandidateIds, deterministicInt } from "@/lib/augments/server";',
        'import { augmentRandomizationKey } from "@/lib/augments/catalog";\nimport { buildSpecialOfferCandidateIds, deterministicInt } from "@/lib/augments/server";',
        "special offer import",
    )
    text = replace_once(
        text,
        '${args.seed}:${args.eventIndex}:${args.logicalPhase}:${target.offer.userId}:${augmentId}',
        '${args.seed}:${args.eventIndex}:${args.logicalPhase}:${target.offer.userId}:${augmentRandomizationKey(augmentId)}',
        "rare special slot hash",
    )
    SPECIAL_OFFERS.write_text(text, encoding="utf-8")


def patch_integrity():
    text = INTEGRITY.read_text(encoding="utf-8")
    text = replace_once(
        text,
        '  resolveAugmentId,\n} from "@/lib/augments/catalog";',
        '  resolveAugmentId,\n  augmentRandomizationKey,\n} from "@/lib/augments/catalog";',
        "integrity import",
    )
    text = replace_once(
        text,
        '  if (AUGMENT_BY_ID.get(legacyId)?.id !== canonicalId) problems.push(`compatibility lookup failed for ${legacyId}`);\n}',
        '  if (AUGMENT_BY_ID.get(legacyId)?.id !== canonicalId) problems.push(`compatibility lookup failed for ${legacyId}`);\n  if (augmentRandomizationKey(canonicalId) !== legacyId) problems.push(`seeded-randomness compatibility failed for ${legacyId}`);\n}',
        "integrity randomization assertion",
    )
    INTEGRITY.write_text(text, encoding="utf-8")


def patch_docs():
    text = DOC.read_text(encoding="utf-8")
    marker = "7. Historical artifacts keep their original IDs; readers may resolve them through `resolveAugmentId`.\n"
    addition = marker + "8. Seeded offer generation is independent from canonical IDs. Migrated augments retain their old alias as `randomizationKey`; new augments default to their canonical ID.\n"
    text = replace_once(text, marker, addition, "ID lifecycle RNG rule")
    DOC.write_text(text, encoding="utf-8")

    agents = AGENTS.read_text(encoding="utf-8")
    marker = "- After this migration the next unused canonical ID is `AUG-068`.\n"
    addition = marker + "- Never derive seeded gameplay randomness directly from mutable identity presentation. Use the catalog randomization key so an ID migration cannot change deterministic outcomes.\n"
    agents = replace_once(agents, marker, addition, "AGENTS RNG rule")
    AGENTS.write_text(agents, encoding="utf-8")


def main():
    patch_catalog()
    patch_server()
    patch_special_offers()
    patch_integrity()
    patch_docs()
    print("preserved pre-migration seeded augment randomization keys")


if __name__ == "__main__":
    main()
