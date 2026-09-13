/**
 * logger-security.test.ts
 * 【セキュリティ】logger.ts の深度制限と循環参照検出のテスト
 */


import { addLog, getLogs, clearLogs, flushLogs } from '../logger.js';

describe('Logger - 深度制限と循環参照検出', () => {
    beforeEach(async () => {
        await clearLogs();
    });

    afterEach(async () => {
        await clearLogs();
    });

    describe('深度制限のテスト', () => {
        test('processes deep nesting within MAX_RECURSION_DEPTH normally', async () => {
            // 50レベルのネスト（制限内）
            let nested: Record<string, any> = { url: 'example.com' };
            for (let i = 0; i < 50; i++) {
                nested = { level: i, nested };
            }

            await addLog('INFO', 'Nested test', { data: nested });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            expect((logs[0]!.details as Record<string, unknown>).data).toBeDefined();
        });

        test('replaces nesting deeper than MAX_RECURSION_DEPTH with a safe placeholder', async () => {
            // 101レベルのネスト（制限超過）
            let nested: Record<string, any> = { url: 'example.com' };
            for (let i = 0; i < 101; i++) {
                nested = { level: i, nested };
            }

            await addLog('INFO', 'Too deep test', { data: nested });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            const jsonStr = JSON.stringify(logs[0]!.details);
            expect(jsonStr).toContain('[SANITIZED: too deep]');
        });

        test('limits deeply nested arrays as well', async () => {
            // 深度100を超えるオブジェクト構造の配列
            let nested: Record<string, any> = { value: 'example.com' };
            for (let i = 0; i < 101; i++) {
                nested = { level: i, nested };
            }

            await addLog('INFO', 'Array too deep test', { data: [nested] });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            const jsonStr = JSON.stringify(logs[0]!.details);
            expect(jsonStr).toContain('[SANITIZED: too deep]');
        });
    });

    describe('循環参照検出のテスト', () => {
        test('detects object circular references', async () => {
            // a -> b -> a 循環参照
            const a: Record<string, any> = { url: 'example.com' };
            const b = { ref: a };
            a.cycle = b;

            await addLog('INFO', 'Circular ref test', { data: a });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            const jsonStr = JSON.stringify(logs[0]!.details);
            expect(jsonStr).toContain('[SANITIZED: circular reference]');
        });

        test('detects object self-references', async () => {
            // a -> a 自己参照
            const a: Record<string, any> = { url: 'example.com' };
            a.self = a;

            await addLog('INFO', 'Self ref test', { data: a });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            const jsonStr = JSON.stringify(logs[0]!.details);
            expect(jsonStr).toContain('[SANITIZED: circular reference]');
        });

        test('detects array circular references', async () => {
            // [] -> [] 循環参照
            const arr: any[] = ['example.com'];
            arr[1] = arr;

            await addLog('INFO', 'Array circular test', { data: arr });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            const jsonStr = JSON.stringify(logs[0]!.details);
            expect(jsonStr).toContain('[SANITIZED: circular reference]');
        });

        test('detects mixed object-array circular references', async () => {
            // [] -> {} -> [] 混合循環参照
            const arr: any[] = ['example.com'];
            const obj = { ref: arr };
            arr[1] = obj;

            await addLog('INFO', 'Mixed circular test', { data: arr });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            const jsonStr = JSON.stringify(logs[0]!.details);
            expect(jsonStr).toContain('[SANITIZED: circular reference]');
        });
    });

    describe('境界値とエッジケース', () => {
        test('handles null and undefined safely', async () => {
            await addLog('INFO', 'null/undefined test', { a: null, b: undefined });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            expect((logs[0]!.details as Record<string, unknown>).a).toBeNull();
            expect((logs[0]!.details as Record<string, unknown>).b).toBeUndefined();
        });

        test('stringifies Date objects', async () => {
            const date = new Date('2024-01-01T12:00:00Z');
            await addLog('INFO', 'Date test', { timestamp: date });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            expect((logs[0]!.details as Record<string, unknown>).timestamp).toEqual({ __value: date.toISOString() });
        });

        test('converts Error objects to message and stack', async () => {
            const error = new Error('Test error');
            await addLog('INFO', 'Error test', { error });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            expect(((logs[0]!.details as Record<string, unknown>).error as Record<string, unknown>).message).toBe('Test error');
            expect(((logs[0]!.details as Record<string, unknown>).error as Record<string, unknown>).stack).toBeDefined();
        });

        test('passes primitive values through unchanged', async () => {
            await addLog('INFO', 'Primitive test', {
                num: 42,
                bool: true,
                str: 'hello'
            });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            expect((logs[0]!.details as Record<string, unknown>).num).toBe(42);
            expect((logs[0]!.details as Record<string, unknown>).bool).toBe(true);
            expect((logs[0]!.details as Record<string, unknown>).str).toBe('hello');
        });

        test('processes non-circular array elements normally', async () => {
            const a: Record<string, any> = { url: 'example.com' };
            const b: Record<string, any> = { url: 'example.org' };
            a.cycle = b;
            b.cycle = a;

            await addLog('INFO', 'Array mixed test', { data: [1, 'hello', a, 42] });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            expect(((logs[0]!.details as Record<string, unknown>).data as unknown[])[0]).toBe(1);
            expect(((logs[0]!.details as Record<string, unknown>).data as unknown[])[1]).toBe('hello');
        });
    });

    describe('セキュリティ検証', () => {
        test('masks PII with no depth limit', async () => {
            await addLog('INFO', 'PII test', {
                contact: {
                    email: 'user@example.com',
                    phone: '01234567890'
                }
            });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            const jsonStr = JSON.stringify(logs[0]!.details);
            expect(jsonStr).not.toContain('user@example.com');
            expect(jsonStr).toContain('[MASKED:email]');
        });

        test('does not leak raw data when a circular reference is found', async () => {
            const sensitiveData = 'secret@example.com';
            const a: Record<string, any> = { data: sensitiveData };
            const b = { ref: a };
            a.cycle = b;

            await addLog('INFO', 'Security test', { payload: a });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            const jsonStr = JSON.stringify(logs[0]!.details);
            expect(jsonStr).not.toContain(sensitiveData);
            expect(jsonStr).toContain('[SANITIZED: circular reference]');
        });

        test('does not leak raw data when depth is exceeded', async () => {
            const sensitiveData = 'secret@example.com';
            let nested: Record<string, any> = { level: 0, data: sensitiveData };
            for (let i = 1; i < 102; i++) {
                nested = { level: i, nested };
            }

            await addLog('INFO', 'Deep security test', { payload: nested });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            const jsonStr = JSON.stringify(logs[0]!.details);
            expect(jsonStr).not.toContain(sensitiveData);
            expect(jsonStr).toContain('[SANITIZED: too deep]');
        });

        test('masks PII inside the message parameter as well', async () => {
            await addLog('ERROR', 'Failed to fetch https://example.com/user@test.com');
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            expect(logs[0]!.message).not.toContain('user@test.com');
            expect(logs[0]!.message).toContain('[MASKED:email]');
        });

        test('leaves a message without PII unchanged', async () => {
            await addLog('INFO', 'Recording pipeline completed successfully');
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            expect(logs[0]!.message).toBe('Recording pipeline completed successfully');
        });
    });
});