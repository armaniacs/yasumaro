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
        test('10個のカテゴリが定義されている', () => {
            expect(DEFAULT_CATEGORIES).toHaveLength(10);
        });

        test('すべてのカテゴリが文字列である', () => {
            for (const cat of DEFAULT_CATEGORIES) {
                expect(typeof cat).toBe('string');
                expect(cat.length).toBeGreaterThan(0);
            }
        });
    });

    describe('getDefaultCategories', () => {
        test('TagCategory[] 形式で返す', () => {
            const result = getDefaultCategories();
            expect(result).toHaveLength(10);
            for (const cat of result) {
                expect(cat.name).toBeDefined();
                expect(cat.isDefault).toBe(true);
                expect(cat.createdAt).toBeGreaterThan(0);
            }
        });

        test('DEFAULT_CATEGORIES の各カテゴリ名を含む', () => {
            const result = getDefaultCategories();
            const names = result.map(c => c.name);
            for (const name of DEFAULT_CATEGORIES) {
                expect(names).toContain(name);
            }
        });
    });

    describe('getAllCategories', () => {
        test('デフォルトカテゴリのみの場合', () => {
            const settings = {};
            const result = getAllCategories(settings);
            expect(result).toHaveLength(10);
        });

        test('ユーザー追加カテゴリを含む', () => {
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

        test('tag_categories が undefined の場合はデフォルトのみ', () => {
            const settings = { tag_categories: undefined };
            const result = getAllCategories(settings);
            expect(result).toHaveLength(10);
        });

        test('tag_categories が空配列の場合', () => {
            const settings = { tag_categories: [] };
            const result = getAllCategories(settings);
            expect(result).toHaveLength(10);
        });

        test('デフォルトと重複するユーザーカテゴリも含む（重複除去なし）', () => {
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
        test('デフォルトカテゴリで true', () => {
            expect(isValidCategory(DEFAULT_CATEGORIES[0], {})).toBe(true);
        });

        test('ユーザー追加カテゴリで true', () => {
            const settings = {
                tag_categories: [{ name: 'MyCategory', isDefault: false, createdAt: 0 }]
            };
            expect(isValidCategory('MyCategory', settings)).toBe(true);
        });

        test('存在しないカテゴリで false', () => {
            expect(isValidCategory('NonExistent', {})).toBe(false);
        });

        test('空文字で false', () => {
            expect(isValidCategory('', {})).toBe(false);
        });
    });

    describe('parseTagsFromSummary', () => {
        test('#tag | summary 形式をパースする', () => {
            const result = parseTagsFromSummary('#IT #Science | This is a summary');
            expect(result.tags).toEqual(['IT', 'Science']);
            expect(result.summary).toBe('This is a summary');
        });

        test('タグなしの summary を返す', () => {
            const result = parseTagsFromSummary('Just a summary without tags');
            expect(result.tags).toEqual([]);
            expect(result.summary).toBe('Just a summary without tags');
        });

        test('パイプなしの場合はタグなしで全文を返す', () => {
            const result = parseTagsFromSummary('#tag1 #tag2 but no pipe');
            expect(result.tags).toEqual([]);
            expect(result.summary).toBe('#tag1 #tag2 but no pipe');
        });

        test('重複タグを除去する', () => {
            const result = parseTagsFromSummary('#IT #IT #Science | Summary');
            expect(result.tags).toEqual(['IT', 'Science']);
        });

        test('タグのみで summary が空の場合', () => {
            const result = parseTagsFromSummary('#tag1 | ');
            expect(result.tags).toEqual(['tag1']);
            expect(result.summary).toBe('');
        });

        test('複数のパイプがある場合は最初のパイプで分割する', () => {
            const result = parseTagsFromSummary('#tag1 | text | more text');
            expect(result.tags).toEqual(['tag1']);
            expect(result.summary).toBe('text | more text');
        });

        test('空文字列の場合', () => {
            const result = parseTagsFromSummary('');
            expect(result.tags).toEqual([]);
            expect(result.summary).toBe('');
        });

        test('タグなし出力でも "要約文（改行なし）" 例示テキストを除去する', () => {
            // LLMがタグなしで例示テキストを混入するケース
            const llmOutput = 'ローカルLLMを利用した実験結果\n\n要約文（改行なし）\nLLMを用いた精度検証';
            const result = parseTagsFromSummary(llmOutput);
            expect(result.tags).toEqual([]);
            expect(result.summary).not.toContain('要約文（改行なし）');
            expect(result.summary).toContain('ローカルLLMを利用した実験結果');
        });

        test('LLMがプロンプト例示行を末尾に繰り返した場合、除去する', () => {
            const llmOutput = '#IT・プログラミング | 要約文本文\n\n#カテゴリ1 #カテゴリ2 | 要約文（改行なし）';
            const result = parseTagsFromSummary(llmOutput);
            expect(result.summary).not.toContain('#カテゴリ1');
            expect(result.summary).not.toContain('要約文（改行なし）');
            expect(result.summary).toContain('要約文本文');
        });

        test('LLMが複数行にまたがる要約を返した場合、改行を含まずパースする', () => {
            const llmOutput = '#IT・プログラミング | 一行目要約\n詳細説明\n追加情報';
            const result = parseTagsFromSummary(llmOutput);
            expect(result.tags).toContain('IT・プログラミング');
            expect(result.summary).toContain('一行目要約');
        });

        test('summaryPart に "要約文：" 見出し行がある場合、見出し行のみ除去して本文は保持する', () => {
            // LLMが "要約文：\n詳細本文" を summaryPart に含めるケース
            const llmOutput = '#IT・プログラミング #インフラ・ネットワーク | 1行目要約\n\n要約文：\n詳細な本文がここに続く';
            const result = parseTagsFromSummary(llmOutput);
            expect(result.tags).toContain('IT・プログラミング');
            // 「要約文：」見出し行が summary に含まれない
            expect(result.summary).not.toContain('要約文：');
            // 詳細本文が含まれる
            expect(result.summary).toContain('詳細な本文がここに続く');
        });

        test('1行目と詳細本文が実質同じ内容（重複）の場合、重複を除去する', () => {
            // 実際に観測されたケース: LLMが1行目と同じ内容を "要約文：\n" の後に繰り返す
            const repeated = 'Artemis IIミッション中のOrionカプセルの問題について記述されている。';
            const llmOutput = `#IT・プログラミング #インフラ・ネットワーク | ${repeated}\n\n要約文：\n${repeated}`;
            const result = parseTagsFromSummary(llmOutput);
            expect(result.tags).toContain('IT・プログラミング');
            // 重複せず1回だけ含まれる
            const occurrences = (result.summary.match(new RegExp(repeated.substring(0, 20), 'g')) || []).length;
            expect(occurrences).toBe(1);
        });

        test('「要約文：」以降の詳細本文を優先して採用する', () => {
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

        test('「要約：」（「文」なし・インライン）形式も詳細本文として採用する', () => {
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

        test('「要約文：」がない場合は最初のブロックを採用する', () => {
            // 「要約文：」見出しがなく直接要約が返る正常ケース
            const llmOutput = '#IT・プログラミング #インフラ・ネットワーク | 天体の自転周期や地球の回転周期といった物理現象を定義し計算する内容である。';
            const result = parseTagsFromSummary(llmOutput);
            expect(result.tags).toContain('IT・プログラミング');
            expect(result.summary).toBe('天体の自転周期や地球の回転周期といった物理現象を定義し計算する内容である。');
        });

        test('「要約文：」がなく複数ブロックある場合、最初のブロックを採用しプロンプト例示行は除去する', () => {
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
        test('空の辞書ではタグが変更されない', () => {
            const tags = ['AI', '人工知能'];
            expect(normalizeTags(tags, [])).toEqual(['AI', '人工知能']);
        });

        test('空のタグ配列では空のまま', () => {
            expect(normalizeTags([], [{ from: '人工知能', to: 'AI' }])).toEqual([]);
        });

        test('辞書に一致するタグを正規化する', () => {
            const dict = [
                { from: '人工知能', to: 'AI' },
                { from: '機械学習', to: 'Machine Learning' },
            ];
            expect(normalizeTags(['人工知能', 'データサイエンス'], dict)).toEqual(['AI', 'データサイエンス']);
        });

        test('辞書にないタグはそのまま', () => {
            const dict = [{ from: '人工知能', to: 'AI' }];
            expect(normalizeTags(['データサイエンス', '機械学習'], dict)).toEqual(['データサイエンス', '機械学習']);
        });

        test('大文字小文字の違いを吸収する（NFKC正規化）', () => {
            const dict = [{ from: 'ai', to: 'Artificial Intelligence' }];
            expect(normalizeTags(['AI'], dict)).toEqual(['Artificial Intelligence']);
        });

        test('全角半角の違いを吸収する（NFKC正規化）', () => {
            const dict = [{ from: 'AI', to: '人工知能' }];
            expect(normalizeTags(['ＡＩ'], dict)).toEqual(['人工知能']);
        });

        test('前後の空白を除去してマッチングする', () => {
            const dict = [{ from: 'AI', to: 'Artificial Intelligence' }];
            expect(normalizeTags(['  AI  '], dict)).toEqual(['Artificial Intelligence']);
        });

        test('複数のエントリがある場合、最初に一致したものを適用する', () => {
            const dict = [
                { from: 'ML', to: 'Machine Learning' },
                { from: 'ML', to: '機械学習' },
            ];
            expect(normalizeTags(['ML'], dict)).toEqual(['Machine Learning']);
        });

        test('to の値も正規化されうる（連鎖解決はしない）', () => {
            // 単一パス: "人工知能" → "AI" のみ。 "AI" → "Artificial Intelligence" は適用されない
            const dict = [
                { from: '人工知能', to: 'AI' },
                { from: 'AI', to: 'Artificial Intelligence' },
            ];
            expect(normalizeTags(['人工知能'], dict)).toEqual(['AI']);
        });
    });

    describe('parseTagsForDisplay', () => {
        test('null の場合は空配列を返す', () => {
            expect(parseTagsForDisplay(null)).toEqual([]);
        });

        test('undefined の場合は空配列を返す', () => {
            expect(parseTagsForDisplay(undefined)).toEqual([]);
        });

        test('空文字列の場合は空配列を返す', () => {
            expect(parseTagsForDisplay('')).toEqual([]);
        });

        test('# 形式（新形式）をパースする', () => {
            expect(parseTagsForDisplay('#AI #機械学習')).toEqual(['AI', '機械学習']);
        });

        test('# 形式の先頭スペースを無視する', () => {
            expect(parseTagsForDisplay('  #AI  #機械学習')).toEqual(['AI', '機械学習']);
        });

        test('# 形式が空要素の場合も正しく処理する', () => {
            expect(parseTagsForDisplay('#AI  ')).toEqual(['AI']);
        });

        test('カンマ区切り（旧形式/移行済み）をフォールバックパースする', () => {
            expect(parseTagsForDisplay('AI, 機械学習')).toEqual(['AI', '機械学習']);
        });

        test('カンマ区切りの空白トリム', () => {
            expect(parseTagsForDisplay('AI , 機械学習')).toEqual(['AI', '機械学習']);
        });

        test('# が含まれる場合は # 形式を優先（カンマは考慮しない）', () => {
            // "#" を含む行はスペース分割を優先。カンマ区切りは # がない場合のみフォールバック
            const result = parseTagsForDisplay('#AI, #機械学習');
            expect(result).toContain('機械学習');
            expect(result).not.toContain(''); // 空要素なし
        });
    });
});
