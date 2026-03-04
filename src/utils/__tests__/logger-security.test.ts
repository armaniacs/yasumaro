/**
 * logger-security.test.ts
 * 【セキュリティ】logger.ts の深度制限と循環参照検出のテスト
 */

import { describe, test, expect } from '@jest/globals';
import { addLog, getLogs, clearLogs, flushLogs } from '../logger';

describe('Logger - 深度制限と循環参照検出', () => {
    beforeEach(async () => {
        await clearLogs();
    });

    afterEach(async () => {
        await clearLogs();
    });

    describe('深度制限のテスト', () => {
        test('深いネスト（MAX_RECURSION_DEPTH 枠内）は正常に処理される', async () => {
            // 50レベルのネスト（制限内）
            let nested: Record<string, any> = { url: 'example.com' };
            for (let i = 0; i < 50; i++) {
                nested = { level: i, nested };
            }

            await addLog('INFO', 'Nested test', { data: nested });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            expect(logs[0].details.data).toBeDefined();
        });

        test('深いネスト（MAX_RECURSION_DEPTH + 1）は安全なプレースホルダーに置換される', async () => {
            // 101レベルのネスト（制限超過）
            let nested: Record<string, any> = { url: 'example.com' };
            for (let i = 0; i < 101; i++) {
                nested = { level: i, nested };
            }

            await addLog('INFO', 'Too deep test', { data: nested });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            const jsonStr = JSON.stringify(logs[0].details);
            expect(jsonStr).toContain('[SANITIZED: too deep]');
        });

        test('配列の深いネストも制限される', async () => {
            // 深度100を超えるオブジェクト構造の配列
            let nested: Record<string, any> = { value: 'example.com' };
            for (let i = 0; i < 101; i++) {
                nested = { level: i, nested };
            }

            await addLog('INFO', 'Array too deep test', { data: [nested] });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            const jsonStr = JSON.stringify(logs[0].details);
            expect(jsonStr).toContain('[SANITIZED: too deep]');
        });
    });

    describe('循環参照検出のテスト', () => {
        test('オブジェクトの循環参照が検出される', async () => {
            // a -> b -> a 循環参照
            const a: Record<string, any> = { url: 'example.com' };
            const b = { ref: a };
            a.cycle = b;

            await addLog('INFO', 'Circular ref test', { data: a });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            const jsonStr = JSON.stringify(logs[0].details);
            expect(jsonStr).toContain('[SANITIZED: circular reference]');
        });

        test('オブジェクトの自己参照が検出される', async () => {
            // a -> a 自己参照
            const a: Record<string, any> = { url: 'example.com' };
            a.self = a;

            await addLog('INFO', 'Self ref test', { data: a });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            const jsonStr = JSON.stringify(logs[0].details);
            expect(jsonStr).toContain('[SANITIZED: circular reference]');
        });

        test('配列の循環参照が検出される', async () => {
            // [] -> [] 循環参照
            const arr: any[] = ['example.com'];
            arr[1] = arr;

            await addLog('INFO', 'Array circular test', { data: arr });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            const jsonStr = JSON.stringify(logs[0].details);
            expect(jsonStr).toContain('[SANITIZED: circular reference]');
        });

        test('オブジェクトと配列の混合循環参照が検出される', async () => {
            // [] -> {} -> [] 混合循環参照
            const arr: any[] = ['example.com'];
            const obj = { ref: arr };
            arr[1] = obj;

            await addLog('INFO', 'Mixed circular test', { data: arr });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            const jsonStr = JSON.stringify(logs[0].details);
            expect(jsonStr).toContain('[SANITIZED: circular reference]');
        });
    });

    describe('境界値とエッジケース', () => {
        test('null と undefined は安全に処理される', async () => {
            await addLog('INFO', 'null/undefined test', { a: null, b: undefined });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            expect(logs[0].details.a).toBeNull();
            expect(logs[0].details.b).toBeUndefined();
        });

        test('Date オブジェクトは文字列化される', async () => {
            const date = new Date('2024-01-01T12:00:00Z');
            await addLog('INFO', 'Date test', { timestamp: date });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            expect(logs[0].details.timestamp).toBe(date.toISOString());
        });

        test('Error オブジェクトは message と stack に変換される', async () => {
            const error = new Error('Test error');
            await addLog('INFO', 'Error test', { error });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            expect(logs[0].details.error.message).toBe('Test error');
            expect(logs[0].details.error.stack).toBeDefined();
        });

        test('プリミティブ型はそのまま渡される', async () => {
            await addLog('INFO', 'Primitive test', {
                num: 42,
                bool: true,
                str: 'hello'
            });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            expect(logs[0].details.num).toBe(42);
            expect(logs[0].details.bool).toBe(true);
            expect(logs[0].details.str).toBe('hello');
        });

        test('配列内の循環参照以外の要素は通常通り処理される', async () => {
            const a: Record<string, any> = { url: 'example.com' };
            const b: Record<string, any> = { url: 'example.org' };
            a.cycle = b;
            b.cycle = a;

            await addLog('INFO', 'Array mixed test', { data: [1, 'hello', a, 42] });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            expect(logs[0].details.data[0]).toBe(1);
            expect(logs[0].details.data[1]).toBe('hello');
        });
    });

    describe('セキュリティ検証', () => {
        test('PII がマスクされることを確認（深度制限なし）', async () => {
            await addLog('INFO', 'PII test', {
                contact: {
                    email: 'user@example.com',
                    phone: '01234567890'
                }
            });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            const jsonStr = JSON.stringify(logs[0].details);
            expect(jsonStr).not.toContain('user@example.com');
            expect(jsonStr).toContain('[MASKED:email]');
        });

        test('循環参照が見つかっても生データはリークしない', async () => {
            const sensitiveData = 'secret@example.com';
            const a: Record<string, any> = { data: sensitiveData };
            const b = { ref: a };
            a.cycle = b;

            await addLog('INFO', 'Security test', { payload: a });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            const jsonStr = JSON.stringify(logs[0].details);
            expect(jsonStr).not.toContain(sensitiveData);
            expect(jsonStr).toContain('[SANITIZED: circular reference]');
        });

        test('深度超過時も生データはリークしない', async () => {
            const sensitiveData = 'secret@example.com';
            let nested: Record<string, any> = { level: 0, data: sensitiveData };
            for (let i = 1; i < 102; i++) {
                nested = { level: i, nested };
            }

            await addLog('INFO', 'Deep security test', { payload: nested });
            await flushLogs(true);

            const logs = await getLogs();
            expect(logs.length).toBe(1);
            const jsonStr = JSON.stringify(logs[0].details);
            expect(jsonStr).not.toContain(sensitiveData);
            expect(jsonStr).toContain('[SANITIZED: too deep]');
        });
    });
});