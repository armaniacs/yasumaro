import { describe, test, expect } from 'vitest';
import { escapeHtml } from '../htmlEscape.js';

describe('escapeHtml', () => {
    test('特殊文字をHTMLエンティティに変換する', () => {
        expect(escapeHtml('&')).toBe('&amp;');
        expect(escapeHtml('<')).toBe('&lt;');
        expect(escapeHtml('>')).toBe('&gt;');
        expect(escapeHtml('"')).toBe('&quot;');
        expect(escapeHtml("'")).toBe('&#039;');
        expect(escapeHtml('/')).toBe('&#x2F;');
    });
    test('複数の特殊文字を含む文字列を変換する', () => {
        expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;');
    });
    test('特殊文字がない場合はそのまま返す', () => {
        expect(escapeHtml('Hello World')).toBe('Hello World');
    });
    test('空文字列を返す', () => {
        expect(escapeHtml('')).toBe('');
    });
    test('文字列以外の入力は空文字列を返す', () => {
        expect(escapeHtml(null as any)).toBe('');
        expect(escapeHtml(undefined as any)).toBe('');
    });
});
