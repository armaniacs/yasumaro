/**
 * objectUtils.test.ts
 * objectUtils.ts の単体テスト
 */

import { describe, it, expect } from 'vitest';
import { pickDefined } from '../objectUtils.js';

describe('pickDefined', () => {
    it('undefined のプロパティをキーごと除去する', () => {
        const input = { a: 1, b: undefined, c: 'x' };
        expect(pickDefined(input)).toEqual({ a: 1, c: 'x' });
    });

    it('undefined のプロパティは Object.keys にも現れない', () => {
        const input = { a: 1, b: undefined };
        const result = pickDefined(input);
        expect(Object.keys(result)).toEqual(['a']);
        expect('b' in result).toBe(false);
    });

    it('undefined を含まないオブジェクトはそのまま返す', () => {
        const input = { a: 1, c: 'x' };
        expect(pickDefined(input)).toEqual({ a: 1, c: 'x' });
    });

    it('null は undefined と区別して保持する', () => {
        const input = { a: null, b: undefined };
        const result = pickDefined(input);
        expect(result).toEqual({ a: null });
    });

    it('空オブジェクトは空オブジェクトのまま', () => {
        expect(pickDefined({})).toEqual({});
    });

    it('全プロパティが undefined なら空オブジェクトになる', () => {
        const input = { a: undefined, b: undefined };
        expect(pickDefined(input)).toEqual({});
    });
});
