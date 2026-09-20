/**
 * contentDedupHybrid.test.ts
 * WASM初期化に失敗する環境（Node/test）でのフォールバック経路と、
 * WASMを呼ばない早期リターンの契約を検証する。
 *
 * WASMが正常に初期化される経路は contentDedupHybrid.wasm-success.test.ts
 * （piiSanitizeHybrid.test.ts / piiSanitizeHybrid.wasm-success.test.ts の
 * 二分パターンと同じ分割）。
 */

import { describe, test, expect, vi } from 'vitest';
import { deduplicateContent } from '../contentDeduplicator.js';

describe('deduplicateContentHybrid (WASM unavailable in test env)', () => {
    test('falls back to the TS implementation when WASM init fails', async () => {
        const { deduplicateContentHybrid } = await import('../contentDedupHybrid.js');
        const input = 'alpha beta gamma. alpha beta gamma. delta epsilon zeta.';
        const result = await deduplicateContentHybrid(input);
        expect(result).toBe(deduplicateContent(input));
    });

    test('empty and whitespace-only inputs return unchanged without touching WASM', async () => {
        const { deduplicateContentHybrid } = await import('../contentDedupHybrid.js');
        expect(await deduplicateContentHybrid('')).toBe('');
        expect(await deduplicateContentHybrid('   ')).toBe('   ');
    });

    test('threshold 0 returns the text unchanged (TS early-return parity)', async () => {
        const { deduplicateContentHybrid } = await import('../contentDedupHybrid.js');
        const input = 'same. same. same.';
        expect(await deduplicateContentHybrid(input, { threshold: 0 })).toBe(input);
    });

    test('out-of-domain options bypass WASM and take the TS path', async () => {
        // NaN threshold / fractional minLength would wrap or truncate at the
        // JS->wasm numeric boundary; the TS reference defines their behavior,
        // so the hybrid must route them to the TS path.
        const { deduplicateContentHybrid } = await import('../contentDedupHybrid.js');
        const input = 'one two three. one two three. four five six.';
        expect(await deduplicateContentHybrid(input, { threshold: Number.NaN })).toBe(
            deduplicateContent(input, { threshold: Number.NaN })
        );
        expect(await deduplicateContentHybrid(input, { minLength: 1.5 })).toBe(
            deduplicateContent(input, { minLength: 1.5 })
        );
        expect(await deduplicateContentHybrid(input, { minLength: -1 })).toBe(
            deduplicateContent(input, { minLength: -1 })
        );
    });

    test('a WASM runtime failure on one input falls back to TS for that input', async () => {
        vi.resetModules();
        vi.doMock('../../wasm/sentence-dedup/index.js', () => ({
            initSentenceDedupWasm: vi.fn().mockResolvedValue(undefined),
            deduplicateIndicesWithWasm: vi.fn().mockRejectedValue(new Error('wasm boom')),
        }));
        try {
            const { deduplicateContentHybrid } = await import('../contentDedupHybrid.js');
            const input = 'alpha beta gamma. alpha beta gamma. delta epsilon zeta.';
            const result = await deduplicateContentHybrid(input);
            expect(result).toBe(deduplicateContent(input));
        } finally {
            vi.doUnmock('../../wasm/sentence-dedup/index.js');
            vi.resetModules();
        }
    });
});
