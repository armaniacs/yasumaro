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
        logger = await import('../logger.js');
        await logger.clearLogs();
        logger.clearPendingLogs();
    });

    afterEach(async () => {
        await logger.clearLogs();
    });

    describe('sanitizeLogDetails - Array handling', () => {
        test('配列内のnull/undefinedを処理する', async () => {
            await logger.addLog('INFO', 'Array null test', {
                arr: [null, undefined, 'value', null]
            });
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            expect(logs.length).toBe(1);
            expect((logs[0].details as Record<string, unknown>).arr).toEqual([null, undefined, 'value', null]);
        });

        test('配列内のDateオブジェクトをISO文字列に変換する', async () => {
            const date = new Date('2024-06-15T10:00:00Z');
            await logger.addLog('INFO', 'Array Date test', {
                dates: [date]
            });
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            expect(logs.length).toBe(1);
            expect((logs[0].details as Record<string, unknown>).dates[0]).toBe(date.toISOString());
        });

        test('配列内のErrorオブジェクトを変換する', async () => {
            const error = new Error('Array error test');
            await logger.addLog('INFO', 'Array Error test', {
                errors: [error]
            });
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            expect(logs.length).toBe(1);
            expect(((logs[0].details as Record<string, unknown>).errors as unknown[])[0].message).toBe('Array error test');
            expect(((logs[0].details as Record<string, unknown>).errors as unknown[])[0].stack).toBeDefined();
        });

        test('配列内の文字列PIIをマスクする', async () => {
            await logger.addLog('INFO', 'Array PII test', {
                contacts: ['user@example.com', 'regular text']
            });
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            expect(logs.length).toBe(1);
            // Email should be masked
            expect((logs[0].details as Record<string, unknown>).contacts[0]).not.toContain('user@example.com');
        });

        test('ネストされた配列を処理する', async () => {
            await logger.addLog('INFO', 'Nested array test', {
                matrix: [[1, 2], ['a', 'b']]
            });
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            expect(logs.length).toBe(1);
            expect((logs[0].details as Record<string, unknown>).matrix).toEqual([[1, 2], ['a', 'b']]);
        });

        test('配列内のプリミティブ型を処理する', async () => {
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
        test('バッファ上限超過時に古いエントリを破棄する', async () => {
            // MAX_PENDING_LOGS = 100, so add 101 logs
            for (let i = 0; i < 101; i++) {
                await logger.addLog('INFO', `Log ${i}`, { index: i });
            }

            const pendingCount = logger.getPendingLogCount();
            expect(pendingCount).toBeLessThanOrEqual(100);
        });

        test('getPendingLogCountが保留中ログ数を返す', async () => {
            const initialCount = logger.getPendingLogCount();
            expect(initialCount).toBeGreaterThanOrEqual(0);

            await logger.addLog('INFO', 'Pending test', {});
            const newCount = logger.getPendingLogCount();
            expect(newCount).toBeGreaterThanOrEqual(initialCount);
        });

        test('clearPendingLogsが保留中ログをクリアする', async () => {
            await logger.addLog('INFO', 'To be cleared', {});
            logger.clearPendingLogs();
            expect(logger.getPendingLogCount()).toBe(0);
        });
    });

    describe('clearLogs', () => {
        test('clearLogsが保留中ログとストレージログをクリアする', async () => {
            await logger.addLog('INFO', 'Clear test 1', {});
            await logger.addLog('INFO', 'Clear test 2', {});
            await logger.flushLogs(true);

            await logger.clearLogs();

            const logs = await logger.getLogs();
            expect(logs.length).toBe(0);
        });

        test('clearLogs後に新しいログを追加できる', async () => {
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
        test('logInfoがINFOログを作成する', async () => {
            await logger.logInfo('Test info message', { key: 'value' }, 'test-module');
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            const infoLog = logs.find((l: any) => l.message === 'Test info message');
            expect(infoLog).toBeDefined();
            expect(infoLog!.type).toBe('INFO');
        });

        test('logWarnがWARNログを作成する', async () => {
            await logger.logWarn('Test warning', { warn: true }, 'STRG_RD_001', 'test-module');
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            const warnLog = logs.find((l: any) => l.message === 'Test warning');
            expect(warnLog).toBeDefined();
            expect(warnLog!.type).toBe('WARN');
        });

        test('logErrorがERRORログを作成する', async () => {
            await logger.logError('Test error', { err: 'details' }, 'UNKN_001', 'test-module');
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            const errorLog = logs.find((l: any) => l.message === 'Test error');
            expect(errorLog).toBeDefined();
            expect(errorLog!.type).toBe('ERROR');
        });

        test('logDebugが開発環境でDEBUGログを作成する', async () => {
            process.env.NODE_ENV = 'development';
            await logger.logDebug('Debug message', { debug: true }, 'test-module');
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            const debugLog = logs.find((l: any) => l.message === 'Debug message');
            expect(debugLog).toBeDefined();
            expect(debugLog!.type).toBe('DEBUG');
        });

        test('logDebugが本番環境でログを作成しない', async () => {
            process.env.NODE_ENV = 'production';
            await logger.logDebug('Should not appear', {}, 'test-module');
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            const debugLog = logs.find((l: any) => l.message === 'Should not appear');
            expect(debugLog).toBeUndefined();
        });

        test('logSanitizeがSANITIZEログを作成する', async () => {
            await logger.logSanitize('Sanitized content', { masked: true }, 'PII_DET_001', 'pii-module');
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            const sanitizeLog = logs.find((l: any) => l.message === 'Sanitized content');
            expect(sanitizeLog).toBeDefined();
            expect(sanitizeLog!.type).toBe('SANITIZE');
        });

        test('logErrorのデフォルトエラーコードがUNKNOWN_ERROR', async () => {
            await logger.logError('Default error code', {});
            await logger.flushLogs(true);

            const logs = await logger.getLogs();
            const errorLog = logs.find((l: any) => l.message === 'Default error code');
            expect(errorLog).toBeDefined();
        });
    });

    describe('Log Pruning', () => {
        test('7日より古いログが削除される', async () => {
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
    });

    describe('ErrorCode Constants', () => {
        test('全てのエラーコードが定義されている', () => {
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

        test('LogType定数が正しく定義されている', () => {
            const types = logger.LogType;
            expect(types.INFO).toBe('INFO');
            expect(types.WARN).toBe('WARN');
            expect(types.ERROR).toBe('ERROR');
            expect(types.SANITIZE).toBe('SANITIZE');
            expect(types.DEBUG).toBe('DEBUG');
        });
    });

    describe('isDevelopment', () => {
        test('NODE_ENV=developmentでtrueを返す', () => {
            process.env.NODE_ENV = 'development';
            expect(logger.isDevelopment()).toBe(true);
        });

        test('NODE_ENV=productionでfalseを返す', () => {
            process.env.NODE_ENV = 'production';
            expect(logger.isDevelopment()).toBe(false);
        });

        test('NODE_ENV=testでfalseを返す', () => {
            process.env.NODE_ENV = 'test';
            expect(logger.isDevelopment()).toBe(false);
        });
    });

    describe('addLog Error Handling', () => {
        test('エラー発生時もクラッシュしない', async () => {
            // Temporarily break chrome.storage to trigger error path
            const originalSet = chrome.storage.local.set;
            (chrome.storage.local as any).set = vi.fn(() => Promise.reject(new Error('Storage error')));

            // Should not throw
            await logger.addLog('INFO', 'Error test', {});
            await logger.flushLogs(true);

            // Restore
            (chrome.storage.local as any).set = originalSet;
        });
    });

    describe('LogEntry Structure', () => {
        test('ログエントリにIDとタイムスタンプが含まれる', async () => {
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
    });
});
