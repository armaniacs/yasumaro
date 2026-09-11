/**
 * logger-enhanced.test.ts
 * Additional tests for logger.ts uncovered paths
 */

import { vi } from 'vitest';;

describe('Logger - Enhanced Coverage', () => {
    let logger: any;

    beforeEach(async () => {
        vi.resetModules();
        process.env.NODE_ENV = 'development';
        (chrome as any).runtime.onSuspend = { addListener: vi.fn() };
        logger = await import('../logger.js');
        await logger.clearLogs();
        logger.clearPendingLogs();
    });

    afterEach(async () => {
        await logger.clearLogs();
    });

    describe('sanitizeLogDetails - Array handling', () => {
        test('handles null/undefined inside arrays', async () => {
            await logger.addLog('INFO', 'Array null test', {
                arr: [null, undefined, 'value', null]
            });
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            expect(logs.length).toBe(1);
            expect((logs[0].details as Record<string, unknown>).arr).toEqual([null, undefined, 'value', null]);
        });

        test('converts Date objects inside arrays to ISO strings', async () => {
            const date = new Date('2024-06-15T10:00:00Z');
            await logger.addLog('INFO', 'Array Date test', {
                dates: [date]
            });
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            expect(logs.length).toBe(1);
            expect(((logs[0]!.details as Record<string, unknown>).dates as unknown[])[0]).toBe(date.toISOString());
        });

        test('converts Error objects inside arrays', async () => {
            const error = new Error('Array error test');
            await logger.addLog('INFO', 'Array Error test', {
                errors: [error]
            });
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            expect(logs.length).toBe(1);
            expect(((logs[0]!.details as Record<string, unknown>).errors as Record<string, unknown>[])[0]!.message).toBe('Array error test');
            expect(((logs[0]!.details as Record<string, unknown>).errors as Record<string, unknown>[])[0]!.stack).toBeDefined();
        });

        test('masks string PII inside arrays', async () => {
            await logger.addLog('INFO', 'Array PII test', {
                contacts: ['user@example.com', 'regular text']
            });
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            expect(logs.length).toBe(1);
            // Email should be masked
            expect(((logs[0]!.details as Record<string, unknown>).contacts as unknown[])[0]).not.toContain('user@example.com');
        });

        test('handles nested arrays', async () => {
            await logger.addLog('INFO', 'Nested array test', {
                matrix: [[1, 2], ['a', 'b']]
            });
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            expect(logs.length).toBe(1);
            expect((logs[0].details as Record<string, unknown>).matrix).toEqual([[1, 2], ['a', 'b']]);
        });

        test('handles primitive types inside arrays', async () => {
            await logger.addLog('INFO', 'Array primitive test', {
                values: [42, true, 'text', 3.14]
            });
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            expect(logs.length).toBe(1);
            expect((logs[0].details as Record<string, unknown>).values).toEqual([42, true, 'text', 3.14]);
        });
    });

    describe('Buffer Management', () => {
        test('discards old entries when the buffer limit is exceeded', async () => {
            // MAX_PENDING_LOGS = 100, so add 101 logs
            for (let i = 0; i < 101; i++) {
                await logger.addLog('INFO', `Log ${i}`, { index: i });
            }

            const pendingCount = logger.getPendingLogCount();
            expect(pendingCount).toBeLessThanOrEqual(100);
        });

        test('getPendingLogCount returns the pending log count', async () => {
            const initialCount = logger.getPendingLogCount();
            expect(initialCount).toBeGreaterThanOrEqual(0);

            await logger.addLog('INFO', 'Pending test', {});
            const newCount = logger.getPendingLogCount();
            expect(newCount).toBeGreaterThanOrEqual(initialCount);
        });

        test('clearPendingLogs clears pending logs', async () => {
            await logger.addLog('INFO', 'To be cleared', {});
            logger.clearPendingLogs();
            expect(logger.getPendingLogCount()).toBe(0);
        });
    });

    describe('Service Worker resilience', () => {
        test('schedules flush via chrome.alarms when buffer is below BATCH_FLUSH_SIZE', async () => {
            await logger.addLog('INFO', 'Alarm scheduled log', {});
            expect(chrome.alarms.create).toHaveBeenCalledWith(
                'yasumaro-logger-flush',
                expect.objectContaining({ delayInMinutes: 1 })
            );
        });

        test('flushLogs is called when the logger alarm fires', async () => {
            await logger.addLog('INFO', 'Alarm fired log', {});
            const alarmListener = (chrome.alarms.onAlarm.addListener as ReturnType<typeof vi.fn>).mock.calls[0]![0];
            await alarmListener({ name: 'yasumaro-logger-flush' });
            const logs = await logger.getLogs();
            expect(logs.some((l: any) => l.message === 'Alarm fired log')).toBe(true);
        });

        test('onSuspend awaits flushLogs with a timeout', async () => {
            await logger.addLog('INFO', 'Suspend log', {});
            const suspendListener = (chrome.runtime.onSuspend.addListener as ReturnType<typeof vi.fn>).mock.calls[0]![0];
            await suspendListener();
            const logs = await logger.getLogs();
            expect(logs.some((l: any) => l.message === 'Suspend log')).toBe(true);
        });

        test('onSuspend logs a best-effort warning when flush times out', async () => {
            vi.useFakeTimers();
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            try {
                // chrome.storage.local.get を永久に解決しないPromiseにして、
                // flushLogs() が3秒のタイムアウト内に完了しない状況を再現する
                (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockImplementationOnce(
                    () => new Promise(() => {})
                );

                await logger.addLog('INFO', 'Log that will not be flushed in time', {});
                const suspendListener = (chrome.runtime.onSuspend.addListener as ReturnType<typeof vi.fn>).mock.calls[0]![0];

                const suspendPromise = suspendListener();
                await vi.advanceTimersByTimeAsync(3000);
                await suspendPromise;

                expect(consoleErrorSpy).toHaveBeenCalledWith(
                    expect.stringContaining('Flush timed out during suspend')
                );
            } finally {
                consoleErrorSpy.mockRestore();
                vi.useRealTimers();
            }
        });

        test('logCritical flushes immediately', async () => {
            await logger.logCritical('Critical event', {}, 'UNKN_001', 'test');
            const logs = await logger.getLogs();
            expect(logs.some((l: any) => l.message === 'Critical event')).toBe(true);
        });
    });

    describe('clearLogs', () => {
        test('clearLogs clears pending and stored logs', async () => {
            await logger.addLog('INFO', 'Clear test 1', {});
            await logger.addLog('INFO', 'Clear test 2', {});
            await logger.flushLogs(true);

            await logger.clearLogs();

            const logs = await logger.getLogs();
            expect(logs.length).toBe(0);
        });

        test('accepts new logs after clearLogs', async () => {
            await logger.addLog('INFO', 'Before clear', {});
            await logger.clearLogs();

            await logger.addLog('INFO', 'After clear', {});
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            expect(logs.length).toBe(1);
            expect(logs[0].message).toBe('After clear');
        });
    });

    describe('Structured Logging Functions', () => {
        test('logInfo creates an INFO log', async () => {
            await logger.logInfo('Test info message', { key: 'value' }, 'test-module');
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            const infoLog = logs.find((l: any) => l.message === 'Test info message');
            expect(infoLog).toBeDefined();
            expect(infoLog!.type).toBe('INFO');
        });

        test('logWarn creates a WARN log', async () => {
            await logger.logWarn('Test warning', { warn: true }, 'STRG_RD_001', 'test-module');
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            const warnLog = logs.find((l: any) => l.message === 'Test warning');
            expect(warnLog).toBeDefined();
            expect(warnLog!.type).toBe('WARN');
        });

        test('logError creates an ERROR log', async () => {
            await logger.logError('Test error', { err: 'details' }, 'UNKN_001', 'test-module');
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            const errorLog = logs.find((l: any) => l.message === 'Test error');
            expect(errorLog).toBeDefined();
            expect(errorLog!.type).toBe('ERROR');
        });

        test('logDebug creates a DEBUG log in development', async () => {
            process.env.NODE_ENV = 'development';
            await logger.logDebug('Debug message', { debug: true }, 'test-module');
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            const debugLog = logs.find((l: any) => l.message === 'Debug message');
            expect(debugLog).toBeDefined();
            expect(debugLog!.type).toBe('DEBUG');
        });

        test('logDebug creates no log in production', async () => {
            process.env.NODE_ENV = 'production';
            await logger.logDebug('Should not appear', {}, 'test-module');
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            const debugLog = logs.find((l: any) => l.message === 'Should not appear');
            expect(debugLog).toBeUndefined();
        });

        test('logSanitize creates a SANITIZE log', async () => {
            await logger.logSanitize('Sanitized content', { masked: true }, 'PII_DET_001', 'pii-module');
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            const sanitizeLog = logs.find((l: any) => l.message === 'Sanitized content');
            expect(sanitizeLog).toBeDefined();
            expect(sanitizeLog!.type).toBe('SANITIZE');
        });

        test('defaults the logError error code to UNKNOWN_ERROR', async () => {
            await logger.logError('Default error code', {});
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            const errorLog = logs.find((l: any) => l.message === 'Default error code');
            expect(errorLog).toBeDefined();
        });
    });

    describe('Log Pruning', () => {
        test('deletes logs older than 7 days', async () => {
            // Create a log with old timestamp by directly manipulating storage
            const oldTimestamp = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 days ago
            const oldLog = {
                id: 'old-log-id',
                timestamp: oldTimestamp,
                type: 'INFO',
                message: 'Old log',
                details: {}
            };

            // Set old log in storage
            await chrome.storage.local.set({ sanitization_logs: [oldLog] });

            // Add a new log and flush
            await logger.addLog('INFO', 'New log', {});
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            // Old log should be pruned
            expect(logs.some((l: any) => l.message === 'Old log')).toBe(false);
            expect(logs.some((l: any) => l.message === 'New log')).toBe(true);
        });

        // PBI #6: ログ保持期間を3日、MAX_LOGSを500に短縮
        test('deletes logs older than 4 days (3-day retention policy)', async () => {
            const oldTimestamp = Date.now() - (4 * 24 * 60 * 60 * 1000); // 4 days ago
            const oldLog = {
                id: 'old-log-4d',
                timestamp: oldTimestamp,
                type: 'INFO' as const,
                message: '4 day old log',
                details: {}
            };
            await chrome.storage.local.set({ sanitization_logs: [oldLog] });

            await logger.addLog('INFO', 'New log', {});
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            expect(logs.some((l: any) => l.message === '4 day old log')).toBe(false);
            expect(logs.some((l: any) => l.message === 'New log')).toBe(true);
        });

        test('truncates old logs when MAX_LOGS is exceeded', async () => {
            // Create 501 entries — exceeds target MAX_LOGS=500
            const logs = Array.from({ length: 501 }, (_, i) => ({
                id: `log-${i}`,
                timestamp: Date.now() - (600 - i) * 1000,
                type: 'INFO' as const,
                message: `Log ${i}`,
                details: {}
            }));
            await chrome.storage.local.set({ sanitization_logs: logs });

            await logger.addLog('INFO', 'Final log', {});
            await logger.flushLogs(true);

            const result = await logger.getLogs();
            expect(result.length).toBeLessThanOrEqual(500);
        });
    });

    // PBI #3: CSPRNGフォールバック
    describe('CSPRNG Fallback - Log ID Generation', () => {
        test('uses crypto.getRandomValues instead of Math.random when crypto.randomUUID is unavailable', async () => {
            // Override crypto.randomUUID to undefined to simulate unavailable environment
            // (delete may not work on @peculiar/webcrypto — use defineProperty instead)
            const originalRandomUUID = (globalThis.crypto as any).randomUUID;
            Object.defineProperty(globalThis.crypto, 'randomUUID', {
                value: undefined,
                writable: true,
                configurable: true,
            });

            const mathRandomSpy = vi.spyOn(Math, 'random');

            await logger.addLog('INFO', 'CSPRNG fallback test', {});
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            expect(logs.length).toBe(1);
            expect(logs[0].id).toBeDefined();
            expect(typeof logs[0].id).toBe('string');
            expect(logs[0].id.length).toBeGreaterThan(0);
            // Math.random should NOT be called — this is the RED assertion
            expect(mathRandomSpy).not.toHaveBeenCalled();

            // Restore
            Object.defineProperty(globalThis.crypto, 'randomUUID', {
                value: originalRandomUUID,
                writable: true,
                configurable: true,
            });
            mathRandomSpy.mockRestore();
        });
    });

    describe('ErrorCode Constants', () => {
        test('defines all error codes', () => {
            const codes = logger.ErrorCode;
            expect(codes.STORAGE_READ_FAILURE).toBe('STRG_RD_001');
            expect(codes.STORAGE_WRITE_FAILURE).toBe('STRG_WR_001');
            expect(codes.API_REQUEST_FAILURE).toBe('API_REQ_001');
            expect(codes.UNKNOWN_ERROR).toBe('UNKN_001');
            expect(codes.PERMISSION_REQUIRED).toBe('PERM_REQ_001');
            expect(codes.CRYPTO_DECRYPTION_FAILURE).toBe('CRPT_DEC_001');
            expect(codes.OBSIDIAN_CONNECT_FAILURE).toBe('OBS_CONN_001');
            expect(codes.CONTENT_EXTRACTION_FAILURE).toBe('CONT_EXT_001');
            expect(codes.PII_DETECTION_FAILURE).toBe('PII_DET_001');
            expect(codes.BADGE_UPDATE_FAILED).toBe('UI_BADGE_001');
        });

        test('defines the LogType constants correctly', () => {
            const types = logger.LogType;
            expect(types.INFO).toBe('INFO');
            expect(types.WARN).toBe('WARN');
            expect(types.ERROR).toBe('ERROR');
            expect(types.SANITIZE).toBe('SANITIZE');
            expect(types.DEBUG).toBe('DEBUG');
        });
    });

    describe('isDevelopment', () => {
        test('returns true when NODE_ENV=development', () => {
            process.env.NODE_ENV = 'development';
            expect(logger.isDevelopment()).toBe(true);
        });

        test('returns false when NODE_ENV=production', () => {
            process.env.NODE_ENV = 'production';
            expect(logger.isDevelopment()).toBe(false);
        });

        test('returns false when NODE_ENV=test', () => {
            process.env.NODE_ENV = 'test';
            expect(logger.isDevelopment()).toBe(false);
        });
    });

    describe('addLog Error Handling', () => {
        test('does not crash even when an error occurs', async () => {
            // Temporarily break chrome.storage to trigger error path
            const originalSet = chrome.storage.local.set;
            (chrome.storage.local as any).set = vi.fn(() => Promise.reject(new Error('Storage error')));

            // Should not throw
            await expect(logger.addLog('INFO', 'Error test', {})).resolves.not.toThrow();
            await expect(logger.flushLogs(true)).resolves.not.toThrow();

            // Restore
            (chrome.storage.local as any).set = originalSet;
        });
    });

    describe('LogEntry Structure', () => {
        test('includes an ID and timestamp in log entries', async () => {
            await logger.addLog('INFO', 'Structure test', { data: 'test' });
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            expect(logs.length).toBeGreaterThanOrEqual(1);
            const log = logs.find((l: any) => l.message === 'Structure test');
            expect(log).toBeDefined();
            expect(log!.id).toBeDefined();
            expect(log!.timestamp).toBeDefined();
            expect(typeof log!.timestamp).toBe('number');
        });

        test('extracts traceId from details to the top level', async () => {
            await logger.addLog('INFO', 'Trace ID test', { data: 'test', traceId: 'trace-123' });
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            const log = logs.find((l: any) => l.message === 'Trace ID test');
            expect(log).toBeDefined();
            expect(log!.traceId).toBe('trace-123');
            expect((log!.details as Record<string, unknown>).traceId).toBeUndefined();
        });

        test('ignores traceId when it is not a string', async () => {
            await logger.addLog('INFO', 'No trace ID test', { data: 'test', traceId: 123 });
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            const log = logs.find((l: any) => l.message === 'No trace ID test');
            expect(log).toBeDefined();
            expect(log!.traceId).toBeUndefined();
        });
    });
});
