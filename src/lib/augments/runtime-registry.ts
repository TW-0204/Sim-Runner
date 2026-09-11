import { AUGMENTS } from "./catalog";
import type { GameEngineState } from "@/lib/game/types";
import type { PlayerAugmentSetups } from "./effects";

export type AugmentRuntimeHookName =
  | "onAcquire"
  | "onTurnStart"
  | "beforeRoll"
  | "afterRoll"
  | "beforeMove"
  | "afterMove"
  | "afterCapture"
  | "afterAction"
  | "onTurnEnd"
  | "checkWin";

export type PieceSetupPolicy = {
  kind: "piece";
  allowBorrowed: boolean;
  preferNonFinished: boolean;
  resetFinishedReplacementToWaiting?: boolean;
};

export type AugmentRuntimeHookContext = {
  engine: GameEngineState;
  ownerUserId: string;
  augmentId: string;
  ownedByUser: Record<string, string[]>;
  setupsByUser: Record<string, PlayerAugmentSetups>;
  before?: GameEngineState;
  actionKind?: string;
  randomNext?: () => number;
  randomInt?: (maxExclusive: number) => number;
};

export type AugmentRuntimeHook = (
  context: AugmentRuntimeHookContext,
) => GameEngineState | void;

export type AugmentRuntimeRegistration = {
  id: string;
  /**
   * legacy means the current mechanic is still implemented in the existing game
   * functions. hooked means all mechanic entry points are owned by this registry.
   * New augments should use hooked unless there is a deliberate migration reason.
   */
  implementation: "legacy" | "hooked";
  setup?: PieceSetupPolicy;
  hooks?: Partial<Record<AugmentRuntimeHookName, AugmentRuntimeHook>>;
};

const LEGACY_IDS = [
  "S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08",
  "S09", "S10", "S11", "S12", "S13", "S14", "S15", "S16",
  "G01", "G03", "G04", "G05", "G06", "G07", "G08", "G09",
  "G10", "G11", "G12", "G13", "G15", "G16",
  "P02", "P03", "P04", "P06", "P08", "P09", "P10", "P11",
  "P12", "P13", "P14", "P16", "P17", "P19",
  "A01", "A02", "A04", "A05", "A06", "A07", "A08", "A09",
  "A10", "A11", "A12", "A13", "A14", "A15", "A16",
] as const;

const REGISTRATIONS: AugmentRuntimeRegistration[] = LEGACY_IDS.map((id) => ({
  id,
  implementation: "legacy",
}));

function overrideRegistration(
  id: string,
  patch: Omit<Partial<AugmentRuntimeRegistration>, "id">,
) {
  const index = REGISTRATIONS.findIndex((registration) => registration.id === id);
  if (index < 0) throw new Error(`Cannot configure missing augment runtime ${id}.`);
  REGISTRATIONS[index] = { ...REGISTRATIONS[index], ...patch, id };
}

overrideRegistration("G16", {
  setup: {
    kind: "piece",
    allowBorrowed: true,
    preferNonFinished: true,
  },
});

overrideRegistration("P14", {
  setup: {
    kind: "piece",
    allowBorrowed: false,
    preferNonFinished: true,
    resetFinishedReplacementToWaiting: true,
  },
});

export const AUGMENT_RUNTIME_REGISTRY = new Map(
  REGISTRATIONS.map((registration) => [registration.id, registration]),
);

export function getAugmentRuntime(augmentId: string | null | undefined) {
  return augmentId ? AUGMENT_RUNTIME_REGISTRY.get(augmentId) ?? null : null;
}

export function registeredPieceSetupAugmentIds() {
  return REGISTRATIONS.filter((registration) => registration.setup?.kind === "piece")
    .map((registration) => registration.id);
}

export function dispatchAugmentHook(
  hookName: AugmentRuntimeHookName,
  context: AugmentRuntimeHookContext,
) {
  const registration = getAugmentRuntime(context.augmentId);
  const hook = registration?.hooks?.[hookName];
  if (!hook) return context.engine;
  return hook(context) ?? context.engine;
}

export function dispatchOwnedAugmentHooks(
  hookName: AugmentRuntimeHookName,
  context: Omit<AugmentRuntimeHookContext, "augmentId">,
) {
  let engine = context.engine;
  for (const augmentId of context.ownedByUser[context.ownerUserId] ?? []) {
    engine = dispatchAugmentHook(hookName, { ...context, engine, augmentId });
  }
  return engine;
}

export function augmentRuntimeRegistryProblems() {
  const catalogIds = new Set(AUGMENTS.map((augment) => augment.id));
  const runtimeIds = new Set(REGISTRATIONS.map((registration) => registration.id));
  const problems: string[] = [];

  for (const id of catalogIds) {
    if (!runtimeIds.has(id)) problems.push(`catalog augment ${id} is missing from runtime registry`);
  }
  for (const id of runtimeIds) {
    if (!catalogIds.has(id)) problems.push(`runtime registry contains unknown augment ${id}`);
  }
  if (runtimeIds.size !== REGISTRATIONS.length) problems.push("runtime registry contains duplicate augment ids");

  return problems;
}
