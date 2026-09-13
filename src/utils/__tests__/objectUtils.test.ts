/**
 * objectUtils.test.ts
 * objectUtils.ts の単体テスト
 */

import { describe, it, expect } from 'vitest';
import { pickDefined } from '../objectUtils.js';

describe('pickDefined', () => {
    it('removes undefined properties along with their keys', () => {
        const input = { a: 1, b: undefined, c: 'x' };
        expect(pickDefined(input)).toEqual({ a: 1, c: 'x' });
    });

    it('keeps undefined properties out of Object.keys', () => {
        const input = { a: 1, b: undefined };
        const result = pickDefined(input);
        expect(Object.keys(result)).toEqual(['a']);
        expect('b' in result).toBe(false);
    });

    it('returns objects without undefined unchanged', () => {
        const input = { a: 1, c: 'x' };
        expect(pickDefined(input)).toEqual({ a: 1, c: 'x' });
    });

    it('keeps null distinct from undefined', () => {
        const input = { a: null, b: undefined };
        const result = pickDefined(input);
        expect(result).toEqual({ a: null });
    });

    it('leaves an empty object as an empty object', () => {
        expect(pickDefined({})).toEqual({});
    });

    it('returns an empty object when every property is undefined', () => {
        const input = { a: undefined, b: undefined };
        expect(pickDefined(input)).toEqual({});
    });
});
