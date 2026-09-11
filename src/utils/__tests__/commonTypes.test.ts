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
