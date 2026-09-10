export type LogicalAugmentPhase = 1 | 2 | 3;

export type AugmentEvent = {
  /** 0 = immediately before Round 1. Positive N = immediately after Round N. */
  afterRound: number;
  logicalPhase: LogicalAugmentPhase;
};

export type BalanceRuleset = {
  id:
    | "baseline-3aug"
    | "two-aug-start-r4"
    | "two-aug-r1-r5"
    | "two-aug-start-r4-special-5pct"
    | "two-aug-start-r4-special-slots-v1"
    | "two-aug-start-r4-special-slots-v2";
  label: string;
  pieceCount: number;
  augmentEvents: AugmentEvent[];
  excludedAugmentIdsByLogicalPhase?: Partial<Record<LogicalAugmentPhase, string[]>>;
  /** Legacy diagnostic: one global phase-level Special may be injected. */
  rareSpecialOfferChancePerEvent?: number;
  /** New candidate: max game-level exposure if every player sees all 3 initial + 3 reroll draws. */
  specialMaxGameExposureByLogicalPhase?: Partial<Record<LogicalAugmentPhase, number>>;
  /** Share RNG streams with a parent ruleset for paired policy experiments. */
  rngNamespace?: string;
};

export const BALANCE_RULESETS: Record<BalanceRuleset["id"], BalanceRuleset> = {
  "baseline-3aug": {
    id: "baseline-3aug",
    label: "4말 / 3증강 / 시작-R5-R9",
    pieceCount: 4,
    augmentEvents: [
      { afterRound: 0, logicalPhase: 1 },
      { afterRound: 5, logicalPhase: 2 },
      { afterRound: 9, logicalPhase: 3 },
    ],
  },
  "two-aug-start-r4": {
    id: "two-aug-start-r4",
    label: "4말 / 2증강 / 시작-R4",
    pieceCount: 4,
    augmentEvents: [
      { afterRound: 0, logicalPhase: 1 },
      { afterRound: 4, logicalPhase: 3 },
    ],
  },
  "two-aug-r1-r5": {
    id: "two-aug-r1-r5",
    label: "4말 / 2증강 / R1-R5",
    pieceCount: 4,
    augmentEvents: [
      { afterRound: 1, logicalPhase: 1 },
      { afterRound: 5, logicalPhase: 3 },
    ],
  },
  "two-aug-start-r4-special-5pct": {
    id: "two-aug-start-r4-special-5pct",
    label: "4말 / 2증강 / 시작-R4 / Special 이벤트당 5%",
    pieceCount: 4,
    augmentEvents: [
      { afterRound: 0, logicalPhase: 1 },
      { afterRound: 4, logicalPhase: 3 },
    ],
    rareSpecialOfferChancePerEvent: 0.05,
    rngNamespace: "two-aug-start-r4",
  },
  "two-aug-start-r4-special-slots-v1": {
    id: "two-aug-start-r4-special-slots-v1",
    label: "4말 / 2증강 / 시작-R4 / 슬롯 Special Quest 10% · Moonwalk 2.5% max",
    pieceCount: 4,
    augmentEvents: [
      { afterRound: 0, logicalPhase: 1 },
      { afterRound: 4, logicalPhase: 3 },
    ],
    specialMaxGameExposureByLogicalPhase: {
      1: 0.10,
      3: 0.025,
    },
    rngNamespace: "two-aug-start-r4",
  },
  "two-aug-start-r4-special-slots-v2": {
    id: "two-aug-start-r4-special-slots-v2",
    label: "4말 / 2증강 / 시작-R4 / Special v2: 사방신 보류 · 우주의 중심 · 추노 인원 보정",
    pieceCount: 4,
    augmentEvents: [
      { afterRound: 0, logicalPhase: 1 },
      { afterRound: 4, logicalPhase: 3 },
    ],
    excludedAugmentIdsByLogicalPhase: {
      1: ["P03"],
    },
    specialMaxGameExposureByLogicalPhase: {
      1: 0.10,
      3: 0.025,
    },
    rngNamespace: "two-aug-start-r4",
  },
};

export function getBalanceRuleset(id: string) {
  const ruleset = BALANCE_RULESETS[id as BalanceRuleset["id"]];
  if (!ruleset) {
    throw new Error(`Unknown balance ruleset: ${id}`);
  }
  return ruleset;
}
