#!/usr/bin/env node
/**
 * mutation-chunks.mjs — run Stryker in resumable chunks and aggregate the score.
 *
 * Why this exists: a single full-repository Stryker run is ~75k mutants and
 * does not survive a laptop sleep, so `npm run test:mutate` cannot be the
 * completion gate on a dev machine. Chunking by directory keeps every unit
 * short enough to finish, and the aggregate (killed / total across chunk
 * reports) gives the same decision the full run would have given, because the
 * thresholds are unchanged.
 *
 * Usage:
 *   node scripts/mutation-chunks.mjs                 # run every unfinished chunk
 *   node scripts/mutation-chunks.mjs --only popup    # one chunk
 *   node scripts/mutation-chunks.mjs --list          # show plan and status
 *   node scripts/mutation-chunks.mjs --aggregate     # print the aggregate only
 *
 * Each chunk writes reports/mutation/chunks/<key>.json. A chunk whose report
 * already exists with at least one tested mutant is skipped, so an interrupted
 * sweep resumes instead of restarting.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const CHUNK_DIR = join(REPO_ROOT, 'reports', 'mutation', 'chunks');
const REPORT_DIR = join(REPO_ROOT, 'reports', 'mutation');
const CONFIG = 'stryker.chunk.json';

/** Test-file exclusions every chunk shares; `mutate` is one comma list. */
const EXCLUDES = ['!src/**/__tests__/**', '!src/**/*.test.ts', '!src/**/*.d.ts'];

/**
 * Small units first: a broken setting shows up in minutes, and whatever gets
 * interrupted leaves the most chunks already complete. Sizes are balanced by
 * measured mutants so one unit is roughly 3-8k mutants (1-3 h); anything that
 * still overruns is safe anyway because stryker.chunk.json enables
 * `incremental` (mutant-level resume) and a finished chunk is never rerun.
 */
const CHUNKS = [
    { key: '01-constants-privacy', globs: ['src/constants/**/*.ts', 'src/utils/types.ts', 'src/utils/privacyStatusCodes.ts', 'src/utils/privacyChecker.ts'] },
    { key: '02-popup', globs: ['src/popup/**/*.ts'] },
    { key: '03-messaging', globs: ['src/messaging/**/*.ts'] },
    { key: '04-content', globs: ['src/content/**/*.ts'] },
    { key: '05-offscreen', globs: ['src/offscreen/**/*.ts'] },
    { key: '06a-dashboard-root-a-m', globs: ['src/dashboard/[a-mA-M]*.ts'] },
    { key: '06b-dashboard-root-n-z', globs: ['src/dashboard/[n-zN-Z]*.ts'] },
    { key: '06c-dashboard-settings', globs: ['src/dashboard/settings/**/*.ts', 'src/dashboard/generalSettings/**/*.ts', 'src/dashboard/utils/**/*.ts', 'src/dashboard/components/**/*.ts', 'src/dashboard/aiProviderB/**/*.ts'] },
    { key: '06d-panels-asyncdata', globs: ['src/dashboard/panels/asyncData/**/*.ts'] },
    { key: '06e-panels-rest', globs: ['src/dashboard/panels/**/*.ts', '!src/dashboard/panels/asyncData/**/*.ts'] },
    { key: '07a-background-root-a-m', globs: ['src/background/[a-mA-M]*.ts'] },
    { key: '07b-background-root-n-z', globs: ['src/background/[n-zN-Z]*.ts'] },
    { key: '07c-background-handlers', globs: ['src/background/handlers/**/*.ts'] },
    { key: '07d-background-pipeline-ai', globs: ['src/background/pipeline/**/*.ts', 'src/background/ai/**/*.ts'] },
    { key: '07e-background-rest', globs: ['src/background/cache/**/*.ts', 'src/background/migration/**/*.ts', 'src/background/navTrail/**/*.ts', 'src/background/net/**/*.ts', 'src/background/queue/**/*.ts', 'src/background/sqlite/**/*.ts', 'src/background/syncTargets/**/*.ts', 'src/background/webhookExport/**/*.ts'] },
    { key: '08a-utils-storage', globs: ['src/utils/storage/**/*.ts'] },
    { key: '08b-utils-mid-a', globs: ['src/utils/aiSummaryCleaner/**/*.ts', 'src/utils/contentExtractor/**/*.ts'] },
    { key: '08c-utils-mid-b', globs: ['src/utils/trustDb/**/*.ts', 'src/utils/crypto/**/*.ts'] },
    { key: '08d-utils-root-a-m', globs: ['src/utils/[a-mA-M]*.ts'] },
    { key: '08e-utils-root-n-z', globs: ['src/utils/[n-zN-Z]*.ts'] },
    { key: '08f-utils-small', globs: ['src/utils/ublockParser/**/*.ts', 'src/utils/logger/**/*.ts', 'src/utils/ui/**/*.ts', 'src/utils/sessionReminder/**/*.ts', 'src/utils/domainFilter/**/*.ts', 'src/utils/text/**/*.ts'] },
];

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const flagValue = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
};

/** @returns {{killed:number,total:number,tested:number}|undefined} */
function readReport(file) {
    if (!existsSync(file)) return undefined;
    let json;
    try {
        json = JSON.parse(readFileSync(file, 'utf-8'));
    } catch {
        return undefined;
    }
    const totals = { killed: 0, total: 0, tested: 0 };
    for (const fileResult of Object.values(json.files ?? {})) {
        for (const mutant of fileResult.mutants ?? []) {
            totals.total += 1;
            if (mutant.status === 'Killed' || mutant.status === 'Timeout') {
                totals.killed += 1;
                totals.tested += 1;
            } else if (mutant.status === 'Survived' || mutant.status === 'NoCoverage') {
                totals.tested += 1;
            }
        }
    }
    return totals;
}

function chunkReportPath(key) {
    return join(CHUNK_DIR, `${key}.json`);
}

function runChunk(chunk) {
    const mutate = [...chunk.globs, ...EXCLUDES].join(',');
    const finalReport = chunkReportPath(chunk.key);
    console.log(`\n=== chunk ${chunk.key}: ${chunk.globs.join(', ')} ===`);
    // Two Stryker workers each start a vitest run; without a cap that is 12
    // fork workers on 8 cores and heavy UI tests cross the 30 s testTimeout
    // during the dry run. Capping the inner pool keeps the sandbox inside the
    // machine instead of relaxing any timeout.
    // NODE_OPTIONS / VITEST_MAX_WORKERS are env-overridable so a second
    // stream in another worktree can run a smaller footprint next to this one
    // (e.g. MUTATION_NODE_OPTIONS='--max-old-space-size=4096'
    // MUTATION_VITEST_WORKERS=2).
    const env = {
        ...process.env,
        NODE_OPTIONS: process.env.MUTATION_NODE_OPTIONS ?? '--max-old-space-size=6144',
        VITEST_MAX_WORKERS: process.env.MUTATION_VITEST_WORKERS ?? '3',
    };
    const args = [
        'stryker', 'run', CONFIG,
        '--concurrency', process.env.MUTATION_CONCURRENCY ?? '2',
        '--mutate', mutate,
        '--reporters', 'clear-text,progress,json',
    ];
    // One retry: a dry-run timeout under load is transient, and losing an
    // hour of a chunk to it does not make the failure more informative.
    // With --skip-failed the sweep continues past a twice-failed chunk
    // (unattended overnight runs); without it the sweep aborts, which is the
    // safer default when interactively watching the first chunks.
    const skipFailed = hasFlag('--skip-failed');
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            execFileSync('npx', args, { cwd: REPO_ROOT, stdio: 'inherit', env });
            lastError = undefined;
            break;
        } catch (error) {
            lastError = error;
            if (attempt === 2) break;
            console.log(`chunk ${chunk.key} failed on attempt 1; retrying once`);
        }
    }
    if (lastError) {
        console.log(`chunk ${chunk.key} failed twice; ${skipFailed ? 'skipping (recorded below)' : 'aborting sweep'}`);
        failedChunks.push(chunk.key);
        if (!skipFailed) throw lastError;
        return;
    }
    // The JSON reporter always writes to its configured path; move it to the
    // chunk's own file so the sweep can resume and aggregate.
    const latest = join(REPORT_DIR, 'mutation.json');
    if (existsSync(latest)) renameSync(latest, finalReport);
}

/**
 * Survived / uncovered mutants grouped by file and mutator, for the reason
 * classification the PBI requires (equivalent mutant vs missing test).
 * `--survivors [n]` prints the top n files; `--survivors-detail <file>` lists
 * every survived mutant in one file with its line and mutator name.
 */
function survivors() {
    const byFile = new Map();
    const byMutator = new Map();
    for (const { path, mutant } of collectUniqueMutants().values()) {
        if (mutant.status !== 'Survived' && mutant.status !== 'NoCoverage') continue;
        const entry = byFile.get(path) ?? { survived: 0, noCoverage: 0 };
        if (mutant.status === 'Survived') entry.survived += 1;
        else entry.noCoverage += 1;
        byFile.set(path, entry);
        const key = mutant.mutatorName ?? 'unknown';
        const counts = byMutator.get(key) ?? { survived: 0, noCoverage: 0, mutated: '' };
        if (mutant.status === 'Survived') counts.survived += 1;
        else counts.noCoverage += 1;
        counts.mutated = mutant.replacement ?? counts.mutated;
        byMutator.set(key, counts);
    }
    const detail = flagValue('--survivors-detail');
    if (detail) {
        for (const chunk of CHUNKS) {
            const file = chunkReportPath(chunk.key);
            if (!existsSync(file)) continue;
            const json = JSON.parse(readFileSync(file, 'utf-8'));
            const fileResult = json.files?.[detail];
            if (!fileResult) continue;
            for (const mutant of fileResult.mutants ?? []) {
                if (mutant.status !== 'Survived' && mutant.status !== 'NoCoverage') continue;
                const line = mutant.location?.start?.line ?? '?';
                console.log(`${detail}:${line}  ${mutant.status}  ${mutant.mutatorName}  ->  ${JSON.stringify(mutant.replacement)}`);
            }
        }
        return;
    }
    const limit = Number.parseInt(flagValue('--survivors') ?? '20', 10);
    const rows = [...byFile.entries()]
        .map(([path, counts]) => ({ path, ...counts, total: counts.survived + counts.noCoverage }))
        .sort((a, b) => b.total - a.total)
        .slice(0, Number.isInteger(limit) ? limit : 20);
    for (const row of rows) {
        console.log(`${String(row.total).padStart(5)}  survived ${String(row.survived).padStart(4)}  no-cov ${String(row.noCoverage).padStart(4)}  ${row.path}`);
    }
    console.log('\nBy mutator:');
    for (const [name, counts] of [...byMutator.entries()].sort((a, b) => (b[1].survived + b[1].noCoverage) - (a[1].survived + a[1].noCoverage))) {
        console.log(`${String(counts.survived + counts.noCoverage).padStart(6)}  survived ${String(counts.survived).padStart(4)}  no-cov ${String(counts.noCoverage).padStart(4)}  ${name}`);
    }
}

const STATUS_RANK = { Killed: 3, Timeout: 2, Survived: 1, NoCoverage: 0 };

function mutantKey(path, mutant) {
    const loc = mutant.location ?? {};
    const start = loc.start ?? {};
    const end = loc.end ?? {};
    return [
        path,
        mutant.mutatorName ?? '',
        `${start.line ?? '?'}:${start.column ?? '?'}-${end.line ?? '?'}:${end.column ?? '?'}`,
        JSON.stringify(mutant.replacement ?? null),
    ].join('|');
}

/**
 * Every distinct mutant across all chunk reports, deduplicated by identity.
 * Stryker's incremental mode carries already-tested mutants into each later
 * chunk's report, so naive per-chunk summation double-counts them (early
 * chunks would dominate the aggregate). On conflict (same mutant, different
 * status across runs — usually a flaky test) the best status wins: a mutant
 * killed at least once is killable.
 */
function collectUniqueMutants() {
    const unique = new Map();
    for (const chunk of CHUNKS) {
        const file = chunkReportPath(chunk.key);
        if (!existsSync(file)) continue;
        let json;
        try {
            json = JSON.parse(readFileSync(file, 'utf-8'));
        } catch {
            continue;
        }
        for (const [path, fileResult] of Object.entries(json.files ?? {})) {
            for (const mutant of fileResult.mutants ?? []) {
                const key = mutantKey(path, mutant);
                const prev = unique.get(key);
                if (prev === undefined || (STATUS_RANK[mutant.status] ?? -1) > (STATUS_RANK[prev.status] ?? -1)) {
                    unique.set(key, { path, mutant });
                }
            }
        }
    }
    return unique;
}

function aggregate() {
    const rows = [];
    for (const chunk of CHUNKS) {
        const totals = readReport(chunkReportPath(chunk.key));
        rows.push({ key: chunk.key, ...(totals ?? { killed: 0, total: 0, tested: 0, missing: true }) });
    }
    // Per-chunk rows are raw report totals (each report carries incremental
    // carryover from earlier chunks, so they overlap). The headline number
    // below is the deduplicated union, which is the only unbiased total.
    let uniqueKilled = 0;
    let uniqueTested = 0;
    for (const { mutant } of collectUniqueMutants().values()) {
        if (mutant.status === 'Killed' || mutant.status === 'Timeout') {
            uniqueKilled += 1;
            uniqueTested += 1;
        } else if (mutant.status === 'Survived' || mutant.status === 'NoCoverage') {
            uniqueTested += 1;
        }
    }
    for (const row of rows) {
        const label = row.missing ? 'not run' : `${row.tested} tested (report total, includes carryover)`;
        const score = row.missing || row.tested === 0 ? 'n/a' : ((row.killed / row.tested) * 100).toFixed(2);
        console.log(`${row.key.padEnd(22)} ${String(score).padStart(6)}%  ${label}  (killed ${row.killed})`);
    }
    const overall = uniqueTested === 0 ? Number.NaN : (uniqueKilled / uniqueTested) * 100;
    console.log(`\nAggregate mutation score (deduplicated): ${Number.isNaN(overall) ? 'n/a' : `${overall.toFixed(2)}%`} (killed ${uniqueKilled} / tested ${uniqueTested})`);
    return { overall, killed: uniqueKilled, tested: uniqueTested, rows };
}

mkdirSync(CHUNK_DIR, { recursive: true });

if (hasFlag('--list')) {
    for (const chunk of CHUNKS) {
        const totals = readReport(chunkReportPath(chunk.key));
        console.log(`${chunk.key.padEnd(22)} ${totals ? `${totals.tested} tested` : 'not run'}`);
    }
    process.exit(0);
}

if (hasFlag('--aggregate')) {
    aggregate();
    process.exit(0);
}

if (hasFlag('--survivors') || args.includes('--survivors-detail')) {
    survivors();
    process.exit(0);
}

const only = flagValue('--only');
// Comma-separated so two streams can split the list, e.g.
// --only 06a,06c,06e in one worktree and --only 06b,06d in another.
const wanted = only ? only.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
const targets = wanted
    ? CHUNKS.filter((c) => wanted.some((w) => c.key === w || c.key.startsWith(w)))
    : CHUNKS;
if (targets.length === 0) {
    console.error(`no chunk matches "${only}"`);
    process.exit(2);
}

const failedChunks = [];

for (const chunk of targets) {
    const totals = readReport(chunkReportPath(chunk.key));
    if (totals && totals.tested > 0) {
        console.log(`skip ${chunk.key} (already has ${totals.tested} tested mutants)`);
        continue;
    }
    runChunk(chunk);
}

aggregate();
if (failedChunks.length > 0) {
    console.log(`\nfailed chunks (not run): ${failedChunks.join(', ')}`);
    process.exit(1);
}
