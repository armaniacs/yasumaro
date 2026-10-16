/**
 * Pins the restored ProviderStrategy type alias and its deprecation contract.
 *
 * The alias was removed in 09833ffa (6.9.45) — earlier than the sunset promise
 * ("次メジャーで削除（再評価 2026-12-31）") made when it was marked @deprecated.
 * Old custom providers importing `ProviderStrategy` from
 * providers/ProviderStrategy.js must keep type-checking for the rest of the
 * migration window, so deleting the alias again before the next major fails
 * here instead of breaking consumers.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AIProviderStrategy, ProviderStrategy } from '../ProviderStrategy.js';

// Compile-time pin: the restored alias is exactly AIProviderStrategy.
// (Tests are not covered by `npm run type-check`; the source-text test below
// is the guard that runs in CI.)
type AliasIsCanonical = ProviderStrategy extends AIProviderStrategy
    ? AIProviderStrategy extends ProviderStrategy
        ? true
        : false
    : false;
const aliasIsCanonical: AliasIsCanonical = true;

describe('ProviderStrategy deprecated type alias (restored migration window)', () => {
    it('is the same type as AIProviderStrategy', () => {
        expect(aliasIsCanonical).toBe(true);
    });

    it('keeps the @deprecated sunset note and the canonical-target declaration', () => {
        const source = readFileSync(new URL('../ProviderStrategy.ts', import.meta.url), 'utf8');
        const aliasIndex = source.indexOf('export type ProviderStrategy = AIProviderStrategy;');
        expect(aliasIndex).toBeGreaterThan(-1);
        const docStart = source.lastIndexOf('/**', aliasIndex);
        expect(docStart).toBeGreaterThan(-1);
        const doc = source.slice(docStart, aliasIndex);
        expect(doc).toContain('@deprecated');
        expect(doc).toContain('AIProviderStrategy');
        expect(doc).toContain('次メジャーで削除（再評価 2026-12-31）');
    });
});
