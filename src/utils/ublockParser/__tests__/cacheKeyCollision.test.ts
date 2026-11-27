/**
 * cacheKeyCollision.test.ts
 * VULN-003 contract pin: cache keys must separate FNV-1a-colliding texts.
 *
 * Ported from yasumaro_VULNHUNT_RESULTS_2026-11-27-190000 exploit test 003
 * after the fix. The attacker capability (a crafted equal-length pair whose
 * 32-bit FNV-1a hashes collide) is modeled in-test; the cache must treat the
 * pair as distinct entries. Under the pre-fix FNV-1a+length key these
 * assertions fail: the victim was served the attacker's parsed ruleset.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { generateCacheKey, clearCache, hasCacheKey } from '../cache.js';
import { parseUblockFilterListWithErrors } from '../index.js';
import { CACHE_CONFIG } from '../constants.js';

// Test-only reimplementation of the removed pre-fix hash. This models the
// attacker's ability to craft colliding inputs; the production cache must not
// rely on any 32-bit non-cryptographic hash, whose collision-prevention claim
// (PERF-019) is unachievable in that hash space.
function fnv1a32(str: string): number {
  const FNV_OFFSET_BASIS = 0x811c9dc5;
  const FNV_PRIME = 0x01000193;

  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

function randLabel(len: number): string {
  const cs = 'abcdefghijkmnpqrstuvwxyz';
  let s = '';
  for (let i = 0; i < len; i++) s += cs[Math.floor(Math.random() * cs.length)];
  return s;
}

// Birthday search for two equal-length ublock rules with identical FNV-1a-32
// (~2^16 candidates; measured at well under a second in exploit test 003).
function findFnvCollision(): { attacker: string; victim: string } {
  const seen = new Map<number, string>();
  for (let i = 0; i < 1_000_000; i++) {
    const text = `||${randLabel(12)}.example^`;
    const hash = fnv1a32(text);
    const prev = seen.get(hash);
    if (prev !== undefined && prev !== text) return { attacker: prev, victim: text };
    seen.set(hash, text);
  }
  throw new Error('no same-length FNV-1a collision found within 1M candidates');
}

describe('ublockParser cache key: FNV-1a collision pair lands in separate entries', () => {
  let collision: { attacker: string; victim: string };

  beforeEach(() => {
    clearCache();
    collision = findFnvCollision();
  });

  it('assigns different keys to two texts with identical FNV-1a-32 hash and length', () => {
    const { attacker, victim } = collision;
    expect(attacker.length).toBe(victim.length);
    expect(fnv1a32(attacker)).toBe(fnv1a32(victim));
    expect(generateCacheKey(attacker)).not.toBe(generateCacheKey(victim));
  });

  it('returns the victim its own parsed ruleset, not the cached attacker result', () => {
    const { attacker, victim } = collision;
    const attackerLabel = attacker.slice(2, 14);
    const victimLabel = victim.slice(2, 14);
    expect(attackerLabel).not.toBe(victimLabel);

    // Step 1: attacker text is parsed first and cached.
    const attackerResult = parseUblockFilterListWithErrors(attacker);
    expect(attackerResult.rules.blockRules).toHaveLength(1);

    // Step 2: the victim must get a fresh parse under its own key. A cached
    // attacker entry can never contain the victim label.
    const victimResult = parseUblockFilterListWithErrors(victim);
    const victimSerialized = JSON.stringify(victimResult.rules);
    expect(victimSerialized).toContain(victimLabel);
    expect(victimSerialized).not.toContain(attackerLabel);
  });

  it('keeps both entries addressable after the colliding pair is cached', () => {
    const { attacker, victim } = collision;
    parseUblockFilterListWithErrors(attacker);
    parseUblockFilterListWithErrors(victim);

    expect(hasCacheKey(generateCacheKey(attacker))).toBe(true);
    expect(hasCacheKey(generateCacheKey(victim))).toBe(true);

    const attackerAgain = parseUblockFilterListWithErrors(attacker);
    expect(JSON.stringify(attackerAgain.rules)).toContain(attacker.slice(2, 14));
  });

  it('bounds retained entries at LRU_MAX_ENTRIES with full-text keys', () => {
    // Key memory is bounded: LRU_MAX_ENTRIES x text size, evicting oldest.
    for (let i = 0; i < CACHE_CONFIG.LRU_MAX_ENTRIES + 10; i++) {
      parseUblockFilterListWithErrors(`||evict${i}z.example^`);
    }
    for (let i = 0; i < 10; i++) {
      expect(hasCacheKey(generateCacheKey(`||evict${i}z.example^`))).toBe(false);
    }
    for (let i = 10; i < CACHE_CONFIG.LRU_MAX_ENTRIES + 10; i++) {
      expect(hasCacheKey(generateCacheKey(`||evict${i}z.example^`))).toBe(true);
    }
  });
});
