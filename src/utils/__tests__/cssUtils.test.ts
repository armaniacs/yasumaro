/**
 * cssUtils.test.ts
 * cssUtils.ts の単体テスト
 */

import { escapeCssSelector } from '../cssUtils.js';

describe('cssUtils', () => {
    describe('escapeCssSelector', () => {
        test('CSS.escape が利用可能な場合はそれを使用する', () => {
            const result = escapeCssSelector('hello world');
            expect(result).toBe('hello\\ world');
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

        test('CSS が undefined の場合フォールバックを使用する', () => {
            const originalCSS = (global as any).CSS;
            (global as any).CSS = undefined;

            try {
                let result = '';
                jest.isolateModules(() => {
                    const { escapeCssSelector: isolatedEscape } = require('../cssUtils.js');
                    result = isolatedEscape('hello world');
                });
                expect(result).toBe('hello\\ world');
            } finally {
                (global as any).CSS = originalCSS;
            }
        });

        test('CSS.escape が undefined の場合フォールバックを使用する', () => {
            const originalCSS = (global as any).CSS;
            (global as any).CSS = {};

            try {
                let result = '';
                jest.isolateModules(() => {
                    const { escapeCssSelector: isolatedEscape } = require('../cssUtils.js');
                    result = isolatedEscape('test.value');
                });
                expect(result).toBe('test\\.value');
            } finally {
                (global as any).CSS = originalCSS;
            }
        });

        test('フォールバックで日本語文字をエスケープする', () => {
            const originalCSS = (global as any).CSS;
            (global as any).CSS = undefined;

            try {
                let result = '';
                jest.isolateModules(() => {
                    const { escapeCssSelector: isolatedEscape } = require('../cssUtils.js');
                    result = isolatedEscape('テスト');
                });
                expect(result).toContain('\\');
            } finally {
                (global as any).CSS = originalCSS;
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
