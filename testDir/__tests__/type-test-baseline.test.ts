/**
 * The type-test baseline gate must fail when test type errors grow past the
 * pinned number, and pass at or below it. Spawning the checker with stubbed
 * tsc output keeps this fast — running real tsc here would blow the 30s
 * per-test budget under suite load. The stub exit code simulates tsc's
 * measured semantics (errors → 2, clean → 0, spawn failure → "spawn").
 *
 * The include/exclude pin at the bottom bounds the count-only baseline's
 * coverage-shrink hole: shrinking testDir/tsconfig.json would drop the count
 * below the pin and read as a fake gain.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../scripts/check-type-test-baseline.mjs');

let dir: string;

function stubOutput(name: string, errorLines: number): string {
    const lines: string[] = [];
    for (let i = 0; i < errorLines; i++) {
        lines.push(`src/example${i}.test.ts(1,1): error TS2532: Object is possibly 'undefined'.`);
    }
    lines.push('non-error summary line without a code');
    const path = join(dir, name);
    writeFileSync(path, lines.join('\n'), 'utf-8');
    return path;
}

function runChecker(maxErrors: number, tscOutput: string, tscExit: string = '0'): { exit: number; output: string } {
    try {
        const stdout = execFileSync('node', [SCRIPT], {
            encoding: 'utf8',
            env: {
                ...process.env,
                TYPE_TEST_BASELINE_MAX: String(maxErrors),
                TYPE_TEST_BASELINE_TSC_OUTPUT: tscOutput,
                TYPE_TEST_BASELINE_TSC_EXIT: tscExit,
            },
        });
        return { exit: 0, output: stdout };
    } catch (err) {
        const e = err as { status?: number; stdout?: string; stderr?: string };
        return { exit: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
}

beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'type-baseline-'));
});

afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('type-test baseline gate', () => {
    it('fails when errors exceed the pinned number', () => {
        const { exit, output } = runChecker(2, stubOutput('over.txt', 3), '2');
        expect(exit).toBe(1);
        expect(output).toContain('3 > pinned 2');
    });

    it('passes when errors equal the pinned number', () => {
        const { exit, output } = runChecker(2, stubOutput('equal.txt', 2), '2');
        expect(exit).toBe(0);
        expect(output).toContain('pinned 2');
    });

    it('passes below the pin and asks to lock the gain', () => {
        const { exit, output } = runChecker(2, stubOutput('under.txt', 1), '2');
        expect(exit).toBe(0);
        expect(output).toContain('lower testDir/type-check-baseline.json');
    });

    it('counts only real error lines', () => {
        const { exit } = runChecker(0, stubOutput('zero.txt', 0), '0');
        expect(exit).toBe(0);
    });

    it('fails when tsc crashes with no diagnostics instead of passing on count 0', () => {
        // Crash output (npm noise, no error lines) with a failed exit — the
        // count is 0 but the run must not read as a pass below the pin.
        const { exit, output } = runChecker(489, stubOutput('crash.txt', 0), '1');
        expect(exit).toBe(1);
        expect(output).toContain('treating this as a crash');
    });

    it('fails when tsc cannot be spawned', () => {
        const { exit, output } = runChecker(489, '', 'spawn');
        expect(exit).toBe(1);
        expect(output).toContain('did not run to completion');
    });

    it('fails when TS errors are counted with a non-diagnostics exit code', () => {
        // A no-inputs config break fires TS18003 (countable) and exits 1 —
        // without the sanity check it would pass below the pin.
        const { exit, output } = runChecker(489, stubOutput('cfg-break.txt', 1), '1');
        expect(exit).toBe(1);
        expect(output).toContain('expected exit 2');
    });

    it('pins a finite non-negative number', () => {
        const raw = readFileSync(resolve(__dirname, '../type-check-baseline.json'), 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        expect(typeof parsed === 'object' && parsed !== null).toBe(true);
        const maxErrors = (parsed as { maxErrors?: unknown }).maxErrors;
        expect(typeof maxErrors).toBe('number');
        expect(Number.isInteger(maxErrors)).toBe(true);
        expect((maxErrors as number) >= 0).toBe(true);
    });

    it('pins the testDir tsconfig include and exclude sets', () => {
        const parsed = JSON.parse(readFileSync(resolve(__dirname, '../tsconfig.json'), 'utf-8')) as {
            include?: unknown;
            exclude?: unknown;
        };
        expect(
            parsed.include,
            'testDir/tsconfig.json include changed — shrinking it hides test files from type-check and drops the count below the pin (fake gain). Update this pin only for intended coverage changes.',
        ).toEqual([
            './jsdom-shim.d.ts',
            './**/*.ts',
            '../src/vite-env.d.ts',
            '../src/offscreen/wa-sqlite.d.ts',
            '../src/**/__tests__/**/*',
            '../src/**/*.test.ts',
            '../src/**/*.spec.ts',
            './__tests__/**/*.test.ts',
            './e2e/fixtures/**/*.ts',
        ]);
        expect(parsed.exclude).toEqual(['../node_modules', '../dist']);
    });
});
