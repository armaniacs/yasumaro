// @vitest-environment jsdom

/**
 * cssUtils.test.ts
 * cssUtils.ts の単体テスト
 */

import { vi } from 'vitest';
import { escapeCssSelector } from '../cssUtils.js';

describe('cssUtils', () => {
    describe('escapeCssSelector', () => {
        test('uses CSS.escape when it is available', () => {
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

        test('returns alphanumeric-only strings unchanged', () => {
            const result = escapeCssSelector('abc123');
            expect(result).toBe('abc123');
        });

        test('does not escape hyphens and underscores', () => {
            const result = escapeCssSelector('my-class_name');
            expect(result).toBe('my-class_name');
        });

        test('escapes special characters', () => {
            const result = escapeCssSelector('test.class#id');
            expect(result).toContain('test');
            expect(result).not.toBe('test.class#id');
        });

        test('uses the fallback when CSS is undefined', async () => {
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

        test('uses the fallback when CSS.escape is undefined', async () => {
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

        test('escapes Japanese characters in the fallback', async () => {
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

        test('returns an empty string when given an empty string', () => {
            const result = escapeCssSelector('');
            expect(result).toBe('');
        });

        test('escapes strings starting with a digit', () => {
            const result = escapeCssSelector('123abc');
            expect(typeof result).toBe('string');
            expect(result.length).toBeGreaterThan(0);
        });
    });
});
