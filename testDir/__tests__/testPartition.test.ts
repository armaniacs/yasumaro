/**
 * testPartition decides which test files run in the `isolated` project. A file
 * that lands in `shared` shares its worker with every other shared file, so any
 * state it installs — fake timers above all — outlives the file itself and
 * surfaces as a load- and order-dependent failure in some *other* file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { partitionTestFiles } from '../testPartition.js';

let root: string;

function write(name: string, source: string): void {
    writeFileSync(join(root, name), source, 'utf-8');
}

/** True when the file was kept out of the shared worker pool. */
function isIsolated(name: string): boolean {
    const { shared } = partitionTestFiles(root, ['**/*.test.ts'], ['node_modules/**']);
    return !shared.includes(name);
}

beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'test-partition-'));
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe('partitionTestFiles', () => {
    it('routes a bare vi.useFakeTimers() into isolation', () => {
        write('fake-timers.test.ts', "it('x', () => { vi.useFakeTimers(); });");
        expect(isIsolated('fake-timers.test.ts')).toBe(true);
    });

    it('routes useTimerClock() into isolation', () => {
        // The helper installs the same fake set as vi.useFakeTimers() but is
        // called as a bare identifier, so the vi.* pattern cannot see it.
        write(
            'wait-policy.test.ts',
            "import { useTimerClock } from '../../testDir/waitPolicy.js';\nit('x', () => { useTimerClock(); });"
        );
        expect(isIsolated('wait-policy.test.ts')).toBe(true);
    });

    it('routes an unused waitPolicy import into isolation', () => {
        // A conversion can import the helper before its first call site; the
        // import alone must not be missed.
        write(
            'wait-import-only.test.ts',
            "import { drainMacrotask } from '../../testDir/waitPolicy.js';\nit('x', async () => { await drainMacrotask(); });"
        );
        expect(isIsolated('wait-import-only.test.ts')).toBe(true);
    });

    it('leaves an ordinary file in the shared project', () => {
        write('plain.test.ts', "it('x', () => { expect(1).toBe(1); });");
        expect(isIsolated('plain.test.ts')).toBe(false);
    });
});
