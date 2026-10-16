/**
 * Pins the restored OpenAIProvider alias and its deprecation contract.
 *
 * The class was removed in 09833ffa (6.9.45) — earlier than the promise made
 * when it was marked @deprecated ("次メジャーで削除（再評価 2026-12-31）").
 * These tests keep the alias importable from providers/index.js for the rest
 * of the migration window, so removing it again before the next major fails
 * here instead of breaking consumers.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GenericOpenAICompatibleProvider, OpenAIProvider } from '../index.js';

describe('OpenAIProvider deprecated alias (restored migration window)', () => {
    it('is re-exported from providers/index.js as a subclass of the canonical class', () => {
        expect(OpenAIProvider).toBeTypeOf('function');
        expect(OpenAIProvider.prototype instanceof GenericOpenAICompatibleProvider).toBe(true);
    });

    it('keeps the static isLocalUrl helper delegating to the canonical class', () => {
        expect(OpenAIProvider.isLocalUrl('http://127.0.0.1:1234/v1')).toBe(true);
        expect(OpenAIProvider.isLocalUrl('https://api.openai.com/v1')).toBe(false);
        expect(OpenAIProvider.isLocalUrl('http://127.0.0.1:1234/v1')).toBe(
            GenericOpenAICompatibleProvider.isLocalUrl('http://127.0.0.1:1234/v1'),
        );
    });

    it('carries the @deprecated sunset note (次メジャーで削除 / 2026-12-31)', () => {
        const source = readFileSync(new URL('../OpenAIProvider.ts', import.meta.url), 'utf8');
        const classIndex = source.indexOf('export class OpenAIProvider');
        expect(classIndex).toBeGreaterThan(-1);
        const docStart = source.lastIndexOf('/**', classIndex);
        expect(docStart).toBeGreaterThan(-1);
        const doc = source.slice(docStart, classIndex);
        expect(doc).toContain('@deprecated');
        expect(doc).toContain('次メジャーで削除（再評価 2026-12-31）');
    });
});
