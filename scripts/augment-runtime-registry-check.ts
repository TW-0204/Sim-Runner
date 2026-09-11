import { AUGMENTS } from "@/lib/augments/catalog";
import {
  AUGMENT_RUNTIME_REGISTRY,
  augmentRuntimeRegistryProblems,
} from "@/lib/augments/runtime-registry";

const problems = augmentRuntimeRegistryProblems();

for (const augment of AUGMENTS) {
  const registration = AUGMENT_RUNTIME_REGISTRY.get(augment.id);
  if (!registration) continue;
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
