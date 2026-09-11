import { AUGMENTS } from "@/lib/augments/catalog";
import {
  AUGMENT_RUNTIME_REGISTRY,
  augmentRuntimeRegistryProblems,
} from "@/lib/augments/runtime-registry";

/**
 * IDs that existed before the hooked-runtime migration. This list is deliberately
 * duplicated outside the runtime registry so CI can detect someone adding a brand-new
 * augment to the legacy compatibility path. Existing IDs may migrate out of legacy;
 * the allowed set may shrink, but it must never expand.
 */
const FROZEN_LEGACY_BASELINE = new Set([
  "S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08",
  "S09", "S10", "S11", "S12", "S13", "S14", "S15", "S16",
  "G01", "G03", "G04", "G05", "G06", "G07", "G08", "G09",
  "G10", "G11", "G12", "G13", "G15", "G16",
  "P02", "P03", "P04", "P06", "P08", "P09", "P10", "P11",
  "P12", "P13", "P14", "P16", "P17", "P19",
  "A01", "A02", "A04", "A05", "A06", "A07", "A08", "A09",
  "A10", "A11", "A12", "A13", "A14", "A15", "A16",
]);

const problems = augmentRuntimeRegistryProblems();

for (const augment of AUGMENTS) {
  const registration = AUGMENT_RUNTIME_REGISTRY.get(augment.id);
  if (!registration) continue;
  if (registration.implementation === "legacy" && !FROZEN_LEGACY_BASELINE.has(augment.id)) {
    problems.push(`new augment ${augment.id} cannot be added to the frozen legacy runtime baseline`);
  }
  if (registration.implementation === "hooked") {
    const hookCount = Object.keys(registration.hooks ?? {}).length;
    const referenceCount = registration.references?.length ?? 0;
    if (hookCount === 0 && referenceCount === 0 && !registration.setup) {
      problems.push(`hooked augment ${augment.id} has no hooks, setup policy, or reference policy`);
    }
  }
}

if (problems.length > 0) {
  console.error("Augment runtime registry check failed:");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

const legacyCount = [...AUGMENT_RUNTIME_REGISTRY.values()]
  .filter((registration) => registration.implementation === "legacy").length;
const hookedCount = AUGMENT_RUNTIME_REGISTRY.size - legacyCount;
console.log(`augment runtime registry PASS: ${AUGMENT_RUNTIME_REGISTRY.size}/${AUGMENTS.length}`);
console.log(`implementation status: ${hookedCount} hooked, ${legacyCount} legacy-compatible`);
