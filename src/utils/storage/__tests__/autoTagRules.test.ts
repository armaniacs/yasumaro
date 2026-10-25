/**
 * autoTagRules.test.ts
 * PBI 2026-10-23-06: unit tests for the auto-tag rule normalizer, matcher,
 * merger, and bounded application log in src/utils/storage/autoTagRules.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  AUTO_TAG_APPLICATIONS_CAP,
  appendAutoTagApplications,
  matchAutoTagRules,
  mergeRuleTags,
  normalizeAutoTagApplication,
  normalizeAutoTagRule,
  normalizeAutoTagRules,
  removeAutoTagRule,
  ruleMatches,
  upsertAutoTagRule,
  type AutoTagRule,
} from '../autoTagRules.js';

function rule(overrides: Partial<AutoTagRule> = {}): AutoTagRule {
  return {
    id: 'r1',
    name: 'Docs',
    domainSuffix: 'example.com',
    tag: 'docs',
    priority: 100,
    enabled: true,
    ...overrides,
  };
}

describe('normalizeAutoTagRule', () => {
  it('accepts a valid rule and folds the domain suffix', () => {
    const out = normalizeAutoTagRule('r1', {
      name: 'Docs',
      domainSuffix: '.Example.COM',
      tag: 'docs',
      priority: 5,
      enabled: false,
    });
    expect(out).toEqual({
      id: 'r1',
      name: 'Docs',
      tag: 'docs',
      priority: 5,
      enabled: false,
      domainSuffix: 'example.com',
    });
  });

  it('defaults priority to 100 and enabled to true', () => {
    const out = normalizeAutoTagRule('r1', { name: 'N', urlContains: 'x', tag: 't' });
    expect(out?.priority).toBe(100);
    expect(out?.enabled).toBe(true);
  });

  it('rejects rules with no conditions, bad tags, and bad ids', () => {
    expect(normalizeAutoTagRule('r1', { name: 'N', tag: 't' })).toBeNull();
    expect(normalizeAutoTagRule('r1', { name: 'N', urlContains: 'x', tag: '#t' })).toBeNull();
    expect(normalizeAutoTagRule('r1', { name: 'N', urlContains: 'x', tag: 'two words' })).toBeNull();
    expect(normalizeAutoTagRule('', { name: 'N', urlContains: 'x', tag: 't' })).toBeNull();
    expect(normalizeAutoTagRule('r1', null)).toBeNull();
  });

  it('drops corrupted entries from the map', () => {
    const out = normalizeAutoTagRules({ r1: { name: 'N', urlContains: 'x', tag: 't' }, bad: 42 });
    expect(Object.keys(out)).toEqual(['r1']);
  });
});

describe('upsertAutoTagRule / removeAutoTagRule', () => {
  it('upserts without mutating the input map', () => {
    const before = { r1: rule() };
    const after = upsertAutoTagRule(before, rule({ id: 'r2', tag: 'other' }));
    expect(Object.keys(after).sort()).toEqual(['r1', 'r2']);
    expect(Object.keys(before)).toEqual(['r1']);
  });

  it('removes by id and treats a missing id as a no-op', () => {
    expect(Object.keys(removeAutoTagRule({ r1: rule() }, 'r1'))).toEqual([]);
    expect(Object.keys(removeAutoTagRule({ r1: rule() }, 'missing'))).toEqual(['r1']);
  });
});

describe('ruleMatches', () => {
  it('matches host suffix but not a superstring host', () => {
    expect(ruleMatches({ domainSuffix: 'example.com' }, 'https://docs.example.com/p', '')).toBe(true);
    expect(ruleMatches({ domainSuffix: 'example.com' }, 'https://notexample.com/p', '')).toBe(false);
    expect(ruleMatches({ domainSuffix: 'example.com' }, 'not a url', '')).toBe(false);
  });

  it('ANDs every specified condition case-insensitively', () => {
    const cond = { urlContains: 'DOCS', titleContains: 'Guide' };
    expect(ruleMatches(cond, 'https://x.test/docs/1', 'User Guide')).toBe(true);
    expect(ruleMatches(cond, 'https://x.test/blog/1', 'User Guide')).toBe(false);
    expect(ruleMatches(cond, 'https://x.test/docs/1', 'News')).toBe(false);
  });
});

describe('matchAutoTagRules', () => {
  it('returns enabled matches ordered by priority with id tiebreak', () => {
    const rules = {
      b: rule({ id: 'b', priority: 10 }),
      a: rule({ id: 'a', priority: 10 }),
      c: rule({ id: 'c', priority: 1 }),
      off: rule({ id: 'off', priority: 0, enabled: false }),
    };
    const matches = matchAutoTagRules('https://example.com/p', '', rules);
    expect(matches.map((m) => m.ruleId)).toEqual(['c', 'a', 'b']);
  });

  it('returns empty for a non-matching record', () => {
    expect(matchAutoTagRules('https://other.test/', 'News', { r1: rule() })).toEqual([]);
  });
});

describe('mergeRuleTags', () => {
  it('appends new rule tags after AI tags without case-insensitive dupes', () => {
    const merged = mergeRuleTags(['AI', 'news'], [{ tag: 'ai', ruleId: 'r1' }, { tag: 'docs', ruleId: 'r2' }]);
    expect(merged).toEqual(['AI', 'news', 'docs']);
  });

  it('returns the input untouched when nothing matches', () => {
    expect(mergeRuleTags(['a'], [])).toEqual(['a']);
    expect(mergeRuleTags(undefined, [])).toBeUndefined();
  });
});

describe('application log', () => {
  it('rejects malformed entries', () => {
    expect(normalizeAutoTagApplication({ ruleId: 'r', tag: 't' })).toBeNull();
    expect(
      normalizeAutoTagApplication({ ruleId: 'r', tag: 't', url: 'https://x/', at: 123 })
    ).toEqual({ ruleId: 'r', tag: 't', url: 'https://x/', at: 123 });
  });

  it('caps the log, keeping the newest entries', () => {
    const log = Array.from({ length: AUTO_TAG_APPLICATIONS_CAP }, (_, i) => ({
      ruleId: 'r',
      tag: 't',
      url: `https://x/${i}`,
      at: i,
    }));
    const out = appendAutoTagApplications(log, [{ ruleId: 'r', tag: 't', url: 'https://x/new', at: 999 }]);
    expect(out).toHaveLength(AUTO_TAG_APPLICATIONS_CAP);
    expect(out[out.length - 1]?.url).toBe('https://x/new');
    expect(out[0]?.url).toBe('https://x/1');
  });
});
