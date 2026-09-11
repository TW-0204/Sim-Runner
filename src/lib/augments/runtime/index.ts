import type { AugmentRuntimeRegistration } from "../runtime-registry";

/**
 * Canonical home for new/migrated augment runtime modules.
 *
 * New augments should live in `runtime/<ID>.ts`, export one
 * `AugmentRuntimeRegistration`, and be added to this array. Do not extend the frozen
 * legacy allowlist in runtime-registry.ts.
 */
export const HOOKED_AUGMENT_RUNTIMES: AugmentRuntimeRegistration[] = [];
