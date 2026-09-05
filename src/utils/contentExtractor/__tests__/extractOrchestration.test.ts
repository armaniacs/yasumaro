// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { extractMainContentWithInfo } from '../index.js';
import { resolveCleanseReason } from '../cleansedReason.js';

beforeEach(() => {
    document.body.innerHTML = '';
});

// ─────────────────────────────────────────────
// resolveCleanseReason — 3箇所の if/else 連鎖の単一化身 (PBI 13)
// ─────────────────────────────────────────────
describe('resolveCleanseReason', () => {
    it('returns both when hard and keyword removals exist', () => {
        expect(resolveCleanseReason(2, 3)).toBe('both');
    });

    it('returns hard when only hard-strip removals exist', () => {
        expect(resolveCleanseReason(1, 0)).toBe('hard');
    });

    it('returns keyword when only keyword-strip removals exist', () => {
        expect(resolveCleanseReason(0, 4)).toBe('keyword');
    });

    it('returns none when nothing was removed', () => {
        expect(resolveCleanseReason(0, 0)).toBe('none');
    });
});

// ─────────────────────────────────────────────
// Drift detection: candidate path と body path の統計対応 (PBI 13)
// 同一のクレンジング入力（hard-strip 対象の script 要素1件＋100字超の本文）
// を両 path に与え、hardStripRemoved / keywordStripRemoved / totalRemoved /
// cleansedReason / cleansingExecuted が同じ規則で算出されることを担保する。
// 将来 runCleanseAndExtract の片 path だけが変わるとここが落ちる。
// ─────────────────────────────────────────────
describe('extract orchestration drift detection', () => {
    const LONG_TEXT = 'The quick brown fox jumps over the lazy dog. '.repeat(10);
    const CLEANSE_OPTIONS = { cleanseEnabled: true, hardStripEnabled: true } as const;

    const statsOf = (result: Record<string, unknown>) => ({
        hardStripRemoved: result['hardStripRemoved'],
        keywordStripRemoved: result['keywordStripRemoved'],
        totalRemoved: result['totalRemoved'],
        cleansedReason: result['cleansedReason'],
        cleansingExecuted: result['cleansingExecuted'],
    });

    it('candidate path removes the script target and reports hard stats', () => {
        document.body.innerHTML = `<article><p>${LONG_TEXT}</p><script>var x = 1;</script></article>`;
        const result = extractMainContentWithInfo(10000, { ...CLEANSE_OPTIONS }) as unknown as Record<string, unknown>;
        // candidate path に乗ったことの確認（候補バイトが計測される）
        expect(result['candidateBytes']).toBeGreaterThan(0);
        expect(statsOf(result)).toEqual({
            hardStripRemoved: 1,
            keywordStripRemoved: 0,
            totalRemoved: 1,
            cleansedReason: 'hard',
            cleansingExecuted: true,
        });
    });

    it('body path removes the same script target and reports identical stats', () => {
        // script 直下のみ＝候補なし → body path（script は除外要素のため候補にならない）
        document.body.innerHTML = `${LONG_TEXT}<script>var x = 1;</script>`;
        const result = extractMainContentWithInfo(10000, { ...CLEANSE_OPTIONS }) as unknown as Record<string, unknown>;
        // body path に乗ったことの確認（候補バイトは計測されない）
        expect(result['candidateBytes'] ?? 0).toBe(0);
        expect(statsOf(result)).toEqual({
            hardStripRemoved: 1,
            keywordStripRemoved: 0,
            totalRemoved: 1,
            cleansedReason: 'hard',
            cleansingExecuted: true,
        });
    });
});
