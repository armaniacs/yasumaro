/**
 * ublockParser/index.test.ts
 * Branch coverage tests for the main entry point parseUblockFilterList
 * and parseUblockFilterListWithErrors.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    parseUblockFilterList,
    parseUblockFilterListWithErrors,
} from '../index.js';
import { clearCache } from '../cache.js';

describe('parseUblockFilterList', () => {
    beforeEach(() => {
        clearCache();
    });

    it('returns empty ruleset for null/undefined input', () => {
        expect(parseUblockFilterList(null as unknown as string).blockRules).toEqual([]);
        expect(parseUblockFilterList(undefined as unknown as string).blockRules).toEqual([]);
        expect(parseUblockFilterList('').blockRules).toEqual([]);
    });

    it('returns cached result on second call with same input', () => {
        const text = '||example.com^';
        const first = parseUblockFilterList(text);
        const second = parseUblockFilterList(text);
        expect(second.blockRules.length).toBe(first.blockRules.length);
    });

    it('skips empty lines and comment lines', () => {
        const text = '\n! comment\n\n||example.com^\n# hosts comment\n';
        const result = parseUblockFilterList(text);
        expect(result.blockRules.length).toBe(1);
        expect(result.blockRules[0].domain).toBe('example.com');
    });

    it('classifies exception rules', () => {
        const text = '@@||example.com^';
        const result = parseUblockFilterList(text);
        expect(result.exceptionRules.length).toBe(1);
    });

    it('handles hosts format rules', () => {
        const text = '0.0.0.0 example.com';
        const result = parseUblockFilterList(text);
        expect(result.blockRules.length).toBe(1);
        expect(result.blockRules[0].domain).toBe('example.com');
    });

    it('ignores IGNORE type rules (localhost)', () => {
        const text = '127.0.0.1 localhost\n||example.com^';
        const result = parseUblockFilterList(text);
        expect(result.blockRules.length).toBe(1);
        expect(result.metadata.ruleCount).toBe(1);
    });

    it('returns empty ruleset when input exceeds MAX_INPUT_SIZE', () => {
        const text = 'x'.repeat(11 * 1024 * 1024);
        const result = parseUblockFilterList(text);
        expect(result.blockRules).toEqual([]);
        expect(result.metadata.ruleCount).toBe(0);
    });

    it('returns empty ruleset when line count exceeds MAX_LINES', () => {
        const text = Array.from({ length: 500001 }, () => '||example.com^').join('\n');
        const result = parseUblockFilterList(text);
        expect(result.blockRules).toEqual([]);
    });

    it('sets metadata correctly', () => {
        const text = '||a.com^\n||b.com^\n!comment';
        const result = parseUblockFilterList(text);
        expect(result.metadata.lineCount).toBe(3);
        expect(result.metadata.ruleCount).toBe(2);
        expect(result.metadata.source).toBe('paste');
        expect(result.metadata.importedAt).toBeGreaterThan(0);
    });
});

describe('parseUblockFilterListWithErrors', () => {
    beforeEach(() => {
        clearCache();
    });

    it('returns empty ruleset for null input', () => {
        const result = parseUblockFilterListWithErrors(null as unknown as string);
        expect(result.rules.blockRules).toEqual([]);
        expect(result.errors).toEqual([]);
    });

    it('returns cached result with errors array rehydrated', () => {
        const text = '||example.com^';
        const first = parseUblockFilterListWithErrors(text);
        const second = parseUblockFilterListWithErrors(text);
        expect(second.rules.blockRules.length).toBe(first.rules.blockRules.length);
    });

    it('collects errors for invalid rule lines', () => {
        const text = 'not-a-valid-rule\n||example.com^';
        const result = parseUblockFilterListWithErrors(text);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0].lineNumber).toBe(1);
        expect(result.errors[0].message).toBe('無効なルール形式です');
    });

    it('skips empty and comment lines without errors', () => {
        const text = '\n!comment\n\n||example.com^';
        const result = parseUblockFilterListWithErrors(text);
        expect(result.errors.length).toBe(0);
        expect(result.rules.blockRules.length).toBe(1);
    });

    it('counts invalid domains as errors', () => {
        // A line that passes prefix/suffix but fails domain validation
        const text = '||example..com^';
        const result = parseUblockFilterListWithErrors(text);
        expect(result.errors.length).toBe(1);
    });

    it('returns input too large error', () => {
        const text = 'x'.repeat(11 * 1024 * 1024);
        const result = parseUblockFilterListWithErrors(text);
        expect(result.rules.blockRules).toEqual([]);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0].message).toContain('Input too large');
    });

    it('returns too many lines error', () => {
        const text = Array.from({ length: 500001 }, () => '||example.com^').join('\n');
        const result = parseUblockFilterListWithErrors(text);
        expect(result.rules.blockRules).toEqual([]);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0].message).toContain('Too many lines');
    });

    it('includes metadata in result', () => {
        const text = '||a.com^\n@@||b.com^';
        const result = parseUblockFilterListWithErrors(text);
        expect(result.rules.metadata.ruleCount).toBe(2);
        expect(result.rules.metadata.lineCount).toBe(2);
    });
});
