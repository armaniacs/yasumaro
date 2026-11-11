/**
 * Parity pins for PBI 2026-11-11-03 (log-path-unify): seam delegation routes.
 *
 * - consoleSecureError masks PII and travels the logger seam (no direct
 *   console.error from the wrapper).
 * - logCritical keeps its console line wording/level, with long values
 *   truncated, base64-looking values redacted, and secret-keyed values masked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    initLogger,
    resetLoggerWiring,
    getLogs,
} from '../logger/core.js';
import { InMemoryLogAdapter } from '../logger/storageAdapter.js';
import { ImmediateFlushScheduler } from '../logger/flushScheduler.js';
import { FakeCriticalSink } from '../logger/criticalAlertSink.js';
import { ErrorCode } from '../logger/types.js';
import { logCritical } from '../logger/api.js';
import { consoleSecureError } from '../sensitiveDataMask.js';

/** Drain the dynamic-import + async addLog chain without wall-clock waits. */
async function flushAsyncChain(): Promise<void> {
    for (let i = 0; i < 50; i++) await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (let i = 0; i < 50; i++) await Promise.resolve();
}

beforeEach(() => {
    initLogger({
        storage: new InMemoryLogAdapter(),
        scheduler: new ImmediateFlushScheduler(),
    });
});

afterEach(() => {
    resetLoggerWiring();
    vi.restoreAllMocks();
});

describe('consoleSecureError seam delegation (PBI 2026-11-11-03)', () => {
    it('routes masked data through the logger seam without a direct console.error', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        consoleSecureError('Pin error', { api_key: 'secret-xyz-123', normal: 'value' });
        await flushAsyncChain();

        expect(errorSpy).not.toHaveBeenCalled();
        const logs = await getLogs();
        const entry = logs[logs.length - 1];
        expect(entry).toBeDefined();
        expect(entry!.message).toBe('Pin error');
        expect(JSON.stringify(entry)).not.toContain('secret-xyz-123');
    });

    it('preserves the message when data is undefined', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        consoleSecureError('Pin error without data', undefined);
        await flushAsyncChain();

        expect(errorSpy).not.toHaveBeenCalled();
        const logs = await getLogs();
        expect(logs[logs.length - 1]!.message).toBe('Pin error without data');
    });
});

describe('logCritical console line pins (PBI 2026-11-11-03)', () => {
    it('keeps the [CRITICAL:code] wording while masking secret-keyed values', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const sink = new FakeCriticalSink();

        await logCritical(
            'disk full pin',
            { api_key: 'live-secret-value-abc', count: 3 },
            ErrorCode.STORAGE_WRITE_FAILURE,
            'test',
            sink
        );

        expect(errorSpy).toHaveBeenCalledTimes(1);
        const line = String(errorSpy.mock.calls[0]?.[0]);
        expect(line).toContain(`[CRITICAL:${ErrorCode.STORAGE_WRITE_FAILURE}] disk full pin`);
        expect(line).not.toContain('live-secret-value-abc');
    });

    it('truncates over-long string values in the console line', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const sink = new FakeCriticalSink();

        await logCritical(
            'truncation pin',
            { blob: `prefix-${'x'.repeat(200)}` },
            ErrorCode.UNKNOWN_ERROR,
            'test',
            sink
        );

        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(String(errorSpy.mock.calls[0]?.[0])).toContain('...[truncated]');
    });

    it('redacts base64-looking values in the console line', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const sink = new FakeCriticalSink();

        await logCritical(
            'base64 pin',
            { payload: 'QUJD'.repeat(12) },
            ErrorCode.UNKNOWN_ERROR,
            'test',
            sink
        );

        expect(errorSpy).toHaveBeenCalledTimes(1);
        const line = String(errorSpy.mock.calls[0]?.[0]);
        expect(line).toContain('...[redacted]');
        expect(line).not.toContain('QUJD'.repeat(12));
    });
});
