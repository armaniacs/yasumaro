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
 * Test hooks (used by testDir/__tests__/type-test-baseline.test.ts only):
 *   TYPE_TEST_BASELINE_FILE         alternate baseline JSON path
 *   TYPE_TEST_BASELINE_MAX          override the pinned number
 *   TYPE_TEST_BASELINE_TSC_OUTPUT   read tsc output from a file instead of
 *                                   running tsc (keeps the unit test fast)
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

function readTscOutput() {
    const stub = process.env.TYPE_TEST_BASELINE_TSC_OUTPUT;
    if (stub !== undefined) return readFileSync(stub, 'utf8');
    try {
        return execFileSync('npx', ['tsc', '--project', 'testDir/tsconfig.json', '--noEmit'], {
            cwd: ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    } catch (err) {
        return `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }
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

const actual = countTypeErrors(readTscOutput());
const result = evaluateBaseline(actual, readBaseline());
if (result.ok) {
    console.log(result.message);
} else {
    console.error(result.message);
    process.exit(1);
}
