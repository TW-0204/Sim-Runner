import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AUGMENTS } from "@/lib/augments/catalog";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function collect(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...collect(path));
    else if (/^precision-[A-Z]\d+\.json$/.test(name)) out.push(path);
  }
  return out;
}
const inputDir = argument("input-dir") ?? "precision-all-results";
const outputDir = argument("output-dir") ?? "precision-all-merged";
const files = collect(inputDir);
const payloads = files.map((file) => JSON.parse(readFileSync(file, "utf-8")) as any);
const byId = new Map(payloads.map((item) => [item.augmentId as string, item]));
const expectedIds = AUGMENTS.map((item) => item.id).sort((a, b) => a.localeCompare(b));
const missingIds = expectedIds.filter((id) => !byId.has(id));
const unexpectedIds = [...byId.keys()].filter((id) => !expectedIds.includes(id)).sort();

const pct = (value: number | null | undefined) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const pp = (value: number | null | undefined) => value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}pp`;
function cell(item: any, playerCount: number) {
  if (!item) return "MISSING";
  const contexts = item.reports.filter((row: any) => row.playerCount === playerCount).sort((a: any, b: any) => a.acquisitionIndex - b.acquisitionIndex);
  if (!contexts.length) return "—";
  return contexts.map((row: any) => `S${row.acquisitionIndex} ${pct(row.ownerWinRate)} (${pp(row.deltaPp)}), draw ${pct(row.drawRate)}, inc ${row.incompleteGames}`).join("<br>");
}

const rows = expectedIds.map((id) => {
  const definition = AUGMENTS.find((item) => item.id === id)!;
  const item = byId.get(id);
  const contexts = item?.reports ?? [];
  const deltas = contexts.map((row: any) => row.deltaPp).filter((value: any): value is number => typeof value === "number");
  const maxAbsDeltaPp = deltas.length ? Math.max(...deltas.map(Math.abs)) : null;
  const maxDrawRate = contexts.length ? Math.max(...contexts.map((row: any) => row.drawRate ?? 0)) : null;
  const incompleteGames = contexts.reduce((sum: number, row: any) => sum + (row.incompleteGames ?? 0), 0);
  return {
    augmentId: id,
    name: definition.name,
    tier: definition.tier,
    special: Boolean(definition.special),
    timing: definition.timing ?? "any",
    available: Boolean(item),
    maxAbsDeltaPp,
    maxDrawRate,
    incompleteGames,
    reports: contexts,
  };
});

const markdown = [
  "# All-Augment Forced Precision Audit",
  "",
  `- active augments expected: ${expectedIds.length}`,
  `- precision artifacts found: ${payloads.length}`,
  `- missing: ${missingIds.length ? missingIds.join(", ") : "none"}`,
  `- unexpected: ${unexpectedIds.length ? unexpectedIds.join(", ") : "none"}`,
  "- S1/S2 are forced acquisition slots. Win rates use decisive games only; draw rate is reported separately.",
  "- This is a forced-acquisition effect check, not natural-pick causal proof.",
  "",
  "| Augment | Tier | 2P | 3P | 4P | Max | Incomplete |",
  "|---|---|---|---|---|---:|---:|",
  ...rows.map((row) => `| ${row.augmentId} ${row.name}${row.special ? " [Special]" : ""} | ${row.tier} | ${cell(byId.get(row.augmentId), 2)} | ${cell(byId.get(row.augmentId), 3)} | ${cell(byId.get(row.augmentId), 4)} | ${row.maxAbsDeltaPp == null ? "—" : `${row.maxAbsDeltaPp.toFixed(1)}pp`} | ${row.incompleteGames} |`),
  "",
].join("\n");

const report = {
  generatedAt: new Date().toISOString(),
  expectedAugmentCount: expectedIds.length,
  foundAugmentCount: payloads.length,
  missingIds,
  unexpectedIds,
  rows,
};
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, "precision-all-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
writeFileSync(join(outputDir, "precision-all-report.md"), `${markdown}\n`, "utf-8");
console.log(markdown);
if (missingIds.length || unexpectedIds.length) process.exitCode = 2;
