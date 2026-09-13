/**
 * tagUtils.test.ts
 * tagUtils.ts の単体テスト
 */

import {
    DEFAULT_CATEGORIES,
    getDefaultCategories,
    getAllCategories,
    isValidCategory,
    parseTagsFromSummary,
    normalizeTags,
    parseTagsForDisplay,
} from '../tagUtils.js';

describe('tagUtils', () => {

    describe('DEFAULT_CATEGORIES', () => {
        test('defines 10 categories', () => {
            expect(DEFAULT_CATEGORIES).toHaveLength(10);
        });

        test('defines every category as a string', () => {
            for (const cat of DEFAULT_CATEGORIES) {
                expect(typeof cat).toBe('string');
                expect(cat.length).toBeGreaterThan(0);
            }
        });
    });

    describe('getDefaultCategories', () => {
        test('returns TagCategory[] format', () => {
            const result = getDefaultCategories();
            expect(result).toHaveLength(10);
            for (const cat of result) {
                expect(cat.name).toBeDefined();
                expect(cat.isDefault).toBe(true);
                expect(cat.createdAt).toBeGreaterThan(0);
            }
        });

        test('includes every category name from DEFAULT_CATEGORIES', () => {
            const result = getDefaultCategories();
            const names = result.map(c => c.name);
            for (const name of DEFAULT_CATEGORIES) {
                expect(names).toContain(name);
            }
        });
    });

    describe('getAllCategories', () => {
        test('returns only default categories', () => {
            const settings = {};
            const result = getAllCategories(settings);
            expect(result).toHaveLength(10);
        });

        test('includes user-added categories', () => {
            const settings = {
                tag_categories: [
                    { name: 'Custom1', isDefault: false, createdAt: 0 },
                    { name: 'Custom2', isDefault: false, createdAt: 0 }
                ]
            };
            const result = getAllCategories(settings);
            expect(result).toHaveLength(12);
            expect(result).toContain('Custom1');
            expect(result).toContain('Custom2');
        });

        test('returns only defaults when tag_categories is undefined', () => {
            const settings = { tag_categories: undefined } as unknown as Parameters<typeof getAllCategories>[0];
            const result = getAllCategories(settings);
            expect(result).toHaveLength(10);
        });

        test('returns only defaults when tag_categories is an empty array', () => {
            const settings = { tag_categories: [] };
            const result = getAllCategories(settings);
            expect(result).toHaveLength(10);
        });

        test('includes user categories duplicating defaults (without dedupe)', () => {
            const settings = {
                tag_categories: [
                    { name: DEFAULT_CATEGORIES[0], isDefault: false, createdAt: 0 }
                ]
            };
            const result = getAllCategories(settings);
            expect(result).toHaveLength(11);
        });
    });

    describe('isValidCategory', () => {
        test('returns true for a default category', () => {
            expect(isValidCategory(DEFAULT_CATEGORIES[0], {})).toBe(true);
        });

        test('returns true for a user-added category', () => {
            const settings = {
                tag_categories: [{ name: 'MyCategory', isDefault: false, createdAt: 0 }]
            };
            expect(isValidCategory('MyCategory', settings)).toBe(true);
        });

        test('returns false for an unknown category', () => {
            expect(isValidCategory('NonExistent', {})).toBe(false);
        });

        test('returns false for an empty string', () => {
            expect(isValidCategory('', {})).toBe(false);
        });
    });

    describe('parseTagsFromSummary', () => {
        test('parses "#tag | summary" format', () => {
            const result = parseTagsFromSummary('#IT #Science | This is a summary');
            expect(result.tags).toEqual(['IT', 'Science']);
            expect(result.summary).toBe('This is a summary');
        });

        test('returns a summary without tags', () => {
            const result = parseTagsFromSummary('Just a summary without tags');
            expect(result.tags).toEqual([]);
            expect(result.summary).toBe('Just a summary without tags');
        });

        test('returns the full text without tags when there is no pipe', () => {
            const result = parseTagsFromSummary('#tag1 #tag2 but no pipe');
            expect(result.tags).toEqual([]);
            expect(result.summary).toBe('#tag1 #tag2 but no pipe');
        });

        test('removes duplicate tags', () => {
            const result = parseTagsFromSummary('#IT #IT #Science | Summary');
            expect(result.tags).toEqual(['IT', 'Science']);
        });

        test('handles tags-only input with an empty summary', () => {
            const result = parseTagsFromSummary('#tag1 | ');
            expect(result.tags).toEqual(['tag1']);
            expect(result.summary).toBe('');
        });

        test('splits at the first pipe when multiple pipes exist', () => {
            const result = parseTagsFromSummary('#tag1 | text | more text');
            expect(result.tags).toEqual(['tag1']);
            expect(result.summary).toBe('text | more text');
        });

        test('handles an empty string', () => {
            const result = parseTagsFromSummary('');
            expect(result.tags).toEqual([]);
            expect(result.summary).toBe('');
        });

        test('removes illustrative example lines from tag-less output', () => {
            // LLMがタグなしで例示テキストを混入するケース
            const llmOutput = 'ローカルLLMを利用した実験結果\n\n要約文（改行なし）\nLLMを用いた精度検証';
            const result = parseTagsFromSummary(llmOutput);
            expect(result.tags).toEqual([]);
            expect(result.summary).not.toContain('要約文（改行なし）');
            expect(result.summary).toContain('ローカルLLMを利用した実験結果');
        });

        test('removes a repeated prompt example line at the end of LLM output', () => {
            const llmOutput = '#IT・プログラミング | 要約文本文\n\n#カテゴリ1 #カテゴリ2 | 要約文（改行なし）';
            const result = parseTagsFromSummary(llmOutput);
            expect(result.summary).not.toContain('#カテゴリ1');
            expect(result.summary).not.toContain('要約文（改行なし）');
            expect(result.summary).toContain('要約文本文');
        });

        test('parses a multi-line LLM summary without newlines', () => {
            const llmOutput = '#IT・プログラミング | 一行目要約\n詳細説明\n追加情報';
            const result = parseTagsFromSummary(llmOutput);
            expect(result.tags).toContain('IT・プログラミング');
            expect(result.summary).toContain('一行目要約');
        });

        test('removes only the summary heading line and keeps the body when summaryPart has one', () => {
            // LLMが "要約文：\n詳細本文" を summaryPart に含めるケース
            const llmOutput = '#IT・プログラミング #インフラ・ネットワーク | 1行目要約\n\n要約文：\n詳細な本文がここに続く';
            const result = parseTagsFromSummary(llmOutput);
            expect(result.tags).toContain('IT・プログラミング');
            // 「要約文：」見出し行が summary に含まれない
            expect(result.summary).not.toContain('要約文：');
            // 詳細本文が含まれる
            expect(result.summary).toContain('詳細な本文がここに続く');
        });

        test('dedupes the first line and body when they are effectively identical', () => {
            // 実際に観測されたケース: LLMが1行目と同じ内容を "要約文：\n" の後に繰り返す
            const repeated = 'Artemis IIミッション中のOrionカプセルの問題について記述されている。';
            const llmOutput = `#IT・プログラミング #インフラ・ネットワーク | ${repeated}\n\n要約文：\n${repeated}`;
            const result = parseTagsFromSummary(llmOutput);
            expect(result.tags).toContain('IT・プログラミング');
            // 重複せず1回だけ含まれる
            const occurrences = (result.summary.match(new RegExp(repeated.substring(0, 20), 'g')) || []).length;
            expect(occurrences).toBe(1);
        });

        test('prefers the detailed body after the summary heading', () => {
            // 実際に観測されたケース: 1行目=短いタイトル的要約、「要約文：」以降=詳細な本文
            // 設計方針: 「\n\n要約文：\n」以降が存在する場合はそちらを採用（情報量が多い）
            const llmOutput = '#IT・プログラミング #インフラ・ネットワーク | 宇宙業界における小型ロケット開発と衛星輸送ビジネスの分析\n\n要約文：\nインターステラテクノロジズ社を中心とした宇宙ビジネスにおいて、大型ロケットと小型ロケットの輸送手段としての役割の違いが説明されている。';
            const result = parseTagsFromSummary(llmOutput);
            expect(result.tags).toContain('IT・プログラミング');
            expect(result.tags).toContain('インフラ・ネットワーク');
            // 「要約文：」以降の詳細本文を採用
            expect(result.summary).toContain('インターステラテクノロジズ');
            // 1行目の短い説明は採用しない
            expect(result.summary).not.toContain('宇宙業界における小型ロケット開発');
        });

        test('adopts the inline summary variant as the detailed body', () => {
            // 実際に観測されたケース: 「要約文：」でなく「要約：本文」がインラインで続く
            const llmOutput = '#インフラ・ネットワーク #ビジネス・経済 | イランでの米軍関係とエネルギー施設への攻撃について報じている。\n\n要約：イランでのF-15戦闘機の撃墜と米軍関係の救出作戦、さらにはホルムズ海峡の再開が記述されている。';
            const result = parseTagsFromSummary(llmOutput);
            expect(result.tags).toContain('インフラ・ネットワーク');
            expect(result.tags).toContain('ビジネス・経済');
            // 「要約：」以降のインライン本文を採用
            expect(result.summary).toContain('ホルムズ海峡');
            // 1行目の短い説明は採用しない
            expect(result.summary).not.toContain('イランでの米軍関係とエネルギー施設への攻撃について報じている');
        });

        test('adopts the first block when there is no summary heading', () => {
            // 「要約文：」見出しがなく直接要約が返る正常ケース
            const llmOutput = '#IT・プログラミング #インフラ・ネットワーク | 天体の自転周期や地球の回転周期といった物理現象を定義し計算する内容である。';
            const result = parseTagsFromSummary(llmOutput);
            expect(result.tags).toContain('IT・プログラミング');
            expect(result.summary).toBe('天体の自転周期や地球の回転周期といった物理現象を定義し計算する内容である。');
        });

        test('adopts the first block and removes prompt example lines when there is no summary heading', () => {
            // 「要約文：」見出しなし・複数ブロックのケース → 最初のブロック採用
            const llmOutput = [
                '#IT・プログラミング #インフラ・ネットワーク | 短い説明',
                '',
                '詳細な本文1。重要な情報が含まれる。',
                '',
                '#カテゴリ1 #カテゴリ2 | 要約文（改行なし）'
            ].join('\n');
            const result = parseTagsFromSummary(llmOutput);
            expect(result.tags).toContain('IT・プログラミング');
            // 「要約文：」がないので最初のブロック採用
            expect(result.summary).toBe('短い説明');
            expect(result.summary).not.toContain('要約文（改行なし）');
            expect(result.summary).not.toContain('#カテゴリ1');
        });
    });

    describe('normalizeTags', () => {
        test('leaves tags unchanged with an empty dictionary', () => {
            const tags = ['AI', '人工知能'];
            expect(normalizeTags(tags, [])).toEqual(['AI', '人工知能']);
        });

        test('returns empty for an empty tag array', () => {
            expect(normalizeTags([], [{ from: '人工知能', to: 'AI' }])).toEqual([]);
        });

        test('normalizes tags matching the dictionary', () => {
            const dict = [
                { from: '人工知能', to: 'AI' },
                { from: '機械学習', to: 'Machine Learning' },
            ];
            expect(normalizeTags(['人工知能', 'データサイエンス'], dict)).toEqual(['AI', 'データサイエンス']);
        });

        test('leaves tags not in the dictionary unchanged', () => {
            const dict = [{ from: '人工知能', to: 'AI' }];
            expect(normalizeTags(['データサイエンス', '機械学習'], dict)).toEqual(['データサイエンス', '機械学習']);
        });

        test('ignores case differences (NFKC normalization)', () => {
            const dict = [{ from: 'ai', to: 'Artificial Intelligence' }];
            expect(normalizeTags(['AI'], dict)).toEqual(['Artificial Intelligence']);
        });

        test('ignores full/half-width differences (NFKC normalization)', () => {
            const dict = [{ from: 'AI', to: '人工知能' }];
            expect(normalizeTags(['ＡＩ'], dict)).toEqual(['人工知能']);
        });

        test('trims surrounding whitespace before matching', () => {
            const dict = [{ from: 'AI', to: 'Artificial Intelligence' }];
            expect(normalizeTags(['  AI  '], dict)).toEqual(['Artificial Intelligence']);
        });

        test('applies the first matching entry when multiple entries match', () => {
            const dict = [
                { from: 'ML', to: 'Machine Learning' },
                { from: 'ML', to: '機械学習' },
            ];
            expect(normalizeTags(['ML'], dict)).toEqual(['Machine Learning']);
        });

        test('normalizes the "to" value in a single pass (without chained resolution)', () => {
            // 単一パス: "人工知能" → "AI" のみ。 "AI" → "Artificial Intelligence" は適用されない
            const dict = [
                { from: '人工知能', to: 'AI' },
                { from: 'AI', to: 'Artificial Intelligence' },
            ];
            expect(normalizeTags(['人工知能'], dict)).toEqual(['AI']);
        });
    });

    describe('parseTagsForDisplay', () => {
        test('returns an empty array for null', () => {
            expect(parseTagsForDisplay(null)).toEqual([]);
        });

        test('returns an empty array for undefined', () => {
            expect(parseTagsForDisplay(undefined)).toEqual([]);
        });

        test('returns an empty array for an empty string', () => {
            expect(parseTagsForDisplay('')).toEqual([]);
        });

        test('parses the #-tag (new) format', () => {
            expect(parseTagsForDisplay('#AI #機械学習')).toEqual(['AI', '機械学習']);
        });

        test('ignores leading spaces in the #-tag format', () => {
            expect(parseTagsForDisplay('  #AI  #機械学習')).toEqual(['AI', '機械学習']);
        });

        test('handles empty elements in the #-tag format', () => {
            expect(parseTagsForDisplay('#AI  ')).toEqual(['AI']);
        });

        test('falls back to parsing comma-separated (legacy) format', () => {
            expect(parseTagsForDisplay('AI, 機械学習')).toEqual(['AI', '機械学習']);
        });

        test('trims whitespace in comma-separated values', () => {
            expect(parseTagsForDisplay('AI , 機械学習')).toEqual(['AI', '機械学習']);
        });

        test('prefers the #-tag format when # is present (ignores commas)', () => {
            // "#" を含む行はスペース分割を優先。カンマ区切りは # がない場合のみフォールバック
            const result = parseTagsForDisplay('#AI, #機械学習');
            expect(result).toContain('機械学習');
            expect(result).not.toContain(''); // 空要素なし
        });
    });
});
