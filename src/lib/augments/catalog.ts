import { LEGACY_AUGMENT_ID_MAP } from "./legacy-id-map";

export type AugmentTier = "silver" | "gold" | "prism";
export type AugmentTiming = "any" | "first" | "last" | "not-last";

export type AugmentId = `AUG-${string}`;
export type AugmentStatus = "active" | "retired";

type AugmentBase = {
  id: AugmentId;
  status: AugmentStatus;
  legacyAliases?: string[];
  /** Stable seeded-randomness identity. Existing migrated augments keep their old ID here. */
  randomizationKey?: string;
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

export type AugmentDefinition = ActiveAugmentDefinition | RetiredAugmentDefinition;

const fixedRollConflicts = ["AUG-018", "AUG-019", "AUG-020", "AUG-011", "AUG-039", "AUG-044"];

const AUGMENT_CATALOG_ENTRIES: AugmentDefinition[] = [
  { id: "AUG-001", status: "active", name: "사냥꾼 1", tier: "silver", family: "HUNTER", description: "상대를 잡아 얻은 추가 던지기의 전진 이동량이 +1칸 증가합니다." },
  { id: "AUG-002", status: "active", name: "어부바", tier: "silver", description: "자신의 말을 새로 업한 횟수가 누적 4회가 될 때마다 추가 던지기 1회를 얻습니다." },
  { id: "AUG-003", status: "active", name: "도찐개찐", tier: "silver", description: "도와 백도는 각각 1칸 대신 2칸 이동합니다." },
  { id: "AUG-004", status: "active", name: "돌파", tier: "gold", description: "자신의 말이 누적 5회 잡히면 이후 처음 2번의 잡기를 무효화합니다." },
  { id: "AUG-005", status: "active", name: "안전벨트", tier: "gold", description: "2개 이상 업힌 말이 잡혀도 상대는 그 잡기로 추가 던지기를 얻지 못합니다." },
  { id: "AUG-006", status: "active", name: "출발이 반", tier: "silver", description: "말이 대기 상태에서 말판으로 출발할 때마다 그 이동량이 +2칸 증가합니다." },
  { id: "AUG-007", status: "active", name: "분풀이", tier: "silver", description: "자신의 말이 잡히면 다음 기본 던지기의 전진 이동량이 +1칸 증가합니다." },
  { id: "AUG-008", status: "active", name: "막판 스퍼트", tier: "silver", description: "말 3개가 완주하면 마지막 남은 말의 전진 이동량이 +1칸 증가합니다." },
  { id: "AUG-009", status: "active", name: "걸작", tier: "silver", description: "걸은 3칸 대신 4칸 이동합니다. 결과의 정체성은 여전히 걸입니다." },
  { id: "AUG-010", status: "active", name: "후진 가속", tier: "silver", description: "백도로 실제 후진에 성공하면 원하는 말에 쓸 수 있는 1칸 이동권을 얻습니다." },
  { id: "AUG-011", status: "active", name: "반격의 서막", tier: "silver", conflicts: fixedRollConflicts.filter((id) => id !== "AUG-011"), description: "말이 잡힌 다음 턴의 첫 기본 던지기를 두 번 하고 원하는 결과를 선택합니다." },
  { id: "AUG-012", status: "active", name: "아깝다", tier: "silver", description: "게임 중 최대 2번, 기본 던지기에서 도가 나오면 버리고 다시 던질 수 있습니다." },
  { id: "AUG-013", status: "active", name: "자리비움", tier: "silver", timing: "first", description: "2라운드 동안 턴을 쉽니다. 자리비움이 끝난 뒤 돌아오는 턴에 추가 던지기 1회를 얻고, 이후 게임이 끝날 때까지 자신의 전진 이동량이 +1칸 증가합니다." },
  { id: "AUG-014", status: "active", name: "나 홀로 집에", tier: "silver", description: "갈림길에 정확히 도착한 말은 그 말의 다음 전진 이동량이 +1칸 증가합니다." },
  { id: "AUG-015", status: "active", name: "무임승차", tier: "prism", description: "이동을 마친 뒤 경로 기준 앞뒤 1칸의 아군 한 묶음을 불러와 업을 수 있습니다. 이 효과로 합친 묶음은 최대 2개의 말까지만 가능합니다." },
  { id: "AUG-016", status: "active", name: "낙!", tier: "silver", description: "모든 플레이어의 기본 던지기는 5% 확률로 낙이 됩니다. 자신의 낙은 대신 1칸 이동권을 얻습니다." },

  { id: "AUG-017", status: "active", name: "개판", tier: "prism", conflicts: ["AUG-038"], description: "개가 추가 던지기를 만들고, 윷과 모는 더 이상 추가 던지기를 만들지 않습니다. 자신의 말은 한 묶음에 최대 2개까지만 업을 수 있으며, 개로 얻는 추가 던지기는 한 턴 최대 2회입니다." },
  { id: "AUG-018", status: "active", name: "도개걸윷모", tier: "gold", conflicts: fixedRollConflicts.filter((id) => id !== "AUG-018"), description: "다음 5회의 기본 던지기가 도→개→걸→윷→모 순서로 고정됩니다." },
  { id: "AUG-019", status: "active", name: "모윷걸개도", tier: "gold", conflicts: fixedRollConflicts.filter((id) => id !== "AUG-019"), description: "다음 5회의 기본 던지기가 모→윷→걸→개→도 순서로 고정됩니다." },
  { id: "AUG-020", status: "active", name: "모 아니면 도", tier: "gold", conflicts: fixedRollConflicts.filter((id) => id !== "AUG-020"), description: "획득 후 3라운드 동안 기본 던지기는 각각 50% 확률로 모 또는 도가 나옵니다." },
  { id: "AUG-021", status: "active", name: "골목대장", tier: "silver", description: "갈림길에 정확히 도착하면 상대의 통과를 한 번 막아 바로 앞 칸에 세울 수 있습니다." },
  { id: "AUG-022", status: "active", name: "자리 맡아놨어", tier: "gold", description: "갈림길을 혼자 지키는 말을 제외한 다른 자신의 말들의 전진 이동량이 +1칸 증가합니다." },
  { id: "AUG-023", status: "active", name: "일심동체 1", tier: "gold", family: "ONE_BODY", description: "2개 이상 업힌 자신의 말 묶음의 전진 이동량이 +1칸 증가합니다." },
  { id: "AUG-024", status: "active", name: "칸은 숫자에 불과하다 1", tier: "gold", family: "NUMBERS", description: "양수 이동 결과 하나를 정확히 둘로 나누어 서로 다른 두 말에 사용할 수 있습니다." },
  { id: "AUG-025", status: "active", name: "추격자", tier: "silver", description: "이동 경로 위 상대에게 일찍 멈춰 그 말을 잡을 수 있습니다. 이 효과로 잡을 때는 추가 던지기를 얻지 않습니다." },
  { id: "AUG-026", status: "active", name: "보험 들었습니다", tier: "gold", description: "2개 이상 업힌 자신의 말 묶음이 잡힐 때 말 1개만 그 칸에 남고 나머지는 대기로 돌아갑니다." },
  { id: "AUG-027", status: "active", name: "물귀신 1", tier: "gold", family: "WATER_GHOST", description: "자신을 잡은 상대 말 묶음의 다음 이동 거리를 1칸으로 고정합니다." },
  { id: "AUG-028", status: "active", name: "내일의 나에게", tier: "gold", description: "턴마다 사용하지 않은 이동 결과 하나를 다음 턴까지 저장할 수 있습니다. 저장한 결과의 이동 거리는 1칸 증가합니다." },
  { id: "AUG-029", status: "active", name: "육상선수", tier: "gold", description: "같은 자신의 말을 연속해서 이동시킬 때마다 해당 말의 전진 이동량이 +1칸 증가합니다. 가속은 최대 +2칸까지 증가하며, 다른 자신의 말을 이동시키거나 해당 말이 잡히면 초기화됩니다." },
  { id: "AUG-030", status: "active", name: "에이스", tier: "gold", description: "증강 획득 시 대표 말 하나를 지정하며, 그 말이 포함된 묶음의 전진 이동량이 +1칸 증가합니다." },

  { id: "AUG-031", status: "active", name: "문워크", tier: "prism", timing: "last", special: true, uniquePerGame: true, conflicts: ["AUG-037"], description: "획득 즉시 대기 중인 모든 말을 윷판의 무작위 위치로 강제 이동시킵니다. 이후 양수 이동은 말판 전체를 역방향으로 진행하고 백도는 정방향으로 진행합니다. 자신의 네 말을 모두 대기로 되돌리면 즉시 승리합니다." },
  { id: "AUG-032", status: "active", name: "사방신", tier: "prism", timing: "first", special: true, uniquePerGame: true, description: "중앙을 제외한 네 갈림길을 자신의 말로 동시에 모두 차지하면 즉시 승리합니다." },
  { id: "AUG-033", status: "active", name: "우주의 중심", tier: "prism", timing: "first", special: true, uniquePerGame: true, conflicts: ["AUG-037"], description: "네 말을 중앙에 하나의 묶음으로 모으면 즉시 승리합니다. 중앙에 도착한 자신의 말 수가 1개면 추가 던지기 1회, 2개면 추가 던지기 1회와 모든 상대의 다음 1턴 이동 정지, 3개면 남은 말 1개를 가장 가까운 모퉁이로 강제 이동시킵니다. 이 강제 이동은 잡기를 일으키지 않습니다." },
  { id: "AUG-034", status: "active", name: "청소부", tier: "prism", description: "다음 4번의 이동은 지나가는 모든 칸과 도착 칸의 상대를 전부 잡습니다." },
  { id: "AUG-035", status: "active", name: "일타쌍피", tier: "prism", description: "도착 칸의 상대를 잡을 때 경로 기준 앞뒤 1칸의 상대 한 묶음도 함께 잡을 수 있습니다." },
  { id: "AUG-036", status: "active", name: "길은 내가 만든다", tier: "prism", description: "갈림길에 정확히 멈추지 않아도 지나가는 순간 원하는 지름길로 진입할 수 있습니다." },
  { id: "AUG-037", status: "active", name: "고가도로", tier: "prism", timing: "first", conflicts: ["AUG-031", "AUG-033"], description: "자신의 말은 바깥길로만 이동하며 다른 증강 효과에 의한 강제 이동 및 강제 재배치에 면역입니다. 말을 대기 상태로 되돌리는 효과는 정상 적용됩니다." },
  { id: "AUG-038", status: "active", name: "대동단결", tier: "prism", conflicts: ["AUG-017"], description: "게임 중 한 번, 말판 위 자신의 모든 말을 선택한 자신의 말 위치로 모아 즉시 업습니다." },
  { id: "AUG-039", status: "active", name: "양자택일", tier: "prism", conflicts: fixedRollConflicts.filter((id) => id !== "AUG-039"), description: "모든 기본 던지기를 두 번 하고 원하는 결과 하나를 선택합니다." },
  { id: "AUG-040", status: "active", name: "성역", tier: "prism", conflicts: ["AUG-032"], description: "갈림길에 도착한 자신의 말은 떠날 때까지 잡히지 않으며, 상대의 통과를 한 번 막습니다." },
  { id: "AUG-041", status: "active", name: "독주", tier: "prism", timing: "first", special: true, description: "대표 말 하나만 사용할 수 있으며 그 말로 말판을 세 바퀴 완주하면 승리합니다." },
  { id: "AUG-042", status: "active", name: "추노", tier: "prism", timing: "first", special: true, conflicts: ["AUG-029"], description: "기본 승리 조건 대신 상대 말 잡기를 2인 7회, 3인 19회, 4인 30회 달성하면 즉시 승리합니다." },
  { id: "AUG-043", status: "active", name: "독불장군", tier: "prism", description: "자신의 말도 잡을 수 있으며 아군을 잡으면 추가 던지기 2회를 얻습니다." },
  { id: "AUG-044", status: "active", name: "신의 손", tier: "prism", timing: "not-last", conflicts: fixedRollConflicts.filter((id) => id !== "AUG-044"), description: "기본 던지기 2회마다 1회 충전되며, 충전을 소모해 다음 기본 결과를 원하는 도, 개, 걸, 윷, 모로 바꿀 수 있습니다." },

  { id: "AUG-045", status: "active", name: "중력 폭발", tier: "prism", description: "획득 즉시 판 위의 모든 말을 내부 경로의 무작위 칸으로 강제 이동시키며, 이후 3라운드마다 반복합니다." },
  { id: "AUG-046", status: "active", name: "뽑기 기계", tier: "prism", description: "획득 1라운드 후부터 2라운드마다 판 위의 내 말 또는 상대 말 1기를 골라 원하는 칸으로 이동을 시도합니다. 20%는 지정 칸, 80%는 다른 무작위 칸으로 이동하며 강제 이동 순간 잡기는 발생하지 않습니다." },
  { id: "AUG-047", status: "active", name: "강해져서 돌아오마", tier: "gold", timing: "first", description: "선택 후 바로 다음 기본 던지기가 끝나면 추가 던지기 1회를 얻고, 다음 증강의 등급이 한 단계 상승합니다." },
  { id: "AUG-048", status: "active", name: "아수라장", tier: "silver", description: "무작위 Gold 증강 1개를 즉시 획득합니다." },
  { id: "AUG-049", status: "active", name: "금빛 아수라장", tier: "gold", description: "무작위 Prism 증강 1개를 즉시 획득합니다." },
  { id: "AUG-050", status: "active", name: "폭탄!", tier: "prism", timing: "first", description: "5라운드 종료 시 판 위의 모든 말을 대기로 돌려보냅니다. 상대 묶음 수에 따라 인원별 기준으로 추가 던지기를 얻습니다." },
  { id: "AUG-051", status: "active", name: "대격변", tier: "prism", timing: "last", description: "획득 즉시 모든 플레이어의 모든 말을 대기, 무작위 판 위 위치, 완주 중 하나로 무작위 재배치합니다. 모든 업기는 해제되며 재배치 순간 잡기는 발생하지 않습니다." },
  { id: "AUG-052", status: "active", name: "메아리", tier: "silver", timing: "first", description: "가장 먼저 완주한 자신의 말의 실제 경로를 저장합니다. 이후 새로 출발하는 자신의 말 2기가 차례로 같은 갈림길 경로를 따라갑니다." },
  { id: "AUG-053", status: "active", name: "배반", tier: "gold", description: "자신의 대기 중인 말 1기를 무작위 상대 플레이어의 소유로 변경합니다. 배반한 말로 원래 주인의 말을 잡으면 추가 던지기 1회를 더 얻습니다. 배반한 말이 완주하면 원래 주인의 대기 상태로 돌아갑니다." },
  { id: "AUG-054", status: "active", name: "도를 아십니까", tier: "gold", description: "자신의 윷에서는 도가 등장하지 않으며 백도는 그대로 등장합니다. 도의 확률은 개, 걸, 윷, 모에 기존 비율대로 재분배됩니다." },
  { id: "AUG-055", status: "active", name: "산책로", tier: "silver", description: "외곽의 네 구간 중 하나가 무작위 산책로가 됩니다. 자신의 말이 산책로에서 이동을 시작하면 전진 이동량이 +1칸 증가합니다." },
  { id: "AUG-056", status: "active", name: "웜홀", tier: "prism", description: "획득 직후와 이후 2라운드마다, 자신의 기본 던지기 대신 판 위의 말 한 묶음을 웜홀에 보낼 수 있습니다. 1라운드 후 진행 방향 기준 3~18칸 앞의 무작위 유효 위치에 나타납니다." },
  { id: "AUG-057", status: "active", name: "역병", tier: "gold", description: "상대를 잡으면 그 말을 감염 상태로 만듭니다. 감염은 그 플레이어의 다음 한 턴 동안만 지속되며, 감염된 말은 대기에서 출발할 때 걸, 윷, 모가 나와야 출발할 수 있습니다." },
  { id: "AUG-058", status: "active", name: "토끼와 거북이", tier: "gold", timing: "first", description: "대기 중인 자신의 말 1기를 완주 바로 앞 칸으로 보냅니다. 그 말은 3라운드 동안 이동하거나 업을 수 없지만 상대에게 잡힐 수 있습니다." },
  { id: "AUG-059", status: "active", name: "여백의 미", tier: "prism", timing: "first", description: "말이 완주할 때마다 이후 자신의 말이 완주에 필요한 바깥 변이 하나씩 줄어듭니다. 사라진 변으로 향하는 경로는 이용할 수 없습니다." },

  // Historical identities retained for audit/history. Never offered while retired.
  { id: "AUG-060", status: "retired", name: "사냥꾼 2", family: "HUNTER", retiredReason: "Removed before the canonical ID migration." },
  { id: "AUG-061", status: "retired", name: "각자도생", retiredReason: "Removed before the canonical ID migration." },
  { id: "AUG-062", status: "retired", name: "사냥꾼 3", family: "HUNTER", retiredReason: "Removed before the canonical ID migration." },
  { id: "AUG-063", status: "retired", name: "칸은 숫자에 불과하다 2", family: "NUMBERS", retiredReason: "Removed before the canonical ID migration." },
  { id: "AUG-064", status: "retired", name: "물귀신 2", family: "WATER_GHOST", retiredReason: "Removed before the canonical ID migration." },
  { id: "AUG-065", status: "retired", name: "일심동체 2", family: "ONE_BODY", retiredReason: "Removed before the canonical ID migration." },
  { id: "AUG-066", status: "retired", name: "무임승차 구버전", retiredReason: "Old hitchhiker version removed before the canonical ID migration." },
  { id: "AUG-067", status: "retired", name: "미사용 레거시 증강", retiredReason: "Historical inactive identity; display metadata was not recovered." },
];

const LEGACY_ALIASES_BY_CANONICAL = new Map<AugmentId, string[]>();
for (const [legacyId, canonicalId] of Object.entries(LEGACY_AUGMENT_ID_MAP)) {
  const id = canonicalId as AugmentId;
  const aliases = LEGACY_ALIASES_BY_CANONICAL.get(id) ?? [];
  aliases.push(legacyId);
  LEGACY_ALIASES_BY_CANONICAL.set(id, aliases);
}

export const AUGMENT_CATALOG: AugmentDefinition[] = AUGMENT_CATALOG_ENTRIES.map((augment) => {
  const legacyAliases = LEGACY_ALIASES_BY_CANONICAL.get(augment.id) ?? [];
  return {
    ...augment,
    legacyAliases,
    randomizationKey: legacyAliases[0] ?? augment.id,
  };
});

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

export function augmentRandomizationKey(id: string) {
  const canonicalId = resolveAugmentId(id);
  if (!canonicalId) return id;
  return CANONICAL_AUGMENT_BY_ID.get(canonicalId)?.randomizationKey ?? canonicalId;
}

export function getAugment(id: string | null | undefined) {
  const canonicalId = resolveAugmentId(id);
  return canonicalId ? CANONICAL_AUGMENT_BY_ID.get(canonicalId) ?? null : null;
}

export function getActiveAugment(id: string | null | undefined) {
  const augment = getAugment(id);
  return augment?.status === "active" ? augment : null;
}
