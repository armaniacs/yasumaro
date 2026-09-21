/**
 * markdownSanitizerHybrid.test.ts
 * WASM初期化失敗時のフォールバック経路を検証する。Node には
 * chrome.runtime.getURL が無いため initMdSanitizeWasm() が失敗し、
 * ハイブリッドは TS 実装にフォールバックする — 全ケースで TS 参照と
 * 完全一致すること (markdownSanitizerHybrid.wasm-success.test.ts と同じ
 * 二分パターン)。
 */

import { describe, test, expect } from 'vitest';
import { sanitizeForObsidian } from '../markdownSanitizer.js';
import {
    sanitizeForObsidianHybrid,
    sanitizeBatchHybrid,
    sanitizeBatchAndJoinHybrid,
} from '../markdownSanitizerHybrid.js';

describe('sanitizeForObsidianHybrid (WASM unavailable → TS fallback)', () => {
    test('empty string returns empty string', async () => {
        await expect(sanitizeForObsidianHybrid('')).resolves.toBe('');
    });

    test('non-string input is returned as-is (TS typeof parity)', async () => {
        await expect(sanitizeForObsidianHybrid(null as unknown as string)).resolves.toBe(null);
        await expect(sanitizeForObsidianHybrid(undefined as unknown as string)).resolves.toBe(undefined);
    });

    test.each([
        ['hello world'],
        ['[evil](https://malicious.com)'],
        ['[t](javascript:alert(1))'],
        ['[[page]] ![[embed]]'],
        ['&<> &lt;'],
        ['[a](https://x/?a=1&b=2)'],
        ['[[[a](https://x)]]'],
        ['line1 [a](https://x)\nline2 [[w]]\nline3 <b>&</b>'],
        ['あいう [a](https://x) 🎉'],
    ])('small input %#: matches TS exactly', async (input) => {
        await expect(sanitizeForObsidianHybrid(input)).resolves.toBe(sanitizeForObsidian(input));
    });

    test('large-but-under-threshold input via fallback still matches TS', async () => {
        // Under MIN_WASM_CHARS the hybrid takes the TS path even when WASM
        // would be available — output must still equal the reference.
        const input = '[a](https://x) [[w]] & <b>\n'.repeat(20000);
        await expect(sanitizeForObsidianHybrid(input)).resolves.toBe(sanitizeForObsidian(input));
    });
});

describe('sanitizeBatchHybrid / sanitizeBatchAndJoinHybrid (TS fallback)', () => {
    test('empty batch returns empty results', async () => {
        await expect(sanitizeBatchHybrid([])).resolves.toEqual([]);
        await expect(sanitizeBatchAndJoinHybrid([], '\n---\n')).resolves.toBe('');
    });

    test('batch matches TS map, join matches TS map+join', async () => {
        const inputs = [
            '[a](https://x)',
            '[[w]] &',
            '',
            'line1\nline2 [b](https://y?a=1&b=2)',
        ];
        await expect(sanitizeBatchHybrid(inputs)).resolves.toEqual(inputs.map(sanitizeForObsidian));
        await expect(sanitizeBatchAndJoinHybrid(inputs, '\n---\n')).resolves.toBe(
            inputs.map(sanitizeForObsidian).join('\n---\n')
        );
    });
});
