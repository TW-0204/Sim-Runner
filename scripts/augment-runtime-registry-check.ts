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
  "AUG-001", "AUG-002", "AUG-003", "AUG-004", "AUG-005", "AUG-006", "AUG-007", "AUG-008",
  "AUG-009", "AUG-010", "AUG-011", "AUG-012", "AUG-013", "AUG-014", "AUG-015", "AUG-016",
  "AUG-017", "AUG-018", "AUG-019", "AUG-020", "AUG-021", "AUG-022", "AUG-023", "AUG-024",
  "AUG-025", "AUG-026", "AUG-027", "AUG-028", "AUG-029", "AUG-030",
  "AUG-031", "AUG-032", "AUG-033", "AUG-034", "AUG-035", "AUG-036", "AUG-037", "AUG-038",
  "AUG-039", "AUG-040", "AUG-041", "AUG-042", "AUG-043", "AUG-044",
  "AUG-045", "AUG-046", "AUG-047", "AUG-048", "AUG-049", "AUG-050", "AUG-051", "AUG-052",
  "AUG-053", "AUG-054", "AUG-055", "AUG-056", "AUG-057", "AUG-058", "AUG-059",
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
