export type AugmentTier = "silver" | "gold" | "prism";
export type AugmentTiming = "any" | "first" | "last" | "not-last";

export type AugmentDefinition = {
  id: string;
  name: string;
  tier: AugmentTier;
  description: string;
  timing?: AugmentTiming;
  family?: string;
  requires?: string;
  special?: boolean;
  uniquePerGame?: boolean;
  conflicts?: string[];
};

const fixedRollConflicts = ["G03", "G04", "G05", "S11", "P12", "P19"];

export const AUGMENTS: AugmentDefinition[] = [
  { id: "S01", name: "사냥꾼 1", tier: "silver", family: "HUNTER", description: "상대를 잡아 얻은 추가 던지기의 전진 이동량이 +1칸 증가합니다." },
  { id: "S02", name: "어부바", tier: "silver", description: "자신의 말을 새로 업을 때마다 추가 던지기 1회를 얻습니다." },
  { id: "S03", name: "도찐개찐", tier: "silver", description: "도와 백도는 각각 1칸 대신 2칸 이동합니다." },
  { id: "S04", name: "돌파", tier: "silver", description: "자신의 말이 누적 4회 잡히면 이후 모든 자신의 말이 잡히지 않습니다." },
  { id: "S05", name: "안전벨트", tier: "silver", description: "2개 이상 업힌 말이 잡혀도 상대는 그 잡기로 추가 던지기를 얻지 못합니다." },
  { id: "S06", name: "출발이 반", tier: "silver", description: "말이 대기 상태에서 말판으로 출발할 때마다 그 이동량이 +1칸 증가합니다." },
  { id: "S07", name: "분풀이", tier: "silver", description: "자신의 말이 잡히면 다음 기본 던지기의 전진 이동량이 +1칸 증가합니다." },
  { id: "S08", name: "막판 스퍼트", tier: "silver", description: "말 3개가 완주하면 마지막 남은 말의 전진 이동량이 +1칸 증가합니다." },
  { id: "S09", name: "걸작", tier: "silver", description: "걸은 3칸 대신 4칸 이동합니다. 결과의 정체성은 여전히 걸입니다." },
  { id: "S10", name: "후진 가속", tier: "silver", description: "백도로 실제 후진에 성공하면 원하는 말에 쓸 수 있는 1칸 이동권을 얻습니다." },
  { id: "S11", name: "반격의 서막", tier: "silver", conflicts: fixedRollConflicts.filter((id) => id !== "S11"), description: "말이 잡힌 다음 턴의 첫 기본 던지기를 두 번 하고 원하는 결과를 선택합니다." },
  { id: "S12", name: "아깝다", tier: "silver", description: "게임 중 최대 2번, 기본 던지기에서 도가 나오면 버리고 다시 던질 수 있습니다." },
  { id: "S13", name: "자리비움", tier: "silver", timing: "first", description: "2라운드 동안 턴을 쉬고, 이후 3번째 증강 전까지 기본 던지기 전진 이동량이 +1칸 증가합니다." },
  { id: "S14", name: "나 홀로 집에", tier: "silver", description: "갈림길에 정확히 도착한 말은 그 말의 다음 전진 이동량이 +1칸 증가합니다." },
  { id: "S15", name: "친구와 함께", tier: "silver", description: "이동을 마친 뒤 경로 기준 앞뒤 1칸의 아군 한 묶음을 불러와 업을 수 있습니다." },

  { id: "G01", name: "개판", tier: "gold", description: "개가 추가 던지기를 만들고, 윷과 모는 더 이상 추가 던지기를 만들지 않습니다." },
  { id: "G02", name: "사냥꾼 2", tier: "gold", family: "HUNTER", requires: "S01", description: "상대를 잡아 얻은 추가 던지기의 전진 이동량이 +2칸 증가합니다." },
  { id: "G03", name: "도개걸윷모", tier: "gold", conflicts: fixedRollConflicts.filter((id) => id !== "G03"), description: "다음 5회의 기본 던지기가 도→개→걸→윷→모 순서로 고정됩니다." },
  { id: "G04", name: "모윷걸개도", tier: "gold", conflicts: fixedRollConflicts.filter((id) => id !== "G04"), description: "다음 5회의 기본 던지기가 모→윷→걸→개→도 순서로 고정됩니다." },
  { id: "G05", name: "모 아니면 도", tier: "gold", conflicts: fixedRollConflicts.filter((id) => id !== "G05"), description: "다음 5회의 기본 던지기는 각각 50% 확률로 모 또는 도가 나옵니다." },
  { id: "G06", name: "골목대장", tier: "gold", description: "갈림길에 정확히 도착하면 상대의 통과를 한 번 막아 바로 앞 칸에 세울 수 있습니다." },
  { id: "G07", name: "자리 맡아놨어", tier: "gold", description: "갈림길을 혼자 지키는 말을 제외한 다른 자신의 말들의 전진 이동량이 +1칸 증가합니다." },
  { id: "G08", name: "일심동체 1", tier: "gold", family: "ONE_BODY", description: "2개 이상 업힌 자신의 말 묶음의 전진 이동량이 +1칸 증가합니다." },
  { id: "G09", name: "칸은 숫자에 불과하다 1", tier: "gold", family: "NUMBERS", description: "양수 이동 결과 하나를 정확히 둘로 나누어 서로 다른 두 말에 사용할 수 있습니다." },
  { id: "G10", name: "추격자", tier: "gold", description: "이동 경로 위 상대에게 일찍 멈춰 그 말을 잡을 수 있습니다." },
  { id: "G11", name: "보험 들었습니다", tier: "gold", description: "업힌 말 묶음이 잡힐 때 직접 고른 말 1개만 대기로 돌아가고 나머지는 그 칸에 남습니다." },
  { id: "G12", name: "물귀신 1", tier: "gold", family: "WATER_GHOST", description: "자신을 잡은 상대 말 묶음의 다음 이동 거리를 1칸으로 고정합니다." },
  { id: "G13", name: "내일의 나에게", tier: "gold", description: "턴마다 사용하지 않은 이동 결과 하나를 다음 턴까지 저장할 수 있습니다." },
  { id: "G14", name: "각자도생", tier: "gold", description: "업힌 자신의 말이 갈림길에 정확히 도착하면 원하는 방식으로 분리할 수 있습니다." },
  { id: "G15", name: "육상선수", tier: "gold", conflicts: ["P16"], description: "상대를 잡을 수 없는 대신, 한 턴의 이동을 잡기와 업기 없이 끝내면 추가 던지기 1회를 얻습니다." },
  { id: "G16", name: "에이스", tier: "gold", description: "증강 획득 시 대표 말 하나를 지정하며, 그 말이 포함된 묶음의 전진 이동량이 +1칸 증가합니다." },

  { id: "P01", name: "사냥꾼 3", tier: "prism", family: "HUNTER", requires: "G02", description: "상대를 잡아 얻는 모든 추가 던지기의 결과가 윷으로 고정됩니다." },
  { id: "P02", name: "문워크", tier: "prism", timing: "last", special: true, uniquePerGame: true, description: "획득 후 양수 이동은 말판 전체를 역방향으로 진행하고 백도는 정방향으로 진행합니다. 자신의 네 말을 모두 대기로 되돌리면 즉시 승리합니다." },
  { id: "P03", name: "사방신", tier: "prism", timing: "first", special: true, uniquePerGame: true, description: "중앙을 제외한 네 갈림길을 자신의 말로 동시에 모두 차지하면 즉시 승리합니다." },
  { id: "P04", name: "우주의 중심", tier: "prism", timing: "first", special: true, uniquePerGame: true, conflicts: ["P10"], description: "어느 모퉁이에서든 중앙으로 향할지 기존 경로를 계속 갈지 선택할 수 있습니다. 중앙에 있는 자신의 말은 잡히지 않습니다. 자신의 말 4개를 중앙에 하나의 묶음으로 만들면 즉시 승리합니다." },
  { id: "P05", name: "칸은 숫자에 불과하다 2", tier: "prism", family: "NUMBERS", requires: "G09", description: "모든 양수 이동 거리를 합쳐 원하는 수의 이동으로 자유롭게 다시 나눌 수 있습니다." },
  { id: "P06", name: "청소부", tier: "prism", description: "다음 3번의 이동은 지나가는 모든 칸과 도착 칸의 상대를 전부 잡습니다." },
  { id: "P07", name: "물귀신 2", tier: "prism", family: "WATER_GHOST", requires: "G12", description: "자신의 말을 잡은 상대 말 묶음도 함께 대기로 돌아갑니다." },
  { id: "P08", name: "일타쌍피", tier: "prism", description: "도착 칸의 상대를 잡을 때 경로 기준 앞뒤 1칸의 상대 한 묶음도 함께 잡을 수 있습니다." },
  { id: "P09", name: "길은 내가 만든다", tier: "prism", description: "갈림길에 정확히 멈추지 않아도 지나가는 순간 원하는 지름길로 진입할 수 있습니다." },
  { id: "P10", name: "고속 질주", tier: "prism", conflicts: ["P04"], description: "모든 전진 이동량이 +2칸 증가하지만 지름길을 사용할 수 없습니다." },
  { id: "P11", name: "대동단결", tier: "prism", description: "게임 중 한 번, 말판 위 자신의 모든 말을 선택한 자신의 말 위치로 모아 즉시 업습니다." },
  { id: "P12", name: "양자택일", tier: "prism", conflicts: fixedRollConflicts.filter((id) => id !== "P12"), description: "모든 기본 던지기를 두 번 하고 원하는 결과 하나를 선택합니다." },
  { id: "P13", name: "성역", tier: "prism", conflicts: ["P03"], description: "갈림길에 도착한 자신의 말은 떠날 때까지 잡히지 않으며 상대는 그 갈림길을 통과할 수 없습니다." },
  { id: "P14", name: "독주", tier: "prism", timing: "first", special: true, description: "대표 말 하나만 사용할 수 있으며 그 말로 말판을 두 바퀴 완주하면 승리합니다." },
  { id: "P15", name: "일심동체 2", tier: "prism", family: "ONE_BODY", requires: "G08", description: "업힌 말 수에 따라 전진 이동량이 2개 +1, 3개 +2, 4개 +3칸 증가합니다." },
  { id: "P16", name: "추노", tier: "prism", timing: "first", special: true, conflicts: ["G15"], description: "기본 승리 조건 대신 상대 말 잡기를 2인 6회, 3인 7회, 4인 8회 달성하면 즉시 승리합니다." },
  { id: "P17", name: "독불장군", tier: "prism", description: "자신의 말도 잡을 수 있으며 아군을 잡으면 추가 던지기 2회를 얻습니다." },
  { id: "P18", name: "무임승차", tier: "prism", description: "자신의 이동 경로에서 지나친 아군 한 묶음을 도착 칸으로 불러와 업을 수 있습니다." },
  { id: "P19", name: "신의 손", tier: "prism", timing: "not-last", conflicts: fixedRollConflicts.filter((id) => id !== "P19"), description: "획득 즉시 1회 충전되며 이후 기본 던지기 3회마다 다음 기본 결과를 원하는 도·개·걸·윷·모로 바꿀 수 있습니다." },
];

export const AUGMENT_BY_ID = new Map(AUGMENTS.map((augment) => [augment.id, augment]));

export function getAugment(id: string) {
  return AUGMENT_BY_ID.get(id) ?? null;
}
