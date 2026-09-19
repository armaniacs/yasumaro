/**
 * piiSanitizeHybrid.wasm-success.test.ts
 * WASMが正常に初期化・動作する経路（単一パスのWASM結果）を検証する。
 *
 * piiSanitizeHybrid.test.ts はWASM初期化失敗時のフォールバック経路を
 * 検証するのに対し、このファイルは Node のfile読み込みでWASM初期化を
 * 成功させ、全21パターンがWASM単一パスでマスクされることを検証する。
 * (c8ベンチマークの結果、TS regexの常時二重パスは削除済み — 
 * piiSanitizeHybrid.ts のモジュールドキュメント参照)
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, test, expect, vi, beforeAll } from 'vitest';
import initWasmModule from '../../../wasm/pii-sanitizer/piiSanitizerWasm.js';

vi.mock('../../../wasm/pii-sanitizer/index.js', async () => {
    const wasmPath = fileURLToPath(
        new URL('../../../wasm/pii-sanitizer/pii_sanitizer_bg.wasm', import.meta.url)
    );
    let initPromise: Promise<void> | null = null;

    async function initPiiSanitizerWasm(): Promise<void> {
        if (!initPromise) {
            initPromise = readFile(wasmPath).then(async (bytes) => {
                await initWasmModule({ module_or_path: bytes });
            });
        }
        return initPromise;
    }

    const { sanitizePii } = await import('../../../wasm/pii-sanitizer/piiSanitizerWasm.js');

    return {
        initPiiSanitizerWasm,
        sanitizePiiWithWasm: async (text: string) => {
            await initPiiSanitizerWasm();
            return sanitizePii(text) as { text: string; maskedItems: { type: string; original: string; index: number }[] };
        },
    };
});

describe('sanitizePiiHybrid (WASM available)', () => {
    beforeAll(async () => {
        // Warm the mocked WASM module before the suite runs.
        const { initPiiSanitizerWasm } = await import('../../../wasm/pii-sanitizer/index.js');
        await initPiiSanitizerWasm();
    });

    test('masks a WASM-covered pattern (email) via the WASM path', async () => {
        const { sanitizePiiHybrid } = await import('../piiSanitizeHybrid.js');
        const result = await sanitizePiiHybrid('contact user@example.com now');
        expect(result.text).toBe('contact [MASKED:email] now');
        expect(result.maskedItems.map((m) => m.type)).toEqual(['email']);
    });

    test('masks a locale-specific pattern (ssn) via the WASM path', async () => {
        const { sanitizePiiHybrid } = await import('../piiSanitizeHybrid.js');
        const result = await sanitizePiiHybrid('ssn is 123-45-6789 on file');
        expect(result.text).toBe('ssn is [MASKED:ssn] on file');
        expect(result.maskedItems.map((m) => m.type)).toEqual(['ssn']);
    });

    test('masks WASM-covered patterns from a single input', async () => {
        const { sanitizePiiHybrid } = await import('../piiSanitizeHybrid.js');
        const result = await sanitizePiiHybrid('email user@example.com and ssn 123-45-6789 together');
        const types = result.maskedItems.map((m) => m.type).sort();
        expect(types).toEqual(['email', 'ssn']);
        expect(result.text).toContain('[MASKED:email]');
        expect(result.text).toContain('[MASKED:ssn]');
    });

    test('the masked output shape is stable for adjacent same-type matches', async () => {
        // Pin for the placeholder contract in piiSanitizeHybrid.ts's module
        // doc: "[MASKED:email]" contains no digits/'@' that any of the 21
        // patterns require, so re-sanitizing already-masked text is a no-op.
        const { sanitizePiiHybrid } = await import('../piiSanitizeHybrid.js');
        const result = await sanitizePiiHybrid('user@example.com user2@example.com');
        expect(result.maskedItems).toHaveLength(2);
        expect(result.text).toBe('[MASKED:email] [MASKED:email]');
    });

    test('oversized input still masks and reports the sanitizeRegex size error', async () => {
        // Contract pin for sizeLimitError(): sanitizeRegex would reject a
        // >64KB input with an `error` field; the WASM path must report the
        // same error WITHOUT skipping masking (the two-pass revision it
        // replaced also delivered masked text alongside the error).
        const { sanitizePiiHybrid } = await import('../piiSanitizeHybrid.js');
        const oversized = `${'filler '.repeat(70_000 / 7)}contact user@example.com end`;
        expect(oversized.length).toBeGreaterThan(64 * 1024);

        const result = await sanitizePiiHybrid(oversized);
        expect(result.error).toContain('Input size exceeds maximum limit of 65536');
        expect(result.maskedItems.map((m) => m.type)).toEqual(['email']);
        expect(result.text).toContain('[MASKED:email]');
        expect(result.text).not.toContain('user@example.com');
    });

    test('skipSizeLimit inputs between 64KB and 512KB mask without an error', async () => {
        const { sanitizePiiHybrid } = await import('../piiSanitizeHybrid.js');
        const big = `${'filler '.repeat(100_000 / 7)}contact user@example.com end`;
        expect(big.length).toBeGreaterThan(64 * 1024);

        const result = await sanitizePiiHybrid(big, { skipSizeLimit: true });
        expect(result.error).toBeUndefined();
        expect(result.maskedItems.map((m) => m.type)).toEqual(['email']);
    });

    test('skipSizeLimit inputs over 512KB report the hard-cap error', async () => {
        const { sanitizePiiHybrid } = await import('../piiSanitizeHybrid.js');
        const huge = `${'filler '.repeat(75_000)}contact user@example.com end`;
        expect(huge.length).toBeGreaterThan(512 * 1024);

        const result = await sanitizePiiHybrid(huge, { skipSizeLimit: true });
        expect(result.error).toContain('even with skipSizeLimit');
        expect(result.maskedItems.map((m) => m.type)).toEqual(['email']);
    });

    test('match-count overflow fails closed via the TS fallback throwing', async () => {
        // The WASM core rejects with the TS match-cap message when an input
        // yields more than 1000 matches; the hybrid falls back to
        // sanitizeRegex, which throws the same way — the recording aborts
        // instead of shipping partially-masked text (pre-WASM behavior).
        const { sanitizePiiHybrid } = await import('../piiSanitizeHybrid.js');
        const text = 'account 1234567\n'.repeat(1001);

        await expect(sanitizePiiHybrid(text)).rejects.toThrow(/maximum match count/);
    });

    test('output larger than 128KB is truncated with the sanitizeRegex error', async () => {
        // Contract pin: sanitizeRegex truncates masked output over
        // MAX_OUTPUT_SIZE (128KB) and reports it; the WASM path reproduces
        // that instead of shipping unbounded text.
        //
        // Reachability: without skipSizeLimit the output caps out around
        // 64KB input + 13KB max expansion (1000 matches x 13 chars for
        // bankAccount), under 128KB — the match-count cap fires first. So
        // the truncation path needs skipSizeLimit plus an input over ~115KB
        // holding at most 1000 matches.
        const { sanitizePiiHybrid } = await import('../piiSanitizeHybrid.js');
        const dense = `${'account 1234567\n'.repeat(1000)}${'filler '.repeat(15_000)}`;
        expect(dense.length).toBeGreaterThan(115 * 1024);
        expect(dense.length).toBeLessThanOrEqual(512 * 1024);

        const result = await sanitizePiiHybrid(dense, { skipSizeLimit: true });
        expect(result.error).toContain('Output truncated to 131072 characters');
        expect(result.text.length).toBe(128 * 1024);
        // All 1000 masks sit inside the truncated prefix (their expansion
        // starts before the cut), so they survive the item filter.
        expect(result.maskedItems).toHaveLength(1000);
    });
});
