/**
 * piiSanitizeHybrid.test.ts
 * WASM + TS regex ハイブリッドPIIサニタイザーのテスト
 *
 * 【テスト対象】: src/background/pipeline/piiSanitizeHybrid.ts
 *
 * Node環境ではextension-context fetch(file://)が使えないため、WASM初期化に
 * 実際のfetchを使うテストは実行できない。ここでは主に「WASM初期化に失敗
 * した場合、TS regexのみへフォールバックし、PII保護が無効化されないこと」
 * を検証する — これがハイブリッド実装で最も壊れやすい/最も重大な経路。
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

// initPiiSanitizerWasm always fails in this Node test environment (no
// extension-page fetch(file://) support — see src/wasm/pii-sanitizer/bench.ts's
// same workaround), which is exactly the fallback path this suite verifies.
vi.mock('../../../wasm/pii-sanitizer/index.js', () => ({
    initPiiSanitizerWasm: vi.fn().mockRejectedValue(new Error('fetch not implemented in this environment')),
    sanitizePiiWithWasm: vi.fn(),
}));

describe('sanitizePiiHybrid', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    test('falls back to TS regex when WASM init fails, and still masks PII', async () => {
        const { sanitizePiiHybrid } = await import('../piiSanitizeHybrid.js');
        const result = await sanitizePiiHybrid('contact me at user@example.com');
        expect(result.text).toBe('contact me at [MASKED:email]');
        expect(result.maskedItems).toHaveLength(1);
        expect(result.maskedItems[0]?.type).toBe('email');
    });

    test('caches the WASM-unavailable result so init is not retried per call', async () => {
        const { sanitizePiiHybrid } = await import('../piiSanitizeHybrid.js');
        const wasmModule = await import('../../../wasm/pii-sanitizer/index.js');

        await sanitizePiiHybrid('first call user@example.com');
        await sanitizePiiHybrid('second call user2@example.com');

        // initPiiSanitizerWasm should only be probed once across both calls
        // — a permanently unavailable WASM module (e.g. CSP blocked) must
        // not re-attempt fetch/compile on every single sanitize call.
        expect(wasmModule.initPiiSanitizerWasm).toHaveBeenCalledTimes(1);
    });

    test('passes through sanitizeRegex options (e.g. includeIndices)', async () => {
        const { sanitizePiiHybrid } = await import('../piiSanitizeHybrid.js');
        const result = await sanitizePiiHybrid('email user@example.com here', { includeIndices: true });
        expect(result.maskedItems[0]).toHaveProperty('index');
    });

    test('empty/invalid input returns no masked items without throwing', async () => {
        const { sanitizePiiHybrid } = await import('../piiSanitizeHybrid.js');
        const result = await sanitizePiiHybrid('');
        expect(result.maskedItems).toEqual([]);
    });
});
