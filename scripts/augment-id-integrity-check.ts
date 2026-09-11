import {
  AUGMENT_BY_ID,
  AUGMENT_CATALOG,
  AUGMENTS,
  CANONICAL_AUGMENT_BY_ID,
  resolveAugmentId,
  augmentRandomizationKey,
} from "@/lib/augments/catalog";
import { LEGACY_AUGMENT_ID_MAP } from "@/lib/augments/legacy-id-map";

const problems: string[] = [];
const ids = AUGMENT_CATALOG.map((augment) => augment.id);
const idSet = new Set(ids);
if (idSet.size !== ids.length) problems.push("augment catalog contains duplicate canonical ids");
if (AUGMENTS.length !== 59) problems.push(`expected 59 active augments, found ${AUGMENTS.length}`);
if (AUGMENT_CATALOG.length !== 67) problems.push(`expected 67 catalogued identities, found ${AUGMENT_CATALOG.length}`);

for (const augment of AUGMENT_CATALOG) {
  if (!/^AUG-\d{3,}$/.test(augment.id)) problems.push(`invalid canonical augment id ${augment.id}`);
  if (augment.status === "active" && augment.replacedBy?.length) problems.push(`active augment ${augment.id} cannot declare replacedBy`);
  for (const replacementId of augment.replacedBy ?? []) {
    if (!idSet.has(replacementId)) problems.push(`retired augment ${augment.id} points to missing replacement ${replacementId}`);
  }
}

for (const [legacyId, canonicalId] of Object.entries(LEGACY_AUGMENT_ID_MAP)) {
  if (!CANONICAL_AUGMENT_BY_ID.has(canonicalId)) problems.push(`legacy alias ${legacyId} points to missing ${canonicalId}`);
  if (resolveAugmentId(legacyId) !== canonicalId) problems.push(`legacy alias ${legacyId} does not resolve to ${canonicalId}`);
  if (AUGMENT_BY_ID.get(legacyId)?.id !== canonicalId) problems.push(`compatibility lookup failed for ${legacyId}`);
  if (augmentRandomizationKey(canonicalId) !== legacyId) problems.push(`seeded-randomness compatibility failed for ${legacyId}`);
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
