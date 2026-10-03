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
 * Measured tsc 6.0.3 semantics: type errors exit 2, a no-inputs config break
 * exits 1, a spawn failure leaves no exit status, and the "Found N errors"
 * summary line is only emitted in pretty mode (where ANSI wrapping breaks
 * the error-line regex), so the summary cannot be the sanity signal. The
 * gate therefore refuses to evaluate when tsc did not run to completion,
 * when it exited non-zero without reporting any TS error, or when TS errors
 * were counted with an exit code other than 2. Residual hole: a crash that
 * exits exactly 2 after emitting a partial error list is indistinguishable
 * from a complete run and still passes.
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

export function countTypeErrors(output) {
    const lines = output.match(/^.+error TS\d+.+$/gm);
    return lines === null ? 0 : lines.length;
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
            output: execFileSync('npx', ['tsc', '--project', 'testDir/tsconfig.json', '--noEmit'], {
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
    if (counted > 0 && run.exitCode !== 2) {
        return {
            ok: false,
            message: `tsc exited with code ${run.exitCode} while ${counted} TS error lines were counted — expected exit 2 for a completed type check, refusing to evaluate`,
        };
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
