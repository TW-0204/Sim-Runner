export type RollFace = "BACKDO" | "DO" | "GAE" | "GEOL" | "YUT" | "MO" | "MOVE1";
export type RollSource = "BASIC" | "YUT_MO" | "CAPTURE" | "AUGMENT";
export type PieceStatus = "WAITING" | "ON_BOARD" | "WORMHOLE" | "MARGIN" | "FINISHED";
export type TurnStage = "AWAITING_ROLL" | "ROLL_CHOICE" | "MOVING" | "SPLIT_CHOICE" | "CAPTURE_CHOICE" | "RELOCATION_CHOICE" | "STACK_CHOICE" | "FINISHED";
export type GameWinCondition = "NORMAL" | "SOLO_RUN" | "FOUR_GUARDIANS" | "CENTER_STACK" | "HUNT" | "MOONWALK";

export type RollToken = {
  id: string;
  face: RollFace;
  baseSteps: number;
  finalSteps: number;
  source: RollSource;
  forbidShortcuts?: boolean;
  numericBatchId?: string;
  numericPool?: boolean;
  numericAllocated?: boolean;
  suppressMovementBonuses?: boolean;
  forbiddenPieceIds?: string[];
};

export type StoredRollResult = Pick<
  RollToken,
  "face" | "baseSteps" | "finalSteps" | "forbidShortcuts" | "numericBatchId" | "numericAllocated" | "suppressMovementBonuses" | "forbiddenPieceIds"
>;

export type PendingRollChoice =
  | { kind: "DUAL"; reason: "COUNTER" | "EITHER"; faces: [RollFace, RollFace] }
  | { kind: "DO_REROLL"; token: RollToken };

export type PieceState = {
  id: string;
  ownerUserId: string;
  seat: number;
  status: PieceStatus;
  node: number | null;
  groupId: string;
  hasEntered: boolean;
  pathHistory: number[];
  betrayalOriginalOwnerUserId?: string;
};

export type EnginePlayer = {
  userId: string;
  displayName: string;
  seat: number;
  pieces: PieceState[];
};

export type PendingStackChoice = {
  movingGroupId: string;
  destination: number;
  alliedGroupIds: string[];
  captureCount: number;
  captureExtraRollCount: number;
  augmentExtraRolls?: number;
};

export type RelocationKind = "FRIEND" | "HITCHHIKER";
export type RelocationOpportunity = { kind: RelocationKind; candidateGroupIds: string[] };

export type PendingRelocationChoice = {
  movingGroupId: string;
  destination: number;
  opportunities: RelocationOpportunity[];
  alliedGroupIds: string[];
  captureCount: number;
  captureExtraRollCount: number;
  augmentExtraRolls: number;
};

export type PendingSplitChoice = {
  movingGroupId: string;
  destination: number;
  pieceIds: string[];
  resumeStage: Exclude<TurnStage, "SPLIT_CHOICE">;
  resumeCurrentSeat: number;
  resumeRound: number;
  resumeTurnNumber: number;
  resumePendingRolls: RollSource[];
  resumeResults: RollToken[];
  resumePendingRollChoice: PendingRollChoice | null;
  resumePendingRelocationChoice: PendingRelocationChoice | null;
  resumePendingStackChoice: PendingStackChoice | null;
  resumeLastAction: string;
};

export type CaptureTarget = {
  key: string;
  victimUserId: string;
  victimGroupId: string;
  node: number;
  pieceIds: string[];
};

export type CaptureDecision =
  | {
      kind: "INSURANCE";
      chooserUserId: string;
      victimUserId: string;
      victimGroupId: string;
      node: number;
      pieceIds: string[];
    }
  | {
      kind: "DOUBLE_HIT";
      chooserUserId: string;
      attackerUserId: string;
      attackerGroupId: string;
      targets: CaptureTarget[];
    };

export type PendingCaptureChoice = {
  decisions: CaptureDecision[];
  attackerUserId: string;
  attackerGroupId: string;
  resumeStage: Exclude<TurnStage, "CAPTURE_CHOICE">;
  resumeCurrentSeat: number;
  resumeRound: number;
  resumeTurnNumber: number;
  resumePendingRolls: RollSource[];
  resumeResults: RollToken[];
  resumePendingRollChoice: PendingRollChoice | null;
  resumePendingSplitChoice: PendingSplitChoice | null;
  resumePendingRelocationChoice: PendingRelocationChoice | null;
  resumePendingStackChoice: PendingStackChoice | null;
  resumeLastAction: string;
};

export type PlayerAugmentRuntime = {
  soloLaps?: number;
  enemyCaptureCount?: number;
  timesCaptured?: number;
  breakthroughBlocksRemaining?: number;
  piggybackStackCount?: number;
  g05StartRound?: number;
  g01ExtraTurnNumber?: number;
  g01ExtraRollsGranted?: number;
  athleteAcceleratingGroupId?: string;
  athleteConsecutiveMoves?: number;
  a04NextBasicBonusPending?: boolean;
  a04UpgradeNextAugment?: boolean;
  walkingTrailSegment?: number;
  echoRouteCaptured?: boolean;
  echoBranchChoices?: Record<string, number>;
  echoSourcePieceId?: string;
  echoFollowerPieceId?: string;
  echoCompleted?: boolean;
  echoFollowersRemaining?: number;
  wormholeNextOpenRound?: number;
  wormholeTransit?: Record<string, { returnRound: number; originNode: number; pieceIds: string[] }>;
  turtleLockedUntilRoundByPiece?: Record<string, number>;
  marginOriginByPiece?: Record<string, number>;
  marginSentTurnNumber?: number;
  plaguePieceIds?: Record<string, boolean>;
  plagueTurnActive?: boolean;
  gravityExplosionRound?: number;
  gravityExplosionResolved?: boolean;
  bombResolved?: boolean;
  bombBonusRollsPending?: number;
  gachaNextUseRound?: number;
  controlledBasicRollsUsed?: number;
  fixedOneGroups?: Record<string, boolean>;
  junctionBoostGroups?: Record<string, boolean>;
  sanctuaryGroups?: Record<string, number>;
  sanctuaryPassBlocks?: Record<string, boolean>;
  alleyBlockades?: Record<string, number>;
  universeCenterGroups?: Record<string, boolean>;
  universeCenterRewardLevel?: number;
  universeFreezeTurnsRemaining?: number;
  counterRollPending?: boolean;
  revengeBasicPending?: boolean;
  doRerollsUsed?: number;
  godHandCharges?: number;
  godHandBasicProgress?: number;
  godHandSkipNextBasicProgress?: boolean;
  cleanerMovesUsed?: number;
  grandUnityUsed?: boolean;
  athleteTurnNumber?: number;
  athleteMoved?: boolean;
  athleteDisqualified?: boolean;
  athleteRewarded?: boolean;
  tomorrowStoredResult?: StoredRollResult;
  tomorrowSavedAtTurnNumber?: number;
  vacancyInitialized?: boolean;
  vacancySkipsRemaining?: number;
  vacancyReturnBonusPending?: boolean;
  vacancyReturnBonusGranted?: boolean;
};

export type GameEngineState = {
  schemaVersion: 1;
  round: number;
  turnNumber: number;
  currentSeat: number;
  stage: TurnStage;
  pendingRolls: RollSource[];
  results: RollToken[];
  players: EnginePlayer[];
  pendingRollChoice?: PendingRollChoice | null;
  pendingSplitChoice?: PendingSplitChoice | null;
  pendingCaptureChoice?: PendingCaptureChoice | null;
  pendingRelocationChoice?: PendingRelocationChoice | null;
  pendingStackChoice: PendingStackChoice | null;
  augmentRuntime?: Record<string, PlayerAugmentRuntime>;
  winnerUserId: string | null;
  winnerCondition?: GameWinCondition | null;
  lastAction: string;
};

export type PlayerSeed = { userId: string; displayName: string; seat: number };
