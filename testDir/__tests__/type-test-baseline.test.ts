/**
 * The type-test baseline gate must fail when test type errors grow past the
 * pinned number, and pass at or below it. Spawning the checker with stubbed
 * tsc output keeps this fast — running real tsc here would blow the 30s
 * per-test budget under suite load.
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

function runChecker(maxErrors: number, tscOutput: string): { exit: number; output: string } {
    try {
        const stdout = execFileSync('node', [SCRIPT], {
            encoding: 'utf8',
            env: {
                ...process.env,
                TYPE_TEST_BASELINE_MAX: String(maxErrors),
                TYPE_TEST_BASELINE_TSC_OUTPUT: tscOutput,
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
        const { exit, output } = runChecker(2, stubOutput('over.txt', 3));
        expect(exit).toBe(1);
        expect(output).toContain('3 > pinned 2');
    });

    it('passes when errors equal the pinned number', () => {
        const { exit, output } = runChecker(2, stubOutput('equal.txt', 2));
        expect(exit).toBe(0);
        expect(output).toContain('pinned 2');
    });

    it('passes below the pin and asks to lock the gain', () => {
        const { exit, output } = runChecker(2, stubOutput('under.txt', 1));
        expect(exit).toBe(0);
        expect(output).toContain('lower testDir/type-check-baseline.json');
    });

    it('counts only real error lines', () => {
        const { exit } = runChecker(0, stubOutput('zero.txt', 0));
        expect(exit).toBe(0);
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
});
