/**
 * Parity pin for PBI 2026-11-11-03 (log-path-unify) criterion (4):
 * when writeStructuredLog itself fails, the failure must not go invisible —
 * the last-resort console line carries a detectable marker plus the log type
 * and message that was lost.
 */
import { describe, it, expect, vi } from 'vitest';
import { logInfo } from '../api.js';

vi.mock('../core.js', async (importOriginal) => {
    const original = await importOriginal<typeof import('../core.js')>();
    return {
        ...original,
        addLog: vi.fn().mockRejectedValue(new Error('store down')),
    };
});

describe('writeStructuredLog failure visibility (PBI 2026-11-11-03)', () => {
    it('emits a detectable last-resort line carrying type + message', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            await logInfo('fallback pin message', { k: 1 }, 'pin-source');

            expect(errorSpy).toHaveBeenCalledTimes(1);
            const firstArg = String(errorSpy.mock.calls[0]?.[0]);
            expect(firstArg).toContain('[Logger:log-write-failed:');
            expect(firstArg).toContain('INFO');
            expect(firstArg).toContain('fallback pin message');
        } finally {
            errorSpy.mockRestore();
        }
    });
});
