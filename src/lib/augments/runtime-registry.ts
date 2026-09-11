import { AUGMENTS } from "./catalog";
import { HOOKED_AUGMENT_RUNTIMES } from "./runtime";
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

export type AugmentRuntimeEventData = Readonly<Record<string, unknown>>;

export type AugmentRuntimeHookContext = {
  engine: GameEngineState;
  /** Player who owns the augment whose hook is currently executing. */
  ownerUserId: string;
  /** Player who caused the event, when different from the augment owner. */
  actorUserId?: string;
  augmentId: string;
  ownedByUser: Record<string, string[]>;
  setupsByUser: Record<string, PlayerAugmentSetups>;
  before?: GameEngineState;
  actionKind?: string;
  event?: AugmentRuntimeEventData;
  randomNext?: () => number;
  randomInt?: (maxExclusive: number) => number;
};

export type AugmentRuntimeHook = (
  context: AugmentRuntimeHookContext,
) => GameEngineState | void;

/**
 * Generic reference policy for augments that keep mutable entity identifiers.
 *
 * Piece-selection setups use the built-in `setup` policy below. Future augments that
 * remember group ids, result ids, target players, map entities, etc. should register
 * one or more reference policies instead of putting cleanup code in unrelated rules.
 */
export type AugmentReferencePolicy = {
  name: string;
  repair?: (context: AugmentRuntimeHookContext) => GameEngineState | void;
  problems?: (context: AugmentRuntimeHookContext) => string[];
};

export type AugmentRuntimeRegistration = {
  id: string;
  /**
   * legacy means the current mechanic is still implemented in the existing game
   * functions. hooked means all mechanic entry points are owned by this registry.
   * New augments should use hooked unless there is a deliberate migration reason.
   */
  implementation: "legacy" | "hooked";
  setup?: PieceSetupPolicy;
  references?: AugmentReferencePolicy[];
  hooks?: Partial<Record<AugmentRuntimeHookName, AugmentRuntimeHook>>;
};

/**
 * Frozen compatibility allowlist for the augments that existed when the canonical
 * runtime migration started. New augments must not be added here; register them in
 * `src/lib/augments/runtime/` as `hooked` instead. Existing entries should disappear
 * from this list as they migrate.
 */
const LEGACY_IDS = [
  "AUG-001", "AUG-002", "AUG-003", "AUG-004", "AUG-005", "AUG-006", "AUG-007", "AUG-008",
  "AUG-009", "AUG-010", "AUG-011", "AUG-012", "AUG-013", "AUG-014", "AUG-015", "AUG-016",
  "AUG-017", "AUG-018", "AUG-019", "AUG-020", "AUG-021", "AUG-022", "AUG-023", "AUG-024",
  "AUG-025", "AUG-026", "AUG-027", "AUG-028", "AUG-029", "AUG-030",
  "AUG-031", "AUG-032", "AUG-033", "AUG-034", "AUG-035", "AUG-036", "AUG-037", "AUG-038",
  "AUG-039", "AUG-040", "AUG-041", "AUG-042", "AUG-043", "AUG-044",
  "AUG-045", "AUG-046", "AUG-047", "AUG-048", "AUG-049", "AUG-050", "AUG-051", "AUG-052",
  "AUG-053", "AUG-054", "AUG-055", "AUG-056", "AUG-057", "AUG-058", "AUG-059",
] as const;

const LEGACY_REGISTRATIONS: AugmentRuntimeRegistration[] = LEGACY_IDS.map((id) => ({
  id,
  implementation: "legacy",
}));

const REGISTRATIONS: AugmentRuntimeRegistration[] = [
  ...LEGACY_REGISTRATIONS,
  ...HOOKED_AUGMENT_RUNTIMES,
];

function overrideRegistration(
  id: string,
  patch: Omit<Partial<AugmentRuntimeRegistration>, "id">,
) {
  const index = REGISTRATIONS.findIndex((registration) => registration.id === id);
  if (index < 0) throw new Error(`Cannot configure missing augment runtime ${id}.`);
  REGISTRATIONS[index] = { ...REGISTRATIONS[index], ...patch, id };
}

overrideRegistration("AUG-030", {
  setup: {
    kind: "piece",
    allowBorrowed: true,
    preferNonFinished: true,
  },
});

overrideRegistration("AUG-041", {
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

export function registeredAugmentReferencePolicies() {
  return REGISTRATIONS.flatMap((registration) => (
    (registration.references ?? []).map((policy) => ({
      augmentId: registration.id,
      policy,
    }))
  ));
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

/** Runs hooks owned by one player. Useful for owner-only lifecycle events. */
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

/**
 * Runs the same event through every owned augment in seat order. This is the canonical
 * path for global/reaction mechanics where an augment may care about another player's
 * roll, move, capture, turn, or win attempt.
 */
export function dispatchAllAugmentHooks(
  hookName: AugmentRuntimeHookName,
  context: Omit<AugmentRuntimeHookContext, "augmentId" | "ownerUserId">,
) {
  let engine = context.engine;
  const players = [...engine.players].sort((left, right) => left.seat - right.seat);
  for (const player of players) {
    const ownerUserId = player.userId;
    for (const augmentId of context.ownedByUser[ownerUserId] ?? []) {
      engine = dispatchAugmentHook(hookName, {
        ...context,
        engine,
        ownerUserId,
        augmentId,
      });
    }
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

  for (const registration of REGISTRATIONS) {
    if (registration.implementation !== "hooked") continue;
    const hasRuntimeBehavior = Boolean(
      registration.setup
      || registration.references?.length
      || Object.keys(registration.hooks ?? {}).length,
    );
    if (!hasRuntimeBehavior) {
      problems.push(`hooked augment ${registration.id} has no hooks, setup, or reference policy`);
    }
  }

  return problems;
}
