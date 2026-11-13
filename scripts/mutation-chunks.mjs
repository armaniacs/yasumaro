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
 * interrupted leaves the most chunks already complete.
 */
const CHUNKS = [
    { key: '01-constants-privacy', globs: ['src/constants/**/*.ts', 'src/utils/types.ts', 'src/utils/privacyStatusCodes.ts', 'src/utils/privacyChecker.ts'] },
    { key: '02-popup', globs: ['src/popup/**/*.ts'] },
    { key: '03-messaging', globs: ['src/messaging/**/*.ts'] },
    { key: '04-content', globs: ['src/content/**/*.ts'] },
    { key: '05-offscreen', globs: ['src/offscreen/**/*.ts'] },
    { key: '06-dashboard', globs: ['src/dashboard/**/*.ts'] },
    { key: '07-background', globs: ['src/background/**/*.ts'] },
    { key: '08-utils-a-l', globs: ['src/utils/[a-l]*/**/*.ts', 'src/utils/[a-l]*.ts'] },
    { key: '09-utils-m-z', globs: ['src/utils/[m-z]*/**/*.ts', 'src/utils/[m-z]*.ts'] },
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
    const env = {
        ...process.env,
        NODE_OPTIONS: '--max-old-space-size=6144',
        VITEST_MAX_WORKERS: '3',
    };
    const args = [
        'stryker', 'run', CONFIG,
        '--concurrency', '2',
        '--mutate', mutate,
        '--reporters', 'clear-text,progress,json',
    ];
    // One retry: a dry-run timeout under load is transient, and losing an
    // hour of a chunk to it does not make the failure more informative.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            execFileSync('npx', args, { cwd: REPO_ROOT, stdio: 'inherit', env });
            break;
        } catch (error) {
            if (attempt === 2) throw error;
            console.log(`chunk ${chunk.key} failed on attempt 1; retrying once`);
        }
    }
    // The JSON reporter always writes to its configured path; move it to the
    // chunk's own file so the sweep can resume and aggregate.
    const latest = join(REPORT_DIR, 'mutation.json');
    if (existsSync(latest)) renameSync(latest, finalReport);
}

function aggregate() {
    const rows = [];
    for (const chunk of CHUNKS) {
        const totals = readReport(chunkReportPath(chunk.key));
        rows.push({ key: chunk.key, ...(totals ?? { killed: 0, total: 0, tested: 0, missing: true }) });
    }
    let killed = 0;
    let tested = 0;
    for (const row of rows) {
        killed += row.killed;
        tested += row.tested;
        const label = row.missing ? 'not run' : `${row.tested} tested`;
        const score = row.missing || row.tested === 0 ? 'n/a' : ((row.killed / row.tested) * 100).toFixed(2);
        console.log(`${row.key.padEnd(22)} ${String(score).padStart(6)}%  ${label}  (killed ${row.killed})`);
    }
    const overall = tested === 0 ? Number.NaN : (killed / tested) * 100;
    console.log(`\nAggregate mutation score: ${Number.isNaN(overall) ? 'n/a' : `${overall.toFixed(2)}%`} (killed ${killed} / tested ${tested})`);
    return { overall, killed, tested, rows };
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

const only = flagValue('--only');
const targets = only ? CHUNKS.filter((c) => c.key === only || c.key.startsWith(only)) : CHUNKS;
if (targets.length === 0) {
    console.error(`no chunk matches "${only}"`);
    process.exit(2);
}

for (const chunk of targets) {
    const totals = readReport(chunkReportPath(chunk.key));
    if (totals && totals.tested > 0) {
        console.log(`skip ${chunk.key} (already has ${totals.tested} tested mutants)`);
        continue;
    }
    runChunk(chunk);
}

aggregate();
