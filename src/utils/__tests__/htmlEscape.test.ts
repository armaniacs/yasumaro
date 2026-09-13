import { describe, test, expect } from 'vitest';
import { escapeHtml } from '../htmlEscape.js';

describe('escapeHtml', () => {
    test('converts special characters to HTML entities', () => {
        expect(escapeHtml('&')).toBe('&amp;');
        expect(escapeHtml('<')).toBe('&lt;');
        expect(escapeHtml('>')).toBe('&gt;');
        expect(escapeHtml('"')).toBe('&quot;');
        expect(escapeHtml("'")).toBe('&#039;');
        expect(escapeHtml('/')).toBe('&#x2F;');
    });
    test('converts a string with multiple special characters', () => {
        expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;');
    });
    test('returns strings without special characters unchanged', () => {
        expect(escapeHtml('Hello World')).toBe('Hello World');
    });
    test('returns an empty string for empty input', () => {
        expect(escapeHtml('')).toBe('');
    });
    test('returns an empty string for non-string input', () => {
        expect(escapeHtml(null as any)).toBe('');
        expect(escapeHtml(undefined as any)).toBe('');
        expect(escapeHtml(123 as any)).toBe('');
        expect(escapeHtml({} as any)).toBe('');
        expect(escapeHtml([] as any)).toBe('');
        expect(escapeHtml(true as any)).toBe('');
        expect(escapeHtml(Symbol('x') as any)).toBe('');
    });
    test('verifies replacements are always mapped although the nullish coalescing fallback is unreachable', () => {
        // 全ての正規表現マッチ文字がマップに存在するため、フォールバック '' は到達不能。
        // このテストは分岐が意図的に到達不能な防御的コードであることを文書化する。
        // 置換結果が undefined にならないことを確認
        expect(escapeHtml('&<>"\'/')).toBe('&amp;&lt;&gt;&quot;&#039;&#x2F;');
        // 追加の防御: 空文字列や通常文字では置換が発生しない
        expect(escapeHtml('abc')).toBe('abc');
    });
});
