/**
 * domainUtils-batch-d.test.ts — PBI 2026-11-08-17 (item 2) pins.
 *
 * The derived-rules cache is keyed on reference identity PLUS a length
 * fingerprint. Wholesale replacement re-derives; reference-identical calls
 * reuse the derivation; an in-place push/splice changes the fingerprint and
 * is detected (re-derived) instead of serving stale rules. Same-length
 * in-place edits remain forbidden by convention (documented in
 * domainUtils.ts) — the fingerprint cannot see them.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  derivedRulesForSources,
  resetDerivedRulesCacheForTests,
} from '../domainUtils.js';
import type { Source } from '../types.js';

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    url: 'https://example.com/list.txt',
    ruleCount: 1,
    blockDomains: ['blocked.example'],
    exceptionDomains: [],
    importedAt: 1,
    ...overrides,
  };
}

describe('derivedRulesForSources cache convention (PBI 2026-11-08-17 item 2)', () => {
  beforeEach(() => {
    resetDerivedRulesCacheForTests();
  });

  it('reuses the derivation for reference-identical sources', () => {
    const sources = [makeSource()];
    const first = derivedRulesForSources(sources);
    const second = derivedRulesForSources(sources);
    expect(second).toBe(first);
  });

  it('reuses the derivation for a wholesale copy with identical element references', () => {
    const sources = [makeSource()];
    const first = derivedRulesForSources(sources);
    expect(derivedRulesForSources([...sources])).toBe(first);
  });

  it('re-derives when an element is replaced wholesale', () => {
    const sources = [makeSource()];
    const first = derivedRulesForSources(sources);
    const replaced = [makeSource({ blockDomains: ['other.example'] })];
    const second = derivedRulesForSources(replaced);
    expect(second).not.toBe(first);
    expect(second.blockDomains).toContain('other.example');
  });

  it('detects an in-place push by fingerprint and re-derives', () => {
    const source = makeSource();
    const sources = [source];
    const first = derivedRulesForSources(sources);
    expect(first.blockDomains).not.toContain('injected.example');

    source.blockDomains.push('injected.example');

    const second = derivedRulesForSources(sources);
    expect(second).not.toBe(first);
    expect(second.blockDomains).toContain('injected.example');
  });

  it('detects an in-place splice removal by fingerprint and re-derives', () => {
    const source = makeSource({ blockDomains: ['a.example', 'b.example'] });
    const sources = [source];
    const first = derivedRulesForSources(sources);
    expect(first.blockDomains).toContain('a.example');

    source.blockDomains.splice(0, 1);

    const second = derivedRulesForSources(sources);
    expect(second).not.toBe(first);
    expect(second.blockDomains).not.toContain('a.example');
  });
});
