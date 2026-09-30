/**
 * commonTypes.ts のテスト
 *
 * テスト対象:
 * - RecordType / AiSummaryCleansedReason の値が正しい文字列リテラルであること
 * - commonTypes.ts が単一定義元として機能し、storageUrls.ts / messaging/types.ts
 *   が同じ型を import していること（重複定義の回帰防止）
 */



// 実際の型を使って値の割り当てが通ることをコンパイル時に保証しつつ、
// 実行時に正しい文字列リテラルの集合であることを検証する
import type { RecordType, AiSummaryCleansedReason } from '../commonTypes.js';
import { buildRemovedCounts, readRemovedCounts } from '../commonTypes.js';
import type { ContentResponse } from '../../messaging/types.js';

describe('commonTypes: RecordType', () => {
    it("'auto' is a valid RecordType", () => {
        const value: RecordType = 'auto';
        expect(value).toBe('auto');
    });

    it("'manual' is a valid RecordType", () => {
        const value: RecordType = 'manual';
        expect(value).toBe('manual');
    });

    it('allows only auto and manual as valid RecordType values', () => {
        const validValues: RecordType[] = ['auto', 'manual'];
        expect(validValues).toHaveLength(2);
        expect(validValues).toContain('auto');
        expect(validValues).toContain('manual');
    });
});

describe('commonTypes: AiSummaryCleansedReason', () => {
    const allReasons: AiSummaryCleansedReason[] = [
        'alt', 'metadata', 'ads', 'nav', 'social', 'deep', 'multiple', 'none',
    ];

    it('defines all 8 values', () => {
        expect(allReasons).toHaveLength(8);
    });

    it.each(allReasons)("'%s' is a valid AiSummaryCleansedReason", (reason) => {
        const value: AiSummaryCleansedReason = reason;
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
    });
});

describe('commonTypes: buildRemovedCounts', () => {
    const aiStats = (overrides: Partial<NonNullable<ContentResponse['aiSummaryCleansedStats']>> = {}) => ({
        aiSummaryOriginalBytes: 31204,
        aiSummaryCleansedBytes: 21000,
        aiSummaryCleansedElements: 12,
        aiSummaryCleansedReason: 'ads' as AiSummaryCleansedReason,
        ...overrides,
    });

    const counts = (overrides: Partial<NonNullable<ContentResponse['cleanseStats']>> = {}) => ({
        hardStripRemoved: 4,
        keywordStripRemoved: 2,
        totalRemoved: 6,
        ...overrides,
    });

    it('counts only: keeps the count map and adds no aiSummary group', () => {
        const result = buildRemovedCounts(counts());
        expect(result.byReason).toEqual({ hardStripRemoved: 4, keywordStripRemoved: 2, totalRemoved: 6 });
        expect(result.aiSummary).toBeUndefined();
    });

    it('aiSummary only: keeps byte totals and reasons out of the count map', () => {
        const result = buildRemovedCounts(undefined, aiStats());
        expect(result.byReason).toEqual({});
        expect(result.aiSummary).toEqual({
            reason: 'ads',
            elements: 12,
            originalBytes: 31204,
            cleansedBytes: 21000,
        });
        expect(Object.keys(result.byReason)).toHaveLength(0);
    });

    it('both: neither side overwrites the other', () => {
        const result = buildRemovedCounts(counts(), aiStats({ aiSummaryCleansedReason: 'multiple' }));
        expect(result.byReason).toEqual({ hardStripRemoved: 4, keywordStripRemoved: 2, totalRemoved: 6 });
        expect(result.aiSummary).toMatchObject({ reason: 'multiple', originalBytes: 31204, cleansedBytes: 21000 });
    });

    it('neither: an empty entry, no exception', () => {
        const result = buildRemovedCounts(undefined, undefined);
        expect(result).toEqual({ byReason: {} });
    });

    it('reason array: copied, not shared with the response object', () => {
        const response = aiStats({ aiSummaryCleansedReasons: ['ads', 'nav'] });
        const result = buildRemovedCounts(undefined, response);
        expect(result.aiSummary?.reasons).toEqual(['ads', 'nav']);
        response.aiSummaryCleansedReasons?.push('card');
        expect(result.aiSummary?.reasons).toEqual(['ads', 'nav']);
    });

    it('reason array: omitted when the response has none', () => {
        const result = buildRemovedCounts(undefined, aiStats());
        expect(result.aiSummary).not.toHaveProperty('reasons');
    });
});

describe('commonTypes: readRemovedCounts', () => {
    it('routes the wire aiSummary* keys out of the count map', () => {
        const result = readRemovedCounts({
            keyword: 1,
            aiSummaryOriginalBytes: 31204,
            aiSummaryCleansedBytes: 21000,
            aiSummaryCleansedElements: 12,
            aiSummaryCleansedReason: 'multiple',
            aiSummaryCleansedReasons: ['ads', 'nav'],
        });
        expect(result.byReason).toEqual({ keyword: 1 });
        expect(result.aiSummary).toEqual({
            reason: 'multiple',
            reasons: ['ads', 'nav'],
            elements: 12,
            originalBytes: 31204,
            cleansedBytes: 21000,
        });
    });

    it('has no aiSummary group when the record holds counts only', () => {
        const result = readRemovedCounts({ keyword: 1, hardStripRemoved: 3 });
        expect(result).toEqual({ byReason: { keyword: 1, hardStripRemoved: 3 } });
    });

    it('drops non-numeric leftovers from the count map', () => {
        const result = readRemovedCounts({ keyword: 1, broken: Number.NaN, note: 'n/a' });
        expect(result.byReason).toEqual({ keyword: 1 });
        expect(result.aiSummary).toBeUndefined();
    });

    it('reads a partial aiSummary record without throwing', () => {
        const result = readRemovedCounts({ aiSummaryCleansedElements: 5 });
        expect(result.byReason).toEqual({});
        expect(result.aiSummary).toEqual({ reason: 'none', elements: 5, originalBytes: 0, cleansedBytes: 0 });
    });

    it('ignores a malformed reason array', () => {
        const result = readRemovedCounts({ aiSummaryCleansedReason: 'ads', aiSummaryCleansedReasons: 'nav' });
        expect(result.aiSummary?.reason).toBe('ads');
        expect(result.aiSummary?.reasons).toBeUndefined();
    });
});

describe('commonTypes: 単一定義元の回帰防止', () => {
    it('imports RecordType from commonTypes in urlEntry.ts', async () => {
        // urlEntry.ts が commonTypes をインポートしていることを確認
        const fs = await import('fs');
        const path = await import('path');
        const urlEntryPath = path.resolve(
            process.cwd(),
            'src/utils/urlEntry.ts'
        );
        const urlEntrySource = fs.readFileSync(urlEntryPath, 'utf-8');
        expect(urlEntrySource).toMatch(/from ['"].*commonTypes\.js['"]/);
        expect(urlEntrySource).toContain('RecordType');
    });

    it('re-exports SavedUrlEntry from urlEntry.js in storageUrls.ts', async () => {
        // storageUrls.ts はバレルファイル（分割後のエクスポート集約）として機能
        // RecordTypeはurlEntry.tsから再エクスポートされる
        const fs = await import('fs');
        const path = await import('path');
        const storageUrlsPath = path.resolve(
            process.cwd(),
            'src/utils/storageUrls.ts'
        );
        const storageUrlsSource = fs.readFileSync(storageUrlsPath, 'utf-8');
        expect(storageUrlsSource).toContain('./urlEntry.js');
        expect(storageUrlsSource).toContain('SavedUrlEntry');
    });

    it('imports RecordType from commonTypes in messaging/types.ts', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const filePath = path.resolve(
            process.cwd(),
            'src/messaging/types.ts'
        );
        const source = fs.readFileSync(filePath, 'utf-8');
        expect(source).toMatch(/from ['"].*commonTypes\.js['"]/);
        expect(source).toContain('RecordType');
    });

    it('defines no local RecordType in storageUrls.ts', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const filePath = path.resolve(
            process.cwd(),
            'src/utils/storageUrls.ts'
        );
        const source = fs.readFileSync(filePath, 'utf-8');
        // type RecordType = ... という独自定義がないこと
        expect(source).not.toMatch(/^type RecordType\s*=/m);
        expect(source).not.toMatch(/^export type RecordType\s*=/m);
    });

    it('defines no local RecordType in messaging/types.ts', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const filePath = path.resolve(
            process.cwd(),
            'src/messaging/types.ts'
        );
        const source = fs.readFileSync(filePath, 'utf-8');
        expect(source).not.toMatch(/^type RecordType\s*=/m);
        expect(source).not.toMatch(/^export type RecordType\s*=/m);
    });
});
