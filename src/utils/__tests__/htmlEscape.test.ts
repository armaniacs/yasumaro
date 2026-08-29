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
        expect(escapeHtml(123 as any)).toBe('');
        expect(escapeHtml({} as any)).toBe('');
        expect(escapeHtml([] as any)).toBe('');
        expect(escapeHtml(true as any)).toBe('');
        expect(escapeHtml(Symbol('x') as any)).toBe('');
    });
    test('nullish coalescing fallbackは到達不能だが、置換が常にマップ済みであることを確認', () => {
        // 全ての正規表現マッチ文字がマップに存在するため、フォールバック '' は到達不能。
        // このテストは分岐が意図的に到達不能な防御的コードであることを文書化する。
        // 置換結果が undefined にならないことを確認
        expect(escapeHtml('&<>"\'/')).toBe('&amp;&lt;&gt;&quot;&#039;&#x2F;');
        // 追加の防御: 空文字列や通常文字では置換が発生しない
        expect(escapeHtml('abc')).toBe('abc');
    });
});
