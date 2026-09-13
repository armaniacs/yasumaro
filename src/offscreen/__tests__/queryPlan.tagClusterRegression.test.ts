import { describe, it, expect } from 'vitest';
import { QUERY_CAPS, buildQuerySpec, clampLimit } from '../queryPlan.js';
import { computeTagCooccurrence, narrowEntriesToTopTags } from '../../dashboard/tagCooccurrence.js';

describe('queryPlan tagCluster regression (6.8.12 hotfix)', () => {
  describe('plain cap is 10000 to keep tagCluster data', () => {
    it('exposes plain cap 10000 (old value 1000 broke tagCluster)', () => {
      expect(QUERY_CAPS.plain).toBe(10000);
    });

    it('limit 10000 passes through instead of being capped to 1000', () => {
      expect(buildQuerySpec({ limit: 10000 }).limit).toBe(10000);
      expect(clampLimit(10000, QUERY_CAPS.plain, 100)).toBe(10000);
    });

    it('limit 5000 passes through (would have been capped to 1000 before)', () => {
      expect(buildQuerySpec({ limit: 5000 }).limit).toBe(5000);
    });

    it('limit 1500 passes through (the exact regression size)', () => {
      expect(buildQuerySpec({ limit: 1500 }).limit).toBe(1500);
    });

    it('fails if reverted to 1000 (mutant: QUERY_CAPS.plain = 1000)', () => {
      // This assertion intentionally fails when the cap is reverted.
      // It proves the test is not tautological: changing plain back to 1000 makes this red.
      expect(clampLimit(5000, QUERY_CAPS.plain, 100)).not.toBe(1000);
      expect(buildQuerySpec({ limit: 1500 }).limit).not.toBe(1000);
    });
  });

  describe('tagCooccurrence with 1500 entries where hot tags are beyond first 1000', () => {
    function makeEntries(): Array<{ tags: string | null }> {
      const empty = Array.from({ length: 1000 }, () => ({ tags: null as string | null }));
      const hot = Array.from({ length: 500 }, (_, i) => ({
        tags: i % 2 === 0 ? '#hot #other' : '#hot',
      }));
      return [...empty, ...hot];
    }

    it('finds hot tag when all 1500 are considered (fixed behavior)', () => {
      const entries = makeEntries();
      const narrowed = narrowEntriesToTopTags(entries, 50);
      const { nodes } = computeTagCooccurrence(narrowed);
      const tags = new Set(nodes.map((n) => n.tag));
      expect(tags.has('hot')).toBe(true);
      expect(nodes.find((n) => n.tag === 'hot')!.count).toBe(500);
    });

    it('misses hot tag when only first 1000 are considered (old bug simulation)', () => {
      const all = makeEntries();
      const truncated = all.slice(0, 1000);
      const narrowed = narrowEntriesToTopTags(truncated, 50);
      const { nodes } = computeTagCooccurrence(narrowed);
      expect(nodes.length).toBe(0);
      expect(nodes.find((n) => n.tag === 'hot')).toBeUndefined();
    });
  });
});
