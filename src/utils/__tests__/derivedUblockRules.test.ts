import { describe, it, expect } from 'vitest';
import {
  deriveUblockRulesFromSources,
  emptyUblockRules,
  dropDerivedUblockRules,
  type UblockSourceView,
} from '../derivedUblockRules.js';
import type { Source, UblockRules } from '../types.js';

function makeSource(url: string, blockDomains: string[], exceptionDomains: string[]): Source {
  return { url, ruleCount: blockDomains.length + exceptionDomains.length, blockDomains, exceptionDomains, importedAt: 1700000000000 };
}

function makeRules(blockDomains: string[], exceptionDomains: string[]): UblockRules {
  return { blockDomains, exceptionDomains, metadata: { importedAt: 1700000000000, ruleCount: blockDomains.length + exceptionDomains.length } };
}

describe('derivedUblockRules', () => {
  describe('deriveUblockRulesFromSources', () => {
    it('returns empty rules for an empty source list', () => {
      const derived = deriveUblockRulesFromSources([]);
      expect(derived.blockDomains).toEqual([]);
      expect(derived.exceptionDomains).toEqual([]);
      expect(derived.metadata.ruleCount).toBe(0);
    });

    it('returns empty rules for nullish input', () => {
      expect(deriveUblockRulesFromSources(null).blockDomains).toEqual([]);
      expect(deriveUblockRulesFromSources(undefined).exceptionDomains).toEqual([]);
    });

    it('merges domains from a single source', () => {
      const derived = deriveUblockRulesFromSources([makeSource('manual', ['example.com', 'test.com'], ['trusted.com'])]);
      expect(derived.blockDomains).toHaveLength(2);
      expect(derived.exceptionDomains).toEqual(['trusted.com']);
      expect(derived.metadata.ruleCount).toBe(3);
    });

    it('dedupes domains shared by multiple sources', () => {
      const derived = deriveUblockRulesFromSources([
        makeSource('https://a.example/list.txt', ['example.com', 'shared.com'], []),
        makeSource('https://b.example/other.txt', ['shared.com', 'other.com'], ['exc.com']),
      ]);
      expect([...derived.blockDomains].sort()).toEqual(['example.com', 'other.com', 'shared.com']);
      expect(derived.exceptionDomains).toEqual(['exc.com']);
      expect(derived.metadata.ruleCount).toBe(4);
    });

    it('tolerates sources without domain arrays', () => {
      const legacySource = { url: 'manual' } as unknown as UblockSourceView;
      const derived = deriveUblockRulesFromSources([legacySource, makeSource('manual2', ['a.com'], [])]);
      expect(derived.blockDomains).toEqual(['a.com']);
      expect(derived.exceptionDomains).toEqual([]);
    });

    it('returns fresh arrays on every call', () => {
      const sources = [makeSource('manual', ['a.com'], [])];
      const first = deriveUblockRulesFromSources(sources);
      const second = deriveUblockRulesFromSources(sources);
      expect(first).not.toBe(second);
      expect(first.blockDomains).not.toBe(second.blockDomains);
      expect(first.blockDomains).toEqual(second.blockDomains);
    });
  });

  describe('emptyUblockRules', () => {
    it('returns the canonical empty form', () => {
      expect(emptyUblockRules()).toEqual({
        blockDomains: [],
        exceptionDomains: [],
        metadata: { importedAt: 0, ruleCount: 0 },
      });
    });

    it('returns a fresh object on every call', () => {
      expect(emptyUblockRules()).not.toBe(emptyUblockRules());
    });
  });

  describe('dropDerivedUblockRules', () => {
    it('empties stored rules when sources hold the domains', () => {
      const stored = makeRules(['a.com', 'b.com'], []);
      const dropped = dropDerivedUblockRules([makeSource('manual', ['a.com', 'b.com'], [])], stored);
      expect(dropped).toEqual(emptyUblockRules());
      expect(stored.blockDomains).toEqual(['a.com', 'b.com']);
    });

    it('keeps stored rules when no sources exist (legacy rules-only payloads)', () => {
      const stored = makeRules(['legacy.com'], []);
      expect(dropDerivedUblockRules([], stored)).toBe(stored);
    });

    it('keeps stored rules when the sources value is malformed', () => {
      const stored = makeRules(['legacy.com'], []);
      expect(dropDerivedUblockRules('not-an-array' as unknown as Source[], stored)).toBe(stored);
    });

    it('returns the canonical empty form when stored rules are missing', () => {
      expect(dropDerivedUblockRules([], undefined)).toEqual(emptyUblockRules());
    });
  });
});
