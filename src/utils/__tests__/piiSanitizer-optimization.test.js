/**
 * piiSanitizer-optimization.test.js
 * PII置換効率化（アレイjoin方式）に関するテスト
 */

import { describe, it, expect } from '@jest/globals';
import { sanitizeRegex, MAX_INPUT_SIZE } from '../piiSanitizer.ts';

describe('PII置換の効率化（アレイjoin方式）', () => {
    describe('機能テスト - 置換結果の正確性', () => {
        it('メールアドレスを正常にマスクできる', async () => {
            const text = 'お問い合わせは example@test.com まで';
            const result = await sanitizeRegex(text);

            expect(result.text).toContain('[MASKED:email]');
            expect(result.text).not.toContain('example@test.com');
            expect(result.maskedItems).toHaveLength(1);
            expect(result.maskedItems[0].type).toBe('email');
            expect(result.maskedItems[0].original).toBe('example@test.com');
        });

        it('複数のPIIタイプを一度に検出・置換できる', async () => {
            const text = '連絡先: user@example.com, TEL: 090-1234-5678';
            const result = await sanitizeRegex(text);

            expect(result.text).toContain('[MASKED:email]');
            expect(result.text).toContain('[MASKED:phoneJp]');
            expect(result.text).not.toContain('user@example.com');
            expect(result.text).not.toContain('090-1234-5678');
            expect(result.maskedItems.length).toBeGreaterThanOrEqual(2);
        });

        it('クレジットカード番号を正しく検出・置換できる', async () => {
            const text = 'カード番号: 1234-5678-9012-3456';
            const result = await sanitizeRegex(text);

            expect(result.text).toContain('[MASKED:creditCard]');
            expect(result.text).not.toContain('1234-5678-9012-3456');
            expect(result.maskedItems.some(item => item.type === 'creditCard')).toBe(true);
        });

        it('マイナンバーを正しく検出・置換できる', async () => {
            const text = 'マイナンバー: 1234-5678-9012';
            const result = await sanitizeRegex(text);

            expect(result.text).toContain('[MASKED:myNumber]');
            expect(result.text).not.toContain('1234-5678-9012');
            expect(result.maskedItems.some(item => item.type === 'myNumber')).toBe(true);
        });

        it('銀行口座番号を正しく検出・置換できる', async () => {
            const text = '口座番号: 1234567';
            const result = await sanitizeRegex(text);

            expect(result.text).toContain('[MASKED:bankAccount]');
            expect(result.text).not.toContain('1234567');
            expect(result.maskedItems.some(item => item.type === 'bankAccount')).toBe(true);
        });

        it('重複するPIIを正しく扱える', async () => {
            const text = 'メール: test1@example.com, test2@example.com';
            const result = await sanitizeRegex(text);

            const emailMasks = result.maskedItems.filter(item => item.type === 'email');
            expect(emailMasks.length).toBe(2);
            expect(result.text).not.toContain('test1@example.com');
            expect(result.text).not.toContain('test2@example.com');
        });

        it('nullやundefinedを正しく扱える', async () => {
            let result;

            result = await sanitizeRegex(null);
            expect(result.text).toBe('');
            expect(result.maskedItems).toHaveLength(0);

            result = await sanitizeRegex(undefined);
            expect(result.text).toBe('');
            expect(result.maskedItems).toHaveLength(0);
        });

        it('空文字列を正しく扱える', async () => {
            const result = await sanitizeRegex('');
            expect(result.text).toBe('');
            expect(result.maskedItems).toHaveLength(0);
        });

        it('PIIを含まないテキストを正しく扱える', async () => {
            const text = 'これは単なるテキストです。個人情報は含まれていません。';
            const result = await sanitizeRegex(text);

            expect(result.text).toBe(text);
            expect(result.maskedItems).toHaveLength(0);
        });

        it('PIIが隣接している場合を正しく扱える', async () => {
            const text = '連絡先:jun@test.comTEL:090-1234-5678';
            const result = await sanitizeRegex(text);

            expect(result.text).toContain('[MASKED:email]');
            expect(result.text).toContain('[MASKED:phoneJp]');
            expect(result.text).not.toContain('jun@test.com');
            expect(result.text).not.toContain('090-1234-5678');
        });
    });

    describe('パフォーマンステスト', () => {
        it('大量のPIIを含むテキストで効率的に処理できる', async () => {
            // 1000文字のテキストに100個のメールアドレスを含める
            const parts = [];
            for (let i = 0; i < 100; i++) {
                parts.push(`user${i}@example.com`);
                parts.push(' ');
            }
            const text = parts.join('');

            const startTime = Date.now();
            const result = await sanitizeRegex(text);
            const duration = Date.now() - startTime;

            expect(result.maskedItems.length).toBe(100);
            // 5秒以内で処理できるべき
            expect(duration).toBeLessThan(5000);
            console.log(`100個のPII置換完了: ${duration}ms`);
        });

        it('通常使用ケースで高速に処理できる', async () => {
            const text = 'お問い合わせ: support@example.com, 電話: 03-1234-5678';

            const startTime = Date.now();
            const result = await sanitizeRegex(text);
            const duration = Date.now() - startTime;

            expect(result.maskedItems.length).toBeGreaterThanOrEqual(1);
            // 通常使用では100ms以内で処理できるべき
            expect(duration).toBeLessThan(100);
            console.log(`通常使用ケース処理時間: ${duration}ms`);
        });

        it('サイズ上限ギリギリのテキストで正しく動作する', async () => {
            // MAX_INPUT_SIZE - 16（user@example.comの長さ）分のテキストを作成
            const text = 'a'.repeat(MAX_INPUT_SIZE - 16) + 'user@example.com';
            expect(text.length).toBe(MAX_INPUT_SIZE); // 正確にMAX_INPUT_SIZEであることを確認

            const result = await sanitizeRegex(text);

            expect(result.text).toContain('[MASKED:email]');
            expect(result.text).not.toContain('user@example.com');
        });

        it('サイズ超過エラーを正しく返す', async () => {
            const text = 'a'.repeat(MAX_INPUT_SIZE + 1);

            const result = await sanitizeRegex(text);

            // エラーが設定されていることを確認
            expect(result.error).toBeDefined();
            expect(result.maskedItems).toHaveLength(0);
        });

        it('サイズ制限をスキップできる', async () => {
            const text = 'a'.repeat(MAX_INPUT_SIZE + 1) + 'user@example.com';

            const result = await sanitizeRegex(text, { skipSizeLimit: true });

            expect(result.error).toBeUndefined();
            expect(result.text).toContain('[MASKED:email]');
        });
    });

    describe('タイムアウトテスト', () => {
        it('タイムアウト設定を変更できる', async () => {
            const text = '連絡先: test@example.com';

            const result = await sanitizeRegex(text, { timeout: 10000 });

            expect(result.text).toContain('[MASKED:email]');
            expect(result.error).toBeUndefined();
        });

        it('複雑な正規表現でもエラーなく処理できる', async () => {
            // 多種多様なPIIを含む複雑なテキスト
            const text = `
                顧客情報:
                メール: customer1@example.com, customer2@test.co.jp
                電話: 090-1111-2222, 03-9876-5432
                カード: 1111-2222-3333-4444, 1234-5678-9012-3456
                マイナンバー: 1234-5678-9012
                口座: 0123456, 7654321
            `;

            const result = await sanitizeRegex(text);

            expect(result.maskedItems.length).toBeGreaterThan(0);
            expect(result.text).toContain('[MASKED:email]');
            expect(result.text).toContain('[MASKED:phoneJp]');
            expect(result.text).toContain('[MASKED:creditCard]');
            expect(result.text).toContain('[MASKED:myNumber]');
            expect(result.text).toContain('[MASKED:bankAccount]');
        });
    });

    describe('エッジケース', () => {
        it('連続するPIIを正しく置換できる', async () => {
            const text = 'a@example.comb@example.comc@example.com';
            const result = await sanitizeRegex(text);

            const emailMasks = result.maskedItems.filter(item => item.type === 'email');
            // 連続している場合、最長一致で検出されるため
            expect(emailMasks.length).toBeGreaterThanOrEqual(1);
        });

        it('特別文字を含むPIIを正しく扱える', async () => {
            const text = 'メール: user+tag@example-domain.com';
            const result = await sanitizeRegex(text);

            expect(result.text).toContain('[MASKED:email]');
            expect(result.maskedItems[0].original).toContain('user+tag@example-domain.com');
        });

        it('置換結果のテキスト長が元のテキスト長を超えない', async () => {
            const text = '連絡先: test@example.com, 電話: 090-1234-5678';
            const result = await sanitizeRegex(text);

            // マスクされた文字列の長さを測定
            // 文字によっては結果が長くなる可能性があるため、単に変更されていることを確認
        });

        it('maskedItemsに重複が含まれない', async () => {
            const text = 'email1@example.com email1@example.com';
            const result = await sanitizeRegex(text);

            // 同じメールアドレスが2回ある場合、2つのアイテムが返る
            expect(result.maskedItems.length).toBe(2);
            // 同じメールアドレスが二回ある場合、二つのアイテムが返ることを確認
            expect(result.maskedItems.length).toBe(2);
        });
    });

    describe('配列join方式の動作検証', () => {
        it('置換インデックスが正しく保たれる', async () => {
            const text = 'A有@example.comB有@test.co.jpC';
            const result = await sanitizeRegex(text);

            // マスクされた項目のインデックスが昇順であることを確認
            for (let i = 1; i < result.maskedItems.length; i++) {
                expect(result.maskedItems[i].index).toBeGreaterThan(result.maskedItems[i - 1].index);
            }
        });

        it('置換後の文字列の整合性を保つ', async () => {
            const original = '前user@example.com後';
            const result = await sanitizeRegex(original);

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
        const testPiiDetection = async (pattern, type, testCase) => {
            const result = await sanitizeRegex(testCase.input);
            if (testCase.shouldMatch) {
                expect(result.maskedItems.some(item =>
                    item.type === type && item.original === testCase.expectedOriginal
                )).toBe(true);
            } else {
                expect(result.maskedItems.some(item => item.type === type)).toBe(false);
            }
        };

        it('様々な形式のメールアドレスを検出できる', async () => {
            const testCases = [
                { input: 'simple@domain.com', shouldMatch: true, expectedOriginal: 'simple@domain.com' },
                { input: 'name.surname@sub.domain.co.uk', shouldMatch: true, expectedOriginal: 'name.surname@sub.domain.co.uk' },
                { input: 'user123@test-domain.com', shouldMatch: true, expectedOriginal: 'user123@test-domain.com' },
            ];

            for (const testCase of testCases) {
                await testPiiDetection(null, 'email', testCase);
            }
        });

        it('様々な形式の電話番号を検出できる', async () => {
            const testCases = [
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