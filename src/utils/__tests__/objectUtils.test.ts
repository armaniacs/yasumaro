/**
 * objectUtils.test.ts
 * objectUtils.ts の単体テスト
 */

import { describe, it, expect } from 'vitest';
import { pickDefined, isPlainRecord } from '../objectUtils.js';

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

describe('isPlainRecord', () => {
    it('rejects null', () => {
        expect(isPlainRecord(null)).toBe(false);
    });

    it('rejects an array', () => {
        expect(isPlainRecord([1, 2, 3])).toBe(false);
        expect(isPlainRecord([])).toBe(false);
    });

    it('accepts a plain object as Record<string, unknown>', () => {
        const input: Record<string, unknown> = { a: 1, b: 'x' };
        expect(isPlainRecord(input)).toBe(true);
        if (isPlainRecord(input)) {
            expect(input['a']).toBe(1);
        }
    });

    it('accepts an empty object', () => {
        expect(isPlainRecord({})).toBe(true);
    });

    it('rejects a number', () => {
        expect(isPlainRecord(42)).toBe(false);
        expect(isPlainRecord(0)).toBe(false);
    });

    it('rejects a string', () => {
        expect(isPlainRecord('value')).toBe(false);
        expect(isPlainRecord('')).toBe(false);
    });

    it('accepts a Date instance (the guard excludes only null and arrays)', () => {
        // 両ファイルの元のガード（null / typeof 'object' / !Array.isArray）は
        // Date を record として扱う。挙動不変のためこの結果を固定する。
        expect(isPlainRecord(new Date())).toBe(true);
    });

    it('rejects undefined', () => {
        expect(isPlainRecord(undefined)).toBe(false);
    });
});
