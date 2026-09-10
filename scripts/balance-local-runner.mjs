import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positiveInteger(name, value, fallback) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`--${name} must be a positive integer.`);
  return parsed;
}

function runSync(command, args, { cwd, quiet = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf-8",
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = quiet ? `\n${result.stderr || result.stdout || ""}` : "";
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.${detail}`);
  }
  return quiet ? (result.stdout || "").trim() : "";
}

function findPython() {
  for (const candidate of ["python3", "python"]) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf-8" });
    if (!probe.error && probe.status === 0) return candidate;
  }
  throw new Error("Python 3 is required because the current balance stack is applied by Python patch scripts.");
}

function pipeLines(stream, target, prefix) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += String(chunk);
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.length) target.write(`${prefix}${line}\n`);
    }
  });
  stream.on("end", () => {
    if (buffer.length) target.write(`${prefix}${buffer}\n`);
  });
}

function runAsync(command, args, { cwd, label }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    pipeLines(child.stdout, process.stdout, `[${label}] `);
    pipeLines(child.stderr, process.stderr, `[${label}] `);
    child.on("error", rejectPromise);
    child.on("close", (code, signal) => resolvePromise({ code: code ?? 1, signal }));
  });
}

const games = positiveInteger("games", argument("games"), 6000);
const batchesPerPlayerCount = positiveInteger("batches", argument("batches"), 5);
const concurrency = positiveInteger("concurrency", argument("concurrency"), 5);
const maxRounds = positiveInteger("max-rounds", argument("max-rounds"), 30);
const minSamples = positiveInteger("min-samples", argument("min-samples"), 200);
const ruleset = argument("ruleset") ?? "two-aug-start-r4-special-slots-v2";

const repoRoot = runSync("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd(), quiet: true });
const headSha = runSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, quiet: true });
const dirty = runSync("git", ["status", "--porcelain"], { cwd: repoRoot, quiet: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const outputRoot = resolve(repoRoot, argument("output-dir") ?? join("local-balance-results", stamp));
const batchOutputDir = join(outputRoot, "batches");
const mergedOutputDir = join(outputRoot, "merged");
mkdirSync(batchOutputDir, { recursive: true });
mkdirSync(mergedOutputDir, { recursive: true });

const tempParent = mkdtempSync(join(tmpdir(), "augment-yut-balance-"));
const worktreeDir = join(tempParent, "worktree");
const python = findPython();
const startedAt = Date.now();

const patchScripts = [
  "scripts/apply-confirmed-balance-v1.py",
  "scripts/apply-g15-g01-v5.py",
  "scripts/apply-g01-g15-v6.py",
  "scripts/apply-balance-v7.py",
  "scripts/apply-ideas-batch1.py",
  "scripts/apply-ideas-batch2.py",
  "scripts/apply-ideas-batch3.py",
  "scripts/apply-ideas-batch4.py",
  "scripts/apply-ideas-batch5.py",
  "scripts/apply-ideas-batch6.py",
  "scripts/apply-ideas-batch7.py",
  "scripts/apply-ideas-batch8.py",
  "scripts/apply-ideas-batch8-fix.py",
  "scripts/apply-ideas-batch9.py",
  "scripts/apply-ideas-batch10.py",
  "scripts/apply-ideas-batch11.py",
  "scripts/apply-augment-rough-balance-v1.py",
  "scripts/apply-augment-rough-balance-v2.py",
  "scripts/run-balance-rework-v3.py",
  "scripts/apply-balance-rework-v3-plague-duration.py",
  "scripts/apply-balance-rework-v3-stall-fix.py",
  "scripts/apply-simulation-round-cap.py",
];

const seedBases = new Map([
  [2, 800000],
  [3, 900000],
  [4, 1000000],
]);

let worktreeAdded = false;
try {
  console.log(`Local balance runner`);
  console.log(`- HEAD: ${headSha}`);
  console.log(`- games: ${games.toLocaleString()} × ${batchesPerPlayerCount} batches × 3 player counts = ${(games * batchesPerPlayerCount * 3).toLocaleString()}`);
  console.log(`- concurrency: ${concurrency}`);
  console.log(`- round cap: ${maxRounds} (DRAW after Round ${maxRounds})`);
  console.log(`- output: ${outputRoot}`);
  if (dirty) console.log("- note: uncommitted working-tree changes are ignored; the runner uses committed HEAD in an isolated worktree.");

  runSync("git", ["worktree", "add", "--detach", worktreeDir, headSha], { cwd: repoRoot });
  worktreeAdded = true;

  console.log("\nApplying current balance patch stack...");
  for (const script of patchScripts) runSync(python, [script], { cwd: worktreeDir });

  console.log("\nRunning mechanics probe...");
  runSync(process.execPath, ["--import", "./scripts/register-ts-hooks.mjs", "scripts/balance-rework-v3-probe.ts"], { cwd: worktreeDir });

  const jobs = [];
  for (const playerCount of [2, 3, 4]) {
    const seedBase = seedBases.get(playerCount);
    for (let batchId = 1; batchId <= batchesPerPlayerCount; batchId += 1) {
      jobs.push({
        playerCount,
        batchId,
        seedStart: seedBase + (batchId - 1) * games,
      });
    }
  }

  console.log(`\nRunning ${jobs.length} batches with up to ${Math.min(concurrency, jobs.length)} concurrent processes...`);
  const outcomes = new Array(jobs.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= jobs.length) return;
      const job = jobs[index];
      const label = `${job.playerCount}p#${job.batchId}`;
      const args = [
        "--import", "./scripts/register-ts-hooks.mjs",
        "scripts/balance-independent-batch.ts",
        "--ruleset", ruleset,
        "--player-count", String(job.playerCount),
        "--batch-id", String(job.batchId),
        "--seed-start", String(job.seedStart),
        "--games", String(games),
        "--max-rounds", String(maxRounds),
        "--output-dir", batchOutputDir,
        "--fail-on-incomplete",
      ];
      outcomes[index] = { job, ...(await runAsync(process.execPath, args, { cwd: worktreeDir, label })) };
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));

  console.log("\nMerging batch reports...");
  runSync(process.execPath, [
    "--import", "./scripts/register-ts-hooks.mjs",
    "scripts/balance-independent-merge.ts",
    "--input-dir", batchOutputDir,
    "--output-dir", mergedOutputDir,
    "--min-samples", String(minSamples),
    "--expected-batches", String(batchesPerPlayerCount),
  ], { cwd: worktreeDir });

  const reportPath = join(mergedOutputDir, "independent-90k-report.json");
  const report = JSON.parse(readFileSync(reportPath, "utf-8"));
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  const failedBatches = outcomes.filter((outcome) => outcome.code !== 0);

  const runMetadata = {
    generatedAt: new Date().toISOString(),
    headSha,
    ruleset,
    gamesPerBatch: games,
    batchesPerPlayerCount,
    playerCounts: [2, 3, 4],
    concurrency,
    maxRounds,
    minSamples,
    totalGames: report.totalGames,
    totalDraws: report.totalDraws ?? 0,
    totalIncomplete: report.totalIncomplete,
    elapsedSeconds,
    failedBatchProcesses: failedBatches.map(({ job, code, signal }) => ({ ...job, code, signal })),
  };
  writeFileSync(join(outputRoot, "local-run.json"), `${JSON.stringify(runMetadata, null, 2)}\n`, "utf-8");

  console.log("\nLocal balance run complete");
  console.log(`- total: ${Number(report.totalGames).toLocaleString()} games`);
  console.log(`- decisive: ${(Number(report.totalGames) - Number(report.totalDraws ?? 0) - Number(report.totalIncomplete)).toLocaleString()}`);
  console.log(`- draws: ${Number(report.totalDraws ?? 0).toLocaleString()}`);
  console.log(`- incomplete: ${Number(report.totalIncomplete).toLocaleString()}`);
  console.log(`- elapsed: ${elapsedSeconds.toFixed(1)}s`);
  console.log(`- report: ${join(mergedOutputDir, "independent-90k-report.md")}`);

  if (failedBatches.length > 0 || Number(report.totalIncomplete) > 0) {
    console.error(`\nWarning: ${failedBatches.length} batch process(es) reported incomplete games. Results were still merged.`);
    process.exitCode = 1;
  }
} finally {
  if (worktreeAdded) {
    spawnSync("git", ["worktree", "remove", "--force", worktreeDir], { cwd: repoRoot, stdio: "ignore" });
  }
  rmSync(tempParent, { recursive: true, force: true });
}
