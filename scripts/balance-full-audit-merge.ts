import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AUGMENTS } from "@/lib/augments/catalog";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const naturalPath = argument("natural") ?? "audit-input/natural/independent-90k-report.json";
const precisionPath = argument("precision") ?? "audit-input/precision/precision-all-report.json";
const diagnosticsPath = argument("diagnostics") ?? "audit-input/diagnostics/incomplete-diagnostics.json";
const outputDir = argument("output-dir") ?? "full-audit-report";

const natural = JSON.parse(readFileSync(naturalPath, "utf-8")) as any;
const precision = JSON.parse(readFileSync(precisionPath, "utf-8")) as any;
const diagnostics = existsSync(diagnosticsPath) ? JSON.parse(readFileSync(diagnosticsPath, "utf-8")) as any : null;
const naturalById = new Map((natural.rows ?? []).map((row: any) => [row.augmentId, row]));
const precisionById = new Map((precision.rows ?? []).map((row: any) => [row.augmentId, row]));
const diagById = new Map((diagnostics?.augmentRows ?? []).map((row: any) => [row.id, row]));

const pct = (value: number | null | undefined) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const pp = (value: number | null | undefined) => value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}pp`;
function naturalCell(row: any, pc: 2 | 3 | 4) {
  const cell = row?.byPlayerCount?.[pc];
  if (!cell) return "—";
  return `${pct(cell.pooledWinRate)} (${pp(cell.deltaPp)}), draw ${pct(cell.drawRate)}, n=${cell.gamesOwned}`;
}
function forcedCell(row: any, pc: 2 | 3 | 4) {
  const contexts = (row?.reports ?? []).filter((item: any) => item.playerCount === pc).sort((a: any, b: any) => a.acquisitionIndex - b.acquisitionIndex);
  if (!contexts.length) return "—";
  return contexts.map((item: any) => `S${item.acquisitionIndex} ${pct(item.ownerWinRate)} (${pp(item.deltaPp)}), D ${pct(item.drawRate)}`).join(" / ");
}

const rows = AUGMENTS.map((augment) => {
  const n = naturalById.get(augment.id) as any;
  const p = precisionById.get(augment.id) as any;
  const d = diagById.get(augment.id) as any;
  const naturalDeltas = ([2, 3, 4] as const).map((pc) => n?.byPlayerCount?.[pc]?.deltaPp).filter((v): v is number => typeof v === "number");
  const forcedDeltas = (p?.reports ?? []).map((item: any) => item.deltaPp).filter((v: any): v is number => typeof v === "number");
  const naturalMaxAbs = naturalDeltas.length ? Math.max(...naturalDeltas.map(Math.abs)) : null;
  const forcedMaxAbs = forcedDeltas.length ? Math.max(...forcedDeltas.map(Math.abs)) : null;
  const incompleteEnrichment = d?.overallEnrichment ?? null;
  const incompleteHits = d?.totalIncompleteContaining ?? 0;
  let auditFlag = "OK";
  if (augment.special) auditFlag = "SPECIAL_REVIEW";
  if (incompleteEnrichment != null && incompleteEnrichment >= 2 && incompleteHits >= 5) auditFlag = "INCOMPLETE_RISK";
  if (!augment.special && (naturalMaxAbs != null && naturalMaxAbs >= 8 || forcedMaxAbs != null && forcedMaxAbs >= 10)) auditFlag = "HIGH_REVIEW";
  else if (!augment.special && auditFlag === "OK" && (naturalMaxAbs != null && naturalMaxAbs >= 4.5 || forcedMaxAbs != null && forcedMaxAbs >= 7)) auditFlag = "REVIEW";
  return {
    augmentId: augment.id,
    name: augment.name,
    tier: augment.tier,
    special: Boolean(augment.special),
    timing: augment.timing ?? "any",
    auditFlag,
    naturalMaxAbsDeltaPp: naturalMaxAbs,
    forcedMaxAbsDeltaPp: forcedMaxAbs,
    incompleteEnrichment,
    incompleteHits,
    natural: n ?? null,
    precision: p ?? null,
    diagnostics: d ?? null,
  };
}).sort((a, b) => {
  const rank: Record<string, number> = { INCOMPLETE_RISK: 0, SPECIAL_REVIEW: 1, HIGH_REVIEW: 2, REVIEW: 3, OK: 4 };
  return (rank[a.auditFlag] ?? 9) - (rank[b.auditFlag] ?? 9) || a.augmentId.localeCompare(b.augmentId);
});

const markdown = [
  "# Augment Yut Full Balance Audit",
  "",
  `- active augments: ${AUGMENTS.length}`,
  `- natural games requested: ${natural.totalGames?.toLocaleString?.() ?? natural.totalGames}`,
  `- natural decisive games: ${(natural.totalGames - (natural.totalDraws ?? 0) - (natural.totalIncomplete ?? 0)).toLocaleString()}`,
  `- natural draws: ${(natural.totalDraws ?? 0).toLocaleString()} (${pct((natural.totalDraws ?? 0) / natural.totalGames)})`,
  `- natural incomplete: ${(natural.totalIncomplete ?? 0).toLocaleString()}`,
  `- forced precision coverage: ${precision.foundAugmentCount}/${precision.expectedAugmentCount}`,
  `- old-seed incomplete diagnostics: ${diagnostics ? `${diagnostics.totalIncomplete}/${diagnostics.totalGames}` : "not available"}`,
  "- Natural allocation is observational. Forced precision checks effect under forced ownership and is not a substitute for live-player testing.",
  "- Audit flags are triage only, not automatic nerf/buff decisions.",
  "",
  "| Augment | Flag | Natural 2P | Natural 3P | Natural 4P | Forced 2P | Forced 3P | Forced 4P | Incomplete enrichment |",
  "|---|---|---|---|---|---|---|---|---:|",
  ...rows.map((row) => `| ${row.augmentId} ${row.name}${row.special ? " [Special]" : ""} | ${row.auditFlag} | ${naturalCell(row.natural, 2)} | ${naturalCell(row.natural, 3)} | ${naturalCell(row.natural, 4)} | ${forcedCell(row.precision, 2)} | ${forcedCell(row.precision, 3)} | ${forcedCell(row.precision, 4)} | ${row.incompleteEnrichment == null ? "—" : `${row.incompleteEnrichment.toFixed(2)}× (${row.incompleteHits})`} |`),
  "",
  "## Coverage checks",
  "",
  `- natural active catalog count: ${natural.activeCatalogAugmentCount ?? "—"}`,
  `- natural observed augment IDs: ${natural.observedAugmentIdCount ?? "—"}`,
  `- forced precision missing IDs: ${(precision.missingIds ?? []).length ? precision.missingIds.join(", ") : "none"}`,
  `- forced precision unexpected IDs: ${(precision.unexpectedIds ?? []).length ? precision.unexpectedIds.join(", ") : "none"}`,
  "",
].join("\n");

const report = {
  generatedAt: new Date().toISOString(),
  activeAugmentCount: AUGMENTS.length,
  naturalSummary: {
    totalGames: natural.totalGames,
    totalDraws: natural.totalDraws ?? 0,
    totalIncomplete: natural.totalIncomplete ?? 0,
    activeCatalogAugmentCount: natural.activeCatalogAugmentCount,
    observedAugmentIdCount: natural.observedAugmentIdCount,
  },
  precisionSummary: {
    expectedAugmentCount: precision.expectedAugmentCount,
    foundAugmentCount: precision.foundAugmentCount,
    missingIds: precision.missingIds,
    unexpectedIds: precision.unexpectedIds,
  },
  diagnosticSummary: diagnostics ? {
    totalGames: diagnostics.totalGames,
    totalIncomplete: diagnostics.totalIncomplete,
    statusCounts: diagnostics.statusCounts,
    topPairs: diagnostics.topPairs,
    topErrors: diagnostics.topErrors,
    topRounds: diagnostics.topRounds,
  } : null,
  rows,
};
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, "full-balance-audit.json"), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
writeFileSync(join(outputDir, "full-balance-audit.md"), `${markdown}\n`, "utf-8");
console.log(markdown);
