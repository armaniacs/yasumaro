/**
 * check-type-test-baseline.mjs — pin test-code type errors, fail on growth.
 *
 * `npm run type-check:test` is raw tsc over test files and currently reports
 * hundreds of errors, so wiring it directly into `validate` would keep the
 * gate red until the whole debt is repaid. This wrapper counts the errors and
 * fails only when the count exceeds the pinned number in
 * testDir/type-check-baseline.json. Lowering that number is always allowed;
 * raising it or adding tsconfig excludes to hide errors is not.
 *
 * tsc-ran sanity: a crashed or failed tsc must not read as a 0-count pass.
 * Measured tsc 7.0.2 (tsgo, native) semantics invert the 6.x convention: type
 * errors exit 1, a no-inputs/config break (TS18002/TS18003/TS6053) exits 2, a
 * spawn failure leaves no exit status. tsc runs with --pretty so a countable
 * "Found N errors" summary line is always emitted; ANSI codes are stripped
 * before matching, so pretty formatting does not break the error-line regex.
 * The gate therefore refuses to evaluate when tsc did not run to completion,
 * when it exited non-zero without reporting any TS error, when TS errors were
 * counted with an exit code other than 1 (a config break also counts its TS
 * line but exits 2, so the code distinguishes it), or when the error count
 * does not match the summary (a crash that exits 1 after a partial list
 * either omits the summary or reports a different total, so the mismatch
 * refuses evaluation).
 *
 * Total-count limitation (evaluateBaseline): the comparison is count-only, so
 * an offsetting change (remove one old error, add one new) and a count drop
 * from shrunken test coverage both pass. Shrunken coverage is bounded by the
 * include/exclude set pin in testDir/__tests__/type-test-baseline.test.ts
 * (decided: the pin test is needed and implemented there); offsetting swaps
 * are accepted — a per-error structured baseline is the alternative and is
 * out of scope for this gate.
 *
 * Test hooks (used by testDir/__tests__/type-test-baseline.test.ts only):
 *   TYPE_TEST_BASELINE_FILE         alternate baseline JSON path
 *   TYPE_TEST_BASELINE_MAX          override the pinned number
 *   TYPE_TEST_BASELINE_TSC_OUTPUT   read tsc output from a file instead of
 *                                   running tsc (keeps the unit test fast)
 *   TYPE_TEST_BASELINE_TSC_EXIT     with the stub above, simulate tsc's exit
 *                                   status: an integer, or "spawn" for a
 *                                   spawn failure
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const DEFAULT_BASELINE = new URL('../testDir/type-check-baseline.json', import.meta.url).pathname;

export function stripAnsi(output) {
    return output.replace(/\[[0-9;]*m/g, '');
}

export function countTypeErrors(output) {
    const lines = stripAnsi(output).match(/^.+error TS\d+.+$/gm);
    return lines === null ? 0 : lines.length;
}

export function countSummaryErrors(output) {
    const summary = stripAnsi(output).match(/^Found (\d+) errors?\b/m);
    return summary === null ? null : Number(summary[1]);
}

export function evaluateBaseline(actual, maxErrors) {
    // Count-only by design: offsetting changes and coverage-driven count
    // drops pass here — see the header for how each is bounded.
    if (actual > maxErrors) {
        return {
            ok: false,
            message: `test type errors grew: ${actual} > pinned ${maxErrors} — fix errors or lower testDir/type-check-baseline.json only by repaying debt`,
        };
    }
    if (actual < maxErrors) {
        return {
            ok: true,
            message: `test type errors: ${actual} (below pinned ${maxErrors} — lower testDir/type-check-baseline.json to lock the gain)`,
        };
    }
    return { ok: true, message: `test type errors: ${actual} (pinned ${maxErrors})` };
}

export function runTsc() {
    const stub = process.env.TYPE_TEST_BASELINE_TSC_OUTPUT;
    if (stub !== undefined) {
        const exitEnv = process.env.TYPE_TEST_BASELINE_TSC_EXIT ?? '0';
        if (exitEnv === 'spawn') return { output: '', exitCode: null, ran: false };
        return { output: readFileSync(stub, 'utf8'), exitCode: Number.parseInt(exitEnv, 10), ran: true };
    }
    try {
        return {
            output: execFileSync('npx', ['tsc', '--project', 'testDir/tsconfig.json', '--noEmit', '--pretty'], {
                cwd: ROOT,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            }),
            exitCode: 0,
            ran: true,
        };
    } catch (err) {
        const output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
        return typeof err.status === 'number'
            ? { output, exitCode: err.status, ran: true }
            : { output, exitCode: null, ran: false };
    }
}

export function assertTscRan(run, counted) {
    if (!run.ran) {
        return {
            ok: false,
            message: `tsc did not run to completion (no exit status) — refusing to treat ${counted} counted TS error lines as a baseline result`,
        };
    }
    if (run.exitCode !== 0 && counted === 0) {
        return {
            ok: false,
            message: `tsc exited with code ${run.exitCode} but reported no TS errors — treating this as a crash, not a pass`,
        };
    }
    if (counted > 0 && run.exitCode !== 1) {
        return {
            ok: false,
            message: `tsc exited with code ${run.exitCode} while ${counted} TS error lines were counted — expected exit 1 for a completed type check under tsc 7 (config breaks exit 2), refusing to evaluate`,
        };
    }
    if (counted > 0) {
        const summary = countSummaryErrors(run.output);
        if (summary === null || summary !== counted) {
            return {
                ok: false,
                message: `tsc output looks truncated: counted ${counted} TS error lines but the summary reports ${summary === null ? 'no total' : summary} — refusing to evaluate`,
            };
        }
    }
    return { ok: true, message: '' };
}

function readBaseline() {
    const path = process.env.TYPE_TEST_BASELINE_FILE ?? DEFAULT_BASELINE;
    const raw = readFileSync(path, 'utf8');
    const maxOverride = process.env.TYPE_TEST_BASELINE_MAX;
    const maxErrors = maxOverride !== undefined ? Number.parseInt(maxOverride, 10) : JSON.parse(raw).maxErrors;
    if (!Number.isInteger(maxErrors) || maxErrors < 0) {
        throw new Error(`invalid pinned maxErrors: ${String(maxErrors)}`);
    }
    return maxErrors;
}

const run = runTsc();
const actual = countTypeErrors(run.output);
const sanity = assertTscRan(run, actual);
if (!sanity.ok) {
    console.error(sanity.message);
    process.exit(1);
}
const result = evaluateBaseline(actual, readBaseline());
if (result.ok) {
    console.log(result.message);
} else {
    console.error(result.message);
    process.exit(1);
}
