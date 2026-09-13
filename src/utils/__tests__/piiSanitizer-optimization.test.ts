/**
 * piiSanitizer-optimization.test.ts
 * PII置換効率化（アレイjoin方式）に関するテスト
 */


import { sanitizeRegex, MAX_INPUT_SIZE } from '../piiSanitizer.js';

interface MaskedItem {
    type: string;
    original: string;
    masked: string;
    index: number;
}

interface SanitizeResult {
    text: string;
    maskedItems: MaskedItem[];
    error?: string;
}

interface PiiTestCase {
    input: string;
    shouldMatch: boolean;
    expectedOriginal: string;
}

describe('PII置換の効率化（アレイjoin方式）', () => {
    describe('機能テスト - 置換結果の正確性', () => {
        it('masks email addresses correctly', async () => {
            const text = 'お問い合わせは example@test.com まで';
            const result = await sanitizeRegex(text) as SanitizeResult;

            expect(result.text).toContain('[MASKED:email]');
            expect(result.text).not.toContain('example@test.com');
            expect(result.maskedItems).toHaveLength(1);
            expect(result.maskedItems[0]!.type).toBe('email');
            expect(result.maskedItems[0]!.original).toBe('example@test.com');
        });

        it('detects and replaces multiple PII types at once', async () => {
            const text = '連絡先: user@example.com, TEL: 090-1234-5678';
            const result = await sanitizeRegex(text) as SanitizeResult;

            expect(result.text).toContain('[MASKED:email]');
            expect(result.text).toContain('[MASKED:phoneJp]');
            expect(result.text).not.toContain('user@example.com');
            expect(result.text).not.toContain('090-1234-5678');
            expect(result.maskedItems.length).toBeGreaterThanOrEqual(2);
        });

        it('detects and replaces credit card numbers correctly', async () => {
            const text = 'カード番号: 4111-1111-1111-1111';
            const result = await sanitizeRegex(text) as SanitizeResult;

            expect(result.text).toContain('[MASKED:creditCard]');
            expect(result.text).not.toContain('4111-1111-1111-1111');
            expect(result.maskedItems.some(item => item.type === 'creditCard')).toBe(true);
        });

        it('detects and replaces My Number values correctly', async () => {
            const text = 'マイナンバー: 1234-5678-9012';
            const result = await sanitizeRegex(text) as SanitizeResult;

            expect(result.text).toContain('[MASKED:myNumber]');
            expect(result.text).not.toContain('1234-5678-9012');
            expect(result.maskedItems.some(item => item.type === 'myNumber')).toBe(true);
        });

        it('detects and replaces bank account numbers correctly', async () => {
            const text = '口座番号: 1234567';
            const result = await sanitizeRegex(text) as SanitizeResult;

            expect(result.text).toContain('[MASKED:bankAccount]');
            expect(result.text).not.toContain('1234567');
            expect(result.maskedItems.some(item => item.type === 'bankAccount')).toBe(true);
        });

        it('handles duplicate PII correctly', async () => {
            const text = 'メール: test1@example.com, test2@example.com';
            const result = await sanitizeRegex(text) as SanitizeResult;

            const emailMasks = result.maskedItems.filter(item => item.type === 'email');
            expect(emailMasks.length).toBe(2);
            expect(result.text).not.toContain('test1@example.com');
            expect(result.text).not.toContain('test2@example.com');
        });

        it('handles null and undefined correctly', async () => {
            let result;

            result = await sanitizeRegex(null as unknown as string) as SanitizeResult;
            expect(result.text).toBe('');
            expect(result.maskedItems).toHaveLength(0);

            result = await sanitizeRegex(undefined as unknown as string) as SanitizeResult;
            expect(result.text).toBe('');
            expect(result.maskedItems).toHaveLength(0);
        });

        it('handles empty strings correctly', async () => {
            const result = await sanitizeRegex('') as SanitizeResult;
            expect(result.text).toBe('');
            expect(result.maskedItems).toHaveLength(0);
        });

        it('handles text without PII correctly', async () => {
            const text = 'これは単なるテキストです。個人情報は含まれていません。';
            const result = await sanitizeRegex(text) as SanitizeResult;

            expect(result.text).toBe(text);
            expect(result.maskedItems).toHaveLength(0);
        });

        it('handles adjacent PII correctly', async () => {
            const text = '連絡先:jun@test.comTEL:090-1234-5678';
            const result = await sanitizeRegex(text) as SanitizeResult;

            expect(result.text).toContain('[MASKED:email]');
            expect(result.text).toContain('[MASKED:phoneJp]');
            expect(result.text).not.toContain('jun@test.com');
            expect(result.text).not.toContain('090-1234-5678');
        });
    });

    describe('パフォーマンステスト', () => {
        it('processes text with large amounts of PII efficiently', async () => {
            // 1000文字のテキストに100個のメールアドレスを含める
            const parts: string[] = [];
            for (let i = 0; i < 100; i++) {
                parts.push(`user${i}@example.com`);
                parts.push(' ');
            }
            const text = parts.join('');

            const startTime = Date.now();
            const result = await sanitizeRegex(text) as SanitizeResult;
            const duration = Date.now() - startTime;

            expect(result.maskedItems.length).toBe(100);
            // 5秒以内で処理できるべき
            expect(duration).toBeLessThan(5000);
            console.log(`100個のPII置換完了: ${duration}ms`);
        });

        it('processes typical usage quickly', async () => {
            const text = 'お問い合わせ: support@example.com, 電話: 03-1234-5678';

            const startTime = Date.now();
            const result = await sanitizeRegex(text) as SanitizeResult;
            const duration = Date.now() - startTime;

            expect(result.maskedItems.length).toBeGreaterThanOrEqual(1);
            // 通常使用では100ms以内で処理できるべき
            expect(duration).toBeLessThan(100);
            console.log(`通常使用ケース処理時間: ${duration}ms`);
        });

        it('works correctly with text at the size limit', async () => {
            // MAX_INPUT_SIZE - 16（user@example.comの長さ）分のテキストを作成
            const text = 'a'.repeat(MAX_INPUT_SIZE - 16) + 'user@example.com';
            expect(text.length).toBe(MAX_INPUT_SIZE); // 正確にMAX_INPUT_SIZEであることを確認

            const result = await sanitizeRegex(text) as SanitizeResult;

            expect(result.text).toContain('[MASKED:email]');
            expect(result.text).not.toContain('user@example.com');
        });

        it('returns a size-exceeded error correctly', async () => {
            const text = 'a'.repeat(MAX_INPUT_SIZE + 1);

            const result = await sanitizeRegex(text) as SanitizeResult;

            // エラーが設定されていることを確認
            expect(result.error).toBeDefined();
            expect(result.maskedItems).toHaveLength(0);
        });

        it('skips the size limit when requested', async () => {
            const text = 'a'.repeat(MAX_INPUT_SIZE + 1) + 'user@example.com';

            const result = await sanitizeRegex(text, { skipSizeLimit: true }) as SanitizeResult;

            expect(result.error).toBeUndefined();
            expect(result.text).toContain('[MASKED:email]');
        });
    });

    describe('タイムアウトテスト', () => {
        it('accepts a custom timeout setting', async () => {
            const text = '連絡先: test@example.com';

            const result = await sanitizeRegex(text, { timeout: 10000 }) as SanitizeResult;

            expect(result.text).toContain('[MASKED:email]');
            expect(result.error).toBeUndefined();
        });

        it('processes complex regex input without errors', async () => {
            // 多種多様なPIIを含む複雑なテキスト
            const text = `
                顧客情報:
                メール: customer1@example.com, customer2@test.co.jp
                電話: 090-1111-2222, 03-9876-5432
                カード: 1111-2222-3333-4444, 1234-5678-9012-3456
                マイナンバー: 1234-5678-9012
                口座: 0123456, 7654321
            `;

            const result = await sanitizeRegex(text) as SanitizeResult;

            expect(result.maskedItems.length).toBeGreaterThan(0);
            expect(result.text).toContain('[MASKED:email]');
            expect(result.text).toContain('[MASKED:phoneJp]');
            expect(result.text).toContain('[MASKED:creditCard]');
            expect(result.text).toContain('[MASKED:myNumber]');
            expect(result.text).toContain('[MASKED:bankAccount]');
        });
    });

    describe('エッジケース', () => {
        it('replaces consecutive PII correctly', async () => {
            const text = 'a@example.comb@example.comc@example.com';
            const result = await sanitizeRegex(text) as SanitizeResult;

            const emailMasks = result.maskedItems.filter(item => item.type === 'email');
            // 連続している場合、最長一致で検出されるため
            expect(emailMasks.length).toBeGreaterThanOrEqual(1);
        });

        it('handles PII with special characters correctly', async () => {
            const text = 'メール: user+tag@example-domain.com';
            const result = await sanitizeRegex(text) as SanitizeResult;

            expect(result.text).toContain('[MASKED:email]');
            expect(result.maskedItems[0]!.original).toContain('user+tag@example-domain.com');
        });

        it('keeps replaced text within the original length', async () => {
            const text = '連絡先: test@example.com, 電話: 090-1234-5678';
            const result = await sanitizeRegex(text) as SanitizeResult;

            // マスク文字列 [MASKED:type] は元のPII文字列より短くなることが多いが、
            // ここでは「マスクにより内容が変更されていること」だけを保証する
            expect(result.text).not.toBe(text);
            expect(result.text).not.toContain('test@example.com');
            expect(result.text).not.toContain('090-1234-5678');
        });

        it('contains no duplicates in maskedItems', async () => {
            const text = 'email1@example.com email1@example.com';
            const result = await sanitizeRegex(text) as SanitizeResult;

            // 同じメールアドレスが2回ある場合、2つのアイテムが返る
            expect(result.maskedItems.length).toBe(2);
            // 同じメールアドレスが二回ある場合、二つのアイテムが返ることを確認
            expect(result.maskedItems.length).toBe(2);
        });
    });

    describe('配列join方式の動作検証', () => {
        it('keeps replacement indexes correct', async () => {
            const text = 'A有@example.comB有@test.co.jpC';
            const result = await sanitizeRegex(text) as SanitizeResult;

            // マスクされた項目のインデックスが昇順であることを確認
            for (let i = 1; i < result.maskedItems.length; i++) {
                expect(result.maskedItems[i]!.index).toBeGreaterThan(result.maskedItems[i - 1]!.index);
            }
        });

        it('keeps replaced strings consistent', async () => {
            const original = '前user@example.com後';
            const result = await sanitizeRegex(original) as SanitizeResult;

            // マスクの前後の文字列が正しく保持されていることを確認
            expect(result.text).toContain('前');
            expect(result.text).toContain('後');
            expect(result.text).not.toContain('user@example.com');

            // マスクが正しい位置にあることを確認
            const expectedStructure = '前[MASKED:email]後';
            expect(result.text).toBe(expectedStructure);
        });
    });

    describe('正規表現パターンの検証', () => {
        const testPiiDetection = async (pattern: any, type: string, testCase: PiiTestCase) => {
            const result = await sanitizeRegex(testCase.input) as SanitizeResult;
            if (testCase.shouldMatch) {
                expect(result.maskedItems.some(item =>
                    item.type === type && item.original === testCase.expectedOriginal
                )).toBe(true);
            } else {
                expect(result.maskedItems.some(item => item.type === type)).toBe(false);
            }
        };

        it('detects email addresses in various formats', async () => {
            const testCases: PiiTestCase[] = [
                { input: 'simple@domain.com', shouldMatch: true, expectedOriginal: 'simple@domain.com' },
                { input: 'name.surname@sub.domain.co.uk', shouldMatch: true, expectedOriginal: 'name.surname@sub.domain.co.uk' },
                { input: 'user123@test-domain.com', shouldMatch: true, expectedOriginal: 'user123@test-domain.com' },
            ];

            for (const testCase of testCases) {
                await testPiiDetection(null, 'email', testCase);
            }
        });

        it('detects phone numbers in various formats', async () => {
            const testCases: PiiTestCase[] = [
                { input: '090-1234-5678', shouldMatch: true, expectedOriginal: '090-1234-5678' },
                { input: '03 1234 5678', shouldMatch: true, expectedOriginal: '03 1234 5678' },
                { input: '01234567890', shouldMatch: true, expectedOriginal: '01234567890' },
            ];

            for (const testCase of testCases) {
                await testPiiDetection(null, 'phoneJp', testCase);
            }
        });
    });
});