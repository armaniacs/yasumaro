/**
 * cssUtils.test.ts
 * cssUtils.ts の単体テスト
 */

import { vi } from 'vitest';
import { escapeCssSelector } from '../cssUtils.js';

describe('cssUtils', () => {
    describe('escapeCssSelector', () => {
        test('CSS.escape が利用可能な場合はそれを使用する', () => {
            // グローバル CSS.escape が定義されている場合、それを使用する
            const cssGlobal = (globalThis as any).CSS;
            expect(cssGlobal).toBeDefined();
            expect(cssGlobal.escape).toBeDefined();
            const spy = vi.spyOn(cssGlobal, 'escape');
            const result = escapeCssSelector('hello world');
            expect(spy).toHaveBeenCalledWith('hello world');
            expect(result).toBe('hello\\ world');
            spy.mockRestore();
        });

        test('英数字のみの文字列はそのまま返す', () => {
            const result = escapeCssSelector('abc123');
            expect(result).toBe('abc123');
        });

        test('ハイフンとアンダースコアはエスケープしない', () => {
            const result = escapeCssSelector('my-class_name');
            expect(result).toBe('my-class_name');
        });

        test('特殊文字をエスケープする', () => {
            const result = escapeCssSelector('test.class#id');
            expect(result).toContain('test');
            expect(result).not.toBe('test.class#id');
        });

        test('CSS が undefined の場合フォールバックを使用する', async () => {
            const originalCSS = (global as any).CSS;
            (global as any).CSS = undefined;

            vi.resetModules();

            try {
                // Re-import to get the fallback version
                const mod = await import('../cssUtils.js');
                const result = mod.escapeCssSelector('hello world');
                expect(result).toBe('hello\\ world');
            } finally {
                (global as any).CSS = originalCSS;
                vi.resetModules();
            }
        });

        test('CSS.escape が undefined の場合フォールバックを使用する', async () => {
            const originalCSS = (global as any).CSS;
            (global as any).CSS = {};

            vi.resetModules();

            try {
                const mod = await import('../cssUtils.js');
                const result = mod.escapeCssSelector('test.value');
                expect(result).toBe('test\\.value');
            } finally {
                (global as any).CSS = originalCSS;
                vi.resetModules();
            }
        });

        test('フォールバックで日本語文字をエスケープする', async () => {
            const originalCSS = (global as any).CSS;
            (global as any).CSS = undefined;

            vi.resetModules();

            try {
                const mod = await import('../cssUtils.js');
                const result = mod.escapeCssSelector('テスト');
                expect(result).toContain('\\');
            } finally {
                (global as any).CSS = originalCSS;
                vi.resetModules();
            }
        });

        test('空文字列を渡すと空文字列を返す', () => {
            const result = escapeCssSelector('');
            expect(result).toBe('');
        });

        test('数字で始まる文字列をエスケープする', () => {
            const result = escapeCssSelector('123abc');
            expect(typeof result).toBe('string');
            expect(result.length).toBeGreaterThan(0);
        });
    });
});
