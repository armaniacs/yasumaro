/**
 * tagUtils.test.ts
 * tagUtils.ts の単体テスト
 */

import {
    DEFAULT_CATEGORIES,
    getDefaultCategories,
    getAllCategories,
    isValidCategory,
    parseTagsFromSummary
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
    });
});
