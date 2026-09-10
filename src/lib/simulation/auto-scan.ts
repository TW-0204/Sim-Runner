import { AUGMENTS, type AugmentDefinition } from "@/lib/augments/catalog";
import type { BatchSummary } from "./types";

export type BalanceScanSeverity = "EXCLUDED" | "LOW_SAMPLE" | "OK" | "WATCH" | "CRITICAL";
export type BalanceScanDirection = "OVER" | "UNDER" | "NEUTRAL";

export type BalanceScanCell = {
  playerCount: 2 | 3 | 4;
  gamesOwned: number;
  wins: number;
  winRate: number | null;
  baselineWinRate: number;
  deltaPp: number | null;
  ci95Low: number | null;
  ci95High: number | null;
  severity: BalanceScanSeverity;
  direction: BalanceScanDirection;
  specialWins: number;
  triggerRate: number | null;
  averageTriggersPerOwnedGame: number | null;
};

export type BalanceScanRow = {
  augmentId: string;
  name: string;
  tier: AugmentDefinition["tier"];
  special: boolean;
  excluded: boolean;
  overallSeverity: BalanceScanSeverity;
  precisionRecommended: boolean;
  precisionReason: "OUTLIER" | "RARE_SPECIAL" | null;
  byPlayerCount: Record<2 | 3 | 4, BalanceScanCell>;
};

export type BalanceScanReport = {
  rulesetId: string;
  generatedAt: string;
  gamesPerPlayerCount: number;
  totalGamesSimulated: number;
  minSamples: number;
  incompleteGames: number;
  excludedAugmentIds: string[];
  criticalCount: number;
  watchCount: number;
  lowSampleCount: number;
  precisionTargets: string[];
  rows: BalanceScanRow[];
};

const PLAYER_COUNTS = [2, 3, 4] as const;

function wilsonInterval(wins: number, total: number, z = 1.96) {
  if (total <= 0) return { low: null, high: null };
  const p = wins / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / denominator;
  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  };
}

function directionForDelta(deltaPp: number | null): BalanceScanDirection {
  if (deltaPp == null || Math.abs(deltaPp) < 0.5) return "NEUTRAL";
  return deltaPp > 0 ? "OVER" : "UNDER";
}

export function classifyAugmentStat(args: {
  playerCount: 2 | 3 | 4;
  gamesOwned: number;
  wins: number;
  minSamples: number;
  excluded?: boolean;
}) {
  const baselineWinRate = 1 / args.playerCount;
  if (args.excluded) {
    return {
      baselineWinRate,
      winRate: null,
      deltaPp: null,
      ci95Low: null,
      ci95High: null,
      severity: "EXCLUDED" as BalanceScanSeverity,
      direction: "NEUTRAL" as BalanceScanDirection,
    };
  }

  if (args.gamesOwned < args.minSamples) {
    const winRate = args.gamesOwned > 0 ? args.wins / args.gamesOwned : null;
    const deltaPp = winRate == null ? null : (winRate - baselineWinRate) * 100;
    const interval = wilsonInterval(args.wins, args.gamesOwned);
    return {
      baselineWinRate,
      winRate,
      deltaPp,
      ci95Low: interval.low,
      ci95High: interval.high,
      severity: "LOW_SAMPLE" as BalanceScanSeverity,
      direction: directionForDelta(deltaPp),
    };
  }

  const winRate = args.wins / args.gamesOwned;
  const deltaPp = (winRate - baselineWinRate) * 100;
  const interval = wilsonInterval(args.wins, args.gamesOwned);
  const statisticallySeparated = interval.low != null
    && interval.high != null
    && (baselineWinRate < interval.low || baselineWinRate > interval.high);
  const absoluteDelta = Math.abs(deltaPp);
  const severity: BalanceScanSeverity = statisticallySeparated && absoluteDelta >= 10
    ? "CRITICAL"
    : statisticallySeparated && absoluteDelta >= 5
      ? "WATCH"
      : "OK";

  return {
    baselineWinRate,
    winRate,
    deltaPp,
    ci95Low: interval.low,
    ci95High: interval.high,
    severity,
    direction: directionForDelta(deltaPp),
  };
}

function overallSeverity(cells: BalanceScanCell[], excluded: boolean): BalanceScanSeverity {
  if (excluded) return "EXCLUDED";
  if (cells.some((cell) => cell.severity === "CRITICAL")) return "CRITICAL";
  if (cells.some((cell) => cell.severity === "WATCH")) return "WATCH";
  if (cells.every((cell) => cell.severity === "LOW_SAMPLE")) return "LOW_SAMPLE";
  return "OK";
}

function severityRank(severity: BalanceScanSeverity) {
  if (severity === "CRITICAL") return 0;
  if (severity === "WATCH") return 1;
  if (severity === "LOW_SAMPLE") return 2;
  if (severity === "OK") return 3;
  return 4;
}

export function buildBalanceScanReport(args: {
  rulesetId: string;
  summaries: BatchSummary[];
  gamesPerPlayerCount: number;
  minSamples: number;
  incompleteGames?: number;
  excludedAugmentIds?: string[];
  generatedAt?: string;
}): BalanceScanReport {
  const summaries = new Map(args.summaries.map((summary) => [summary.playerCount, summary]));
  const excludedIds = new Set(args.excludedAugmentIds ?? []);

  const rows: BalanceScanRow[] = AUGMENTS.map((augment) => {
    const excluded = excludedIds.has(augment.id);
    const cells = PLAYER_COUNTS.map((playerCount) => {
      const stats = summaries.get(playerCount)?.augmentWinStats[augment.id];
      const classified = classifyAugmentStat({
        playerCount,
        gamesOwned: stats?.gamesOwned ?? 0,
        wins: stats?.wins ?? 0,
        minSamples: args.minSamples,
        excluded,
      });
      return {
        playerCount,
        gamesOwned: stats?.gamesOwned ?? 0,
        wins: stats?.wins ?? 0,
        winRate: classified.winRate,
        baselineWinRate: classified.baselineWinRate,
        deltaPp: classified.deltaPp,
        ci95Low: classified.ci95Low,
        ci95High: classified.ci95High,
        severity: classified.severity,
        direction: classified.direction,
        specialWins: stats?.specialWins ?? 0,
        triggerRate: stats ? stats.triggerRate : null,
        averageTriggersPerOwnedGame: stats ? stats.averageTriggersPerOwnedGame : null,
      } satisfies BalanceScanCell;
    });

    const severity = overallSeverity(cells, excluded);
    const rareSpecial = Boolean(augment.special) && cells.some((cell) => cell.severity === "LOW_SAMPLE");
    const outlier = severity === "CRITICAL" || severity === "WATCH";
    return {
      augmentId: augment.id,
      name: augment.name,
      tier: augment.tier,
      special: Boolean(augment.special),
      excluded,
      overallSeverity: severity,
      precisionRecommended: !excluded && (outlier || rareSpecial),
      precisionReason: excluded ? null : outlier ? "OUTLIER" : rareSpecial ? "RARE_SPECIAL" : null,
      byPlayerCount: {
        2: cells[0],
        3: cells[1],
        4: cells[2],
      },
    };
  }).sort((a, b) => {
    const severityDelta = severityRank(a.overallSeverity) - severityRank(b.overallSeverity);
    if (severityDelta !== 0) return severityDelta;
    if (a.tier !== b.tier) return a.tier.localeCompare(b.tier);
    return a.augmentId.localeCompare(b.augmentId);
  });

  return {
    rulesetId: args.rulesetId,
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    gamesPerPlayerCount: args.gamesPerPlayerCount,
    totalGamesSimulated: args.gamesPerPlayerCount * PLAYER_COUNTS.length,
    minSamples: args.minSamples,
    incompleteGames: args.incompleteGames ?? 0,
    excludedAugmentIds: [...excludedIds],
    criticalCount: rows.filter((row) => row.overallSeverity === "CRITICAL").length,
    watchCount: rows.filter((row) => row.overallSeverity === "WATCH").length,
    lowSampleCount: rows.filter((row) => row.overallSeverity === "LOW_SAMPLE").length,
    precisionTargets: rows.filter((row) => row.precisionRecommended).map((row) => row.augmentId),
    rows,
  };
}

function percent(value: number | null, digits = 1) {
  return value == null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function cellText(cell: BalanceScanCell) {
  if (cell.severity === "EXCLUDED") return "제외";
  if (cell.winRate == null) return `표본 없음 (n=${cell.gamesOwned})`;
  const delta = cell.deltaPp == null ? "" : `${cell.deltaPp >= 0 ? "+" : ""}${cell.deltaPp.toFixed(1)}%p`;
  return `${percent(cell.winRate)} (${delta}, n=${cell.gamesOwned})`;
}

function statusText(row: BalanceScanRow) {
  if (row.overallSeverity === "CRITICAL") return "🔴 강한 이상치";
  if (row.overallSeverity === "WATCH") return "🟡 관찰";
  if (row.overallSeverity === "LOW_SAMPLE") return "⚪ 표본 부족";
  if (row.overallSeverity === "EXCLUDED") return "⏸ 제외";
  return "✅ 정상권";
}

export function renderBalanceScanMarkdown(report: BalanceScanReport) {
  const lines = [
    `# Balance Auto Scan — ${report.rulesetId}`,
    "",
    `- 생성: ${report.generatedAt}`,
    `- 시뮬레이션: 2/3/4인 각각 ${report.gamesPerPlayerCount.toLocaleString()}판, 총 ${report.totalGamesSimulated.toLocaleString()}판`,
    `- 최소 유효 표본: 증강 보유 ${report.minSamples.toLocaleString()}판`,
    `- 미완료 게임: ${report.incompleteGames.toLocaleString()}판`,
    `- 강한 이상치 ${report.criticalCount}개 / 관찰 ${report.watchCount}개 / 전체 인원 표본 부족 ${report.lowSampleCount}개`,
    "",
    "> 이 표의 승률은 자연 배정된 증강 보유자의 봇 승률입니다. 인과효과의 확정값이 아니라 전체 풀에서 이상치를 찾는 1차 스캔용입니다. 표본 부족 또는 이상치 카드만 별도 강제 시뮬레이션으로 확인합니다.",
    "",
    "| 증강 | 등급 | 2인 | 3인 | 4인 | 판정 | 정밀검사 |",
    "|---|---|---:|---:|---:|---|---|",
  ];

  for (const row of report.rows) {
    lines.push(`| ${row.augmentId} ${row.name} | ${row.tier} | ${cellText(row.byPlayerCount[2])} | ${cellText(row.byPlayerCount[3])} | ${cellText(row.byPlayerCount[4])} | ${statusText(row)} | ${row.precisionRecommended ? `필요 (${row.precisionReason})` : "—"} |`);
  }

  lines.push("", "## 정밀검사 후보", "");
  if (!report.precisionTargets.length) lines.push("없음");
  else lines.push(report.precisionTargets.map((id) => `\`${id}\``).join(", "));
  lines.push("");
  return lines.join("\n");
}
