/**
 * piiSanitizeHybrid.wasm-success.test.ts
 * WASMが正常に初期化・動作する経路（マージ結果の正当性）を検証する。
 *
 * piiSanitizeHybrid.test.ts はWASM初期化失敗時のフォールバック経路を
 * 検証するのに対し、このファイルは Node のfile読み込みでWASM初期化を
 * 成功させ、WASM(5パターン) + TS(残19パターン)のマージ結果が両方の
 * PIIタイプを含み、正しい順序でマスクされることを検証する。
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

    test('masks a TS-only pattern (ssn) that WASM does not cover', async () => {
        const { sanitizePiiHybrid } = await import('../piiSanitizeHybrid.js');
        const result = await sanitizePiiHybrid('ssn is 123-45-6789 on file');
        expect(result.text).toBe('ssn is [MASKED:ssn] on file');
        expect(result.maskedItems.map((m) => m.type)).toEqual(['ssn']);
    });

    test('merges WASM-covered and TS-only patterns from a single input', async () => {
        const { sanitizePiiHybrid } = await import('../piiSanitizeHybrid.js');
        const result = await sanitizePiiHybrid('email user@example.com and ssn 123-45-6789 together');
        const types = result.maskedItems.map((m) => m.type).sort();
        expect(types).toEqual(['email', 'ssn']);
        expect(result.text).toContain('[MASKED:email]');
        expect(result.text).toContain('[MASKED:ssn]');
    });

    test('a WASM-masked placeholder is never re-matched by the TS second pass', async () => {
        // Regression guard for the two-pass safety claim in
        // piiSanitizeHybrid.ts's module doc: "[MASKED:email]" contains no
        // digits/'@' that any of the 24 patterns require.
        const { sanitizePiiHybrid } = await import('../piiSanitizeHybrid.js');
        const result = await sanitizePiiHybrid('user@example.com user2@example.com');
        expect(result.maskedItems).toHaveLength(2);
        expect(result.text).toBe('[MASKED:email] [MASKED:email]');
    });
});
