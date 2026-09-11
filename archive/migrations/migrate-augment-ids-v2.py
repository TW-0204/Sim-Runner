from pathlib import Path
import re

MAPPING = {
    "S01": "AUG-001", "S02": "AUG-002", "S03": "AUG-003", "S04": "AUG-004",
    "S05": "AUG-005", "S06": "AUG-006", "S07": "AUG-007", "S08": "AUG-008",
    "S09": "AUG-009", "S10": "AUG-010", "S11": "AUG-011", "S12": "AUG-012",
    "S13": "AUG-013", "S14": "AUG-014", "S15": "AUG-015", "S16": "AUG-016",
    "G01": "AUG-017", "G03": "AUG-018", "G04": "AUG-019", "G05": "AUG-020",
    "G06": "AUG-021", "G07": "AUG-022", "G08": "AUG-023", "G09": "AUG-024",
    "G10": "AUG-025", "G11": "AUG-026", "G12": "AUG-027", "G13": "AUG-028",
    "G15": "AUG-029", "G16": "AUG-030",
    "P02": "AUG-031", "P03": "AUG-032", "P04": "AUG-033", "P06": "AUG-034",
    "P08": "AUG-035", "P09": "AUG-036", "P10": "AUG-037", "P11": "AUG-038",
    "P12": "AUG-039", "P13": "AUG-040", "P14": "AUG-041", "P16": "AUG-042",
    "P17": "AUG-043", "P19": "AUG-044",
    "A01": "AUG-045", "A02": "AUG-046", "A04": "AUG-047", "A05": "AUG-048",
    "A06": "AUG-049", "A07": "AUG-050", "A08": "AUG-051", "A09": "AUG-052",
    "A10": "AUG-053", "A11": "AUG-054", "A12": "AUG-055", "A13": "AUG-056",
    "A14": "AUG-057", "A15": "AUG-058", "A16": "AUG-059",
    # Historical removed/inactive identities. They remain catalogued but never enter AUGMENTS.
    "G02": "AUG-060", "G14": "AUG-061", "P01": "AUG-062", "P05": "AUG-063",
    "P07": "AUG-064", "P15": "AUG-065", "P18": "AUG-066", "A03": "AUG-067",
}

ACTIVE_LEGACY_IDS = {
    "S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08",
    "S09", "S10", "S11", "S12", "S13", "S14", "S15", "S16",
    "G01", "G03", "G04", "G05", "G06", "G07", "G08", "G09",
    "G10", "G11", "G12", "G13", "G15", "G16",
    "P02", "P03", "P04", "P06", "P08", "P09", "P10", "P11",
    "P12", "P13", "P14", "P16", "P17", "P19",
    "A01", "A02", "A04", "A05", "A06", "A07", "A08", "A09",
    "A10", "A11", "A12", "A13", "A14", "A15", "A16",
}

RETIRED_ENTRIES = [
    ("AUG-060", "사냥꾼 2", "HUNTER", "Removed before the canonical ID migration."),
    ("AUG-061", "각자도생", None, "Removed before the canonical ID migration."),
    ("AUG-062", "사냥꾼 3", "HUNTER", "Removed before the canonical ID migration."),
    ("AUG-063", "칸은 숫자에 불과하다 2", "NUMBERS", "Removed before the canonical ID migration."),
    ("AUG-064", "물귀신 2", "WATER_GHOST", "Removed before the canonical ID migration."),
    ("AUG-065", "일심동체 2", "ONE_BODY", "Removed before the canonical ID migration."),
    ("AUG-066", "무임승차 구버전", None, "Old hitchhiker version removed before the canonical ID migration."),
    ("AUG-067", "미사용 레거시 증강", None, "Historical inactive A03 identity; display metadata was not recovered."),
]

ROOTS = [Path("src"), Path("scripts"), Path(".github/workflows"), Path("docs")]
TOP_LEVEL = [Path("AGENTS.md"), Path("README.md")]
TEXT_SUFFIXES = {".ts", ".tsx", ".js", ".mjs", ".sh", ".yml", ".yaml", ".md", ".json"}
LEGACY_MAP_PATH = Path("src/lib/augments/legacy-id-map.ts")
CATALOG_PATH = Path("src/lib/augments/catalog.ts")
INTEGRITY_PATH = Path("scripts/augment-id-integrity-check.ts")
STRUCTURE_WORKFLOW = Path(".github/workflows/canonical-structure-check.yml")
AGENTS_PATH = Path("AGENTS.md")
DOC_PATH = Path("docs/augment-id-lifecycle.md")

TOKEN_RE = re.compile(r"(?<![A-Za-z0-9_])(" + "|".join(re.escape(key) for key in sorted(MAPPING, key=len, reverse=True)) + r")(?![A-Za-z0-9_])")
LEGACY_TOKEN_RE = re.compile(r"\b[SGPA][0-9]{2}\b")


def replace_tokens(text: str) -> str:
    return TOKEN_RE.sub(lambda match: MAPPING[match.group(1)], text)


def active_files():
    files = []
    for root in ROOTS:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
                continue
            if "archive" in path.parts:
                continue
            files.append(path)
    files.extend(path for path in TOP_LEVEL if path.exists())
    return files


def write_legacy_map():
    lines = [
        "/**",
        " * Compatibility aliases from the pre-canonical augment ID system.",
        " * These aliases identify the SAME historical augment only. Never use aliases",
        " * to represent a merge, split, replacement, or rework.",
        " */",
        "export const LEGACY_AUGMENT_ID_MAP = {",
    ]
    for old, new in MAPPING.items():
        lines.append(f'  "{old}": "{new}",')
    lines += ["} as const;", "", "export type LegacyAugmentId = keyof typeof LEGACY_AUGMENT_ID_MAP;", ""]
    LEGACY_MAP_PATH.write_text("\n".join(lines), encoding="utf-8")


def retired_catalog_source() -> str:
    lines = ["", "  // Historical identities retained for audit/history. Never offered while retired."]
    for augment_id, name, family, reason in RETIRED_ENTRIES:
        family_part = f', family: "{family}"' if family else ""
        lines.append(
            f'  {{ id: "{augment_id}", status: "retired", name: "{name}"{family_part}, retiredReason: "{reason}" }},'
        )
    return "\n".join(lines)


def migrate_catalog():
    text = replace_tokens(CATALOG_PATH.read_text(encoding="utf-8"))
    original_definition = '''export type AugmentDefinition = {
  id: string;
  name: string;
  tier: AugmentTier;
  description: string;
  timing?: AugmentTiming;
  family?: string;
  requires?: string;
  special?: boolean;
  uniquePerGame?: boolean;
  conflicts?: string[];
};'''
    migrated_definition = '''export type AugmentId = `AUG-${string}`;
export type AugmentStatus = "active" | "retired";

type AugmentBase = {
  id: AugmentId;
  status: AugmentStatus;
  legacyAliases?: string[];
  replacedBy?: AugmentId[];
  name: string;
  timing?: AugmentTiming;
  family?: string;
  requires?: string;
  special?: boolean;
  uniquePerGame?: boolean;
  conflicts?: string[];
};

export type ActiveAugmentDefinition = AugmentBase & {
  status: "active";
  tier: AugmentTier;
  description: string;
};

export type RetiredAugmentDefinition = AugmentBase & {
  status: "retired";
  tier?: AugmentTier;
  description?: string;
  retiredReason?: string;
};

export type AugmentDefinition = ActiveAugmentDefinition | RetiredAugmentDefinition;'''
    text = text.replace(
        'export type AugmentTier = "silver" | "gold" | "prism";\nexport type AugmentTiming = "any" | "first" | "last" | "not-last";\n\n',
        'import { LEGACY_AUGMENT_ID_MAP } from "./legacy-id-map";\n\nexport type AugmentTier = "silver" | "gold" | "prism";\nexport type AugmentTiming = "any" | "first" | "last" | "not-last";\n\n',
    )
    if original_definition not in text:
        raise RuntimeError("catalog definition pattern not found")
    text = text.replace(original_definition, migrated_definition)
    text = text.replace('export const AUGMENTS: AugmentDefinition[] = [', 'const AUGMENT_CATALOG_ENTRIES: AugmentDefinition[] = [')
    for legacy_id in ACTIVE_LEGACY_IDS:
        canonical = MAPPING[legacy_id]
        text = text.replace(f'{{ id: "{canonical}",', f'{{ id: "{canonical}", status: "active",')

    old_tail = '''\n];\n\nexport const AUGMENT_BY_ID = new Map(AUGMENTS.map((augment) => [augment.id, augment]));\n\nexport function getAugment(id: string) {\n  return AUGMENT_BY_ID.get(id) ?? null;\n}\n'''
    new_tail = retired_catalog_source() + '''
];

const LEGACY_ALIASES_BY_CANONICAL = new Map<AugmentId, string[]>();
for (const [legacyId, canonicalId] of Object.entries(LEGACY_AUGMENT_ID_MAP)) {
  const id = canonicalId as AugmentId;
  const aliases = LEGACY_ALIASES_BY_CANONICAL.get(id) ?? [];
  aliases.push(legacyId);
  LEGACY_ALIASES_BY_CANONICAL.set(id, aliases);
}

export const AUGMENT_CATALOG: AugmentDefinition[] = AUGMENT_CATALOG_ENTRIES.map((augment) => ({
  ...augment,
  legacyAliases: LEGACY_ALIASES_BY_CANONICAL.get(augment.id) ?? [],
}));

/** Current natural/offer pool. Retired augments stay catalogued but are never offered. */
export const AUGMENTS: ActiveAugmentDefinition[] = AUGMENT_CATALOG.filter(
  (augment): augment is ActiveAugmentDefinition => augment.status === "active",
);

export const CANONICAL_AUGMENT_BY_ID = new Map(AUGMENT_CATALOG.map((augment) => [augment.id, augment]));

/** Compatibility lookup for canonical IDs and the pre-migration aliases. */
export const AUGMENT_BY_ID = new Map<string, AugmentDefinition>(CANONICAL_AUGMENT_BY_ID);
for (const [legacyId, canonicalId] of Object.entries(LEGACY_AUGMENT_ID_MAP)) {
  const augment = CANONICAL_AUGMENT_BY_ID.get(canonicalId as AugmentId);
  if (augment) AUGMENT_BY_ID.set(legacyId, augment);
}

export function resolveAugmentId(id: string | null | undefined): AugmentId | null {
  if (!id) return null;
  if (CANONICAL_AUGMENT_BY_ID.has(id as AugmentId)) return id as AugmentId;
  return (LEGACY_AUGMENT_ID_MAP as Record<string, AugmentId>)[id] ?? null;
}

export function getAugment(id: string | null | undefined) {
  const canonicalId = resolveAugmentId(id);
  return canonicalId ? CANONICAL_AUGMENT_BY_ID.get(canonicalId) ?? null : null;
}

export function getActiveAugment(id: string | null | undefined) {
  const augment = getAugment(id);
  return augment?.status === "active" ? augment : null;
}
'''
    if old_tail not in text:
        raise RuntimeError("catalog tail pattern not found")
    CATALOG_PATH.write_text(text.replace(old_tail, "\n" + new_tail), encoding="utf-8")


def normalize_simulation_boundary():
    path = Path("src/lib/simulation/game.ts")
    text = path.read_text(encoding="utf-8")
    old_import = 'import { AUGMENTS, AUGMENT_BY_ID, type AugmentTier } from "@/lib/augments/catalog";'
    new_import = 'import { AUGMENTS, AUGMENT_BY_ID, resolveAugmentId, type AugmentTier } from "@/lib/augments/catalog";'
    if old_import in text:
        text = text.replace(old_import, new_import, 1)
    elif new_import not in text:
        raise RuntimeError("simulation catalog import pattern not found")
    old_context = '    forcedAugmentId: options.forcedAugmentId,\n'
    new_context = '    forcedAugmentId: resolveAugmentId(options.forcedAugmentId) ?? options.forcedAugmentId,\n'
    if old_context not in text:
        raise RuntimeError("simulation forced augment context pattern not found")
    text = text.replace(old_context, new_context, 1)
    path.write_text(text, encoding="utf-8")


def write_integrity_check():
    INTEGRITY_PATH.write_text('''import {
  AUGMENT_BY_ID,
  AUGMENT_CATALOG,
  AUGMENTS,
  CANONICAL_AUGMENT_BY_ID,
  resolveAugmentId,
} from "@/lib/augments/catalog";
import { LEGACY_AUGMENT_ID_MAP } from "@/lib/augments/legacy-id-map";

const problems: string[] = [];
const ids = AUGMENT_CATALOG.map((augment) => augment.id);
const idSet = new Set(ids);
if (idSet.size !== ids.length) problems.push("augment catalog contains duplicate canonical ids");
if (AUGMENTS.length !== 59) problems.push(`expected 59 active augments, found ${AUGMENTS.length}`);
if (AUGMENT_CATALOG.length !== 67) problems.push(`expected 67 catalogued identities, found ${AUGMENT_CATALOG.length}`);

for (const augment of AUGMENT_CATALOG) {
  if (!/^AUG-\\d{3,}$/.test(augment.id)) problems.push(`invalid canonical augment id ${augment.id}`);
  if (augment.status === "active" && augment.replacedBy?.length) problems.push(`active augment ${augment.id} cannot declare replacedBy`);
  for (const replacementId of augment.replacedBy ?? []) {
    if (!idSet.has(replacementId)) problems.push(`retired augment ${augment.id} points to missing replacement ${replacementId}`);
  }
}

for (const [legacyId, canonicalId] of Object.entries(LEGACY_AUGMENT_ID_MAP)) {
  if (!CANONICAL_AUGMENT_BY_ID.has(canonicalId)) problems.push(`legacy alias ${legacyId} points to missing ${canonicalId}`);
  if (resolveAugmentId(legacyId) !== canonicalId) problems.push(`legacy alias ${legacyId} does not resolve to ${canonicalId}`);
  if (AUGMENT_BY_ID.get(legacyId)?.id !== canonicalId) problems.push(`compatibility lookup failed for ${legacyId}`);
}

if (AUGMENTS.some((augment) => augment.status !== "active")) problems.push("AUGMENTS contains retired entries");
for (const retiredId of ["AUG-060", "AUG-061", "AUG-062", "AUG-063", "AUG-064", "AUG-065", "AUG-066", "AUG-067"]) {
  const retired = CANONICAL_AUGMENT_BY_ID.get(retiredId as `AUG-${string}`);
  if (retired?.status !== "retired") problems.push(`${retiredId} must remain retired`);
  if (AUGMENTS.some((augment) => augment.id === retiredId)) problems.push(`${retiredId} leaked into active pool`);
}

if (problems.length) {
  console.error("Augment ID integrity check failed:");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log(`augment id integrity PASS: ${AUGMENTS.length} active / ${AUGMENT_CATALOG.length} catalogued / ${Object.keys(LEGACY_AUGMENT_ID_MAP).length} legacy aliases`);
console.log("next unused canonical augment ID: AUG-068");
''', encoding="utf-8")


def update_structure_workflow():
    text = STRUCTURE_WORKFLOW.read_text(encoding="utf-8")
    marker = '      - name: Verify augment runtime registry coverage\n'
    insertion = '''      - name: Verify augment ID lifecycle
        run: node --import ./scripts/register-ts-hooks.mjs scripts/augment-id-integrity-check.ts

      - name: Reject active legacy-style augment IDs
        shell: bash
        run: |
          set -euo pipefail
          if grep -R -n -E '\\b(S|G|P|A)[0-9]{2}\\b' src scripts .github/workflows --exclude=legacy-id-map.ts --exclude-dir=archive; then
            echo 'Legacy-style augment ID found outside the compatibility map/archive.' >&2
            exit 1
          fi

'''
    if "Verify augment ID lifecycle" not in text:
        if marker not in text:
            raise RuntimeError("structure workflow insertion marker not found")
        text = text.replace(marker, insertion + marker)
    STRUCTURE_WORKFLOW.write_text(text, encoding="utf-8")


def update_agents():
    text = AGENTS_PATH.read_text(encoding="utf-8")
    text = text.replace(
        '2. Create `src/lib/augments/runtime/<ID>.ts` exporting an `implementation: "hooked"` runtime registration.\n',
        '2. Create `src/lib/augments/runtime/<AUG-###>.ts` exporting an `implementation: "hooked"` runtime registration.\n',
    )
    section = '''
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

See `docs/augment-id-lifecycle.md`.
'''
    if "## Augment identity lifecycle" not in text:
        text += section
    AGENTS_PATH.write_text(text, encoding="utf-8")


def write_doc():
    rows = ["| Legacy alias | Canonical ID |", "|---|---|"] + [f"| `{old}` | `{new}` |" for old, new in MAPPING.items()]
    DOC_PATH.write_text(
        "# Augment ID lifecycle\n\n"
        "Canonical IDs are permanent identity keys and do not encode tier or family.\n\n"
        "## Rules\n\n"
        "1. Balance tuning, tier changes, renames, and ordinary numeric changes keep the same canonical ID.\n"
        "2. Removal means `status: \"retired\"`; keep the catalog record forever and exclude it from the active pool.\n"
        "3. Merge means retire source IDs and create a new ID. `replacedBy` is lineage only, not an alias.\n"
        "4. Split means retire the source ID and create new IDs.\n"
        "5. Canonical numbers are never reused.\n"
        "6. Legacy S/G/P/A aliases exist only for pre-migration inputs and history.\n"
        "7. Historical artifacts keep their original IDs; readers may resolve them through `resolveAugmentId`.\n\n"
        "## Current allocation\n\n"
        "- `AUG-001` through `AUG-059`: active identities at migration time.\n"
        "- `AUG-060` through `AUG-067`: already removed/inactive historical identities.\n"
        "- Next unused ID: `AUG-068`.\n\n"
        "## Initial migration map\n\n" + "\n".join(rows) + "\n",
        encoding="utf-8",
    )


def main():
    for path in active_files():
        if path in {CATALOG_PATH, LEGACY_MAP_PATH, INTEGRITY_PATH, DOC_PATH}:
            continue
        text = path.read_text(encoding="utf-8")
        updated = replace_tokens(text)
        if updated != text:
            path.write_text(updated, encoding="utf-8")

    migrate_catalog()
    normalize_simulation_boundary()
    write_legacy_map()
    write_integrity_check()
    update_structure_workflow()
    update_agents()
    write_doc()

    leftovers = []
    for path in active_files():
        if path in {LEGACY_MAP_PATH, DOC_PATH}:
            continue
        found = sorted(set(LEGACY_TOKEN_RE.findall(path.read_text(encoding="utf-8"))))
        if found:
            leftovers.append((path, found))
    if leftovers:
        details = "\n".join(f"{path}: {', '.join(ids)}" for path, ids in leftovers)
        raise RuntimeError("Unmigrated legacy-style IDs remain in active files:\n" + details)

    print(f"migrated {len(MAPPING)} historical augment identities to permanent canonical AUG ids")
    print("active: 59; retired historical: 8; next unused: AUG-068")


if __name__ == "__main__":
    main()
