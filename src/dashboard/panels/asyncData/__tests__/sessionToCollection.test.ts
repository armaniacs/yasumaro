/**
 * sessionToCollection.test.ts (PBI 2026-11-02-05)
 * Session → collection mapping: ids-first pinning, same-day date clause,
 * uniform-tag clause, uniform-search passthrough, guards and notes.
 */
import { describe, expect, it } from 'vitest';
import {
  buildSessionToCollectionQuery,
  isSessionSaveable,
} from '../sessionToCollection.js';
import { parseCollectionQueryV2 } from '../../../../utils/collectionQueryV2.js';
import { MAX_QUERY_IDS } from '../../../../utils/limits.js';
import { formatLocalDateString } from '../../../../utils/localDate.js';
import type { SessionInput } from '../../../researchSessionAggregate.js';

const DAY = { year: 2026, month: 10, day: 2 };

function at(hour: number, minute = 0, dayOffset = 0): number {
  return new Date(DAY.year, DAY.month, DAY.day + dayOffset, hour, minute).getTime();
}

function rec(
  id: number,
  createdAt: number,
  overrides?: Partial<SessionInput>,
): SessionInput {
  return {
    id,
    url: `https://e.com/${id}`,
    title: `page ${id}`,
    domain: 'e.com',
    tags: null,
    created_at: createdAt,
    is_starred: null,
    nav_source_url: null,
    search_query: null,
    ...overrides,
  };
}

function session(records: SessionInput[]) {
  return { records };
}

describe('sessionToCollection', () => {
  describe('buildSessionToCollectionQuery', () => {
    it('pins every record id ascending on a same-day session with a date clause', () => {
      const expectedDay = formatLocalDateString(at(9));
      const result = buildSessionToCollectionQuery(
        session([rec(7, at(9)), rec(3, at(9, 30)), rec(5, at(10))]),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const parsed = parseCollectionQueryV2(result.query);
      expect(parsed.ids).toEqual([3, 5, 7]);
      expect(parsed.clauses).toEqual([{ search: '', tag: null, date: expectedDay }]);
      expect(result.notes).not.toContain('cross-day');
      expect(result).toMatchObject({ count: 3, earliest: at(9), latest: at(10) });
    });

    it('keeps tag and search clauses when both are uniform on one day', () => {
      const result = buildSessionToCollectionQuery(
        session([
          rec(1, at(9), { tags: '#work', search_query: 'wasm' }),
          rec(2, at(10), { tags: '#work', search_query: 'wasm' }),
        ]),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const parsed = parseCollectionQueryV2(result.query);
      expect(parsed.clauses).toHaveLength(1);
      expect(parsed.clauses[0]).toMatchObject({ search: 'wasm', tag: 'work' });
      expect(parsed.clauses[0]?.date).not.toBeNull();
      expect(result.notes).toEqual([]);
    });

    it('drops only the date clause with a cross-day note when the session spans days', () => {
      const result = buildSessionToCollectionQuery(
        session([
          rec(1, at(23, 50), { tags: '#work' }),
          rec(2, at(0, 10, 1), { tags: '#work' }),
        ]),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const parsed = parseCollectionQueryV2(result.query);
      expect(parsed.ids).toEqual([1, 2]);
      expect(parsed.clauses).toEqual([{ search: '', tag: 'work', date: null }]);
      expect(result.notes).toContain('cross-day');
    });

    it('drops only the tag clause with a mixed-tags note when tags differ', () => {
      const expectedDay = formatLocalDateString(at(9));
      const result = buildSessionToCollectionQuery(
        session([
          rec(1, at(9), { tags: '#work' }),
          rec(2, at(10), { tags: '#play' }),
        ]),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(parseCollectionQueryV2(result.query).clauses).toEqual([
        { search: '', tag: null, date: expectedDay },
      ]);
      expect(result.notes).toContain('mixed-tags');
    });

    it('adds no tag clause and no mixed note when nothing is tagged', () => {
      const result = buildSessionToCollectionQuery(
        session([rec(1, at(9)), rec(2, at(10))]),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(parseCollectionQueryV2(result.query).clauses).toHaveLength(1);
      expect(result.notes).not.toContain('mixed-tags');
    });

    it('treats uniform multi-tag sets as mixed (single-tag clause only)', () => {
      const expectedDay = formatLocalDateString(at(9));
      const result = buildSessionToCollectionQuery(
        session([
          rec(1, at(9), { tags: '#a #b' }),
          rec(2, at(10), { tags: '#a #b' }),
        ]),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(parseCollectionQueryV2(result.query).clauses).toEqual([
        { search: '', tag: null, date: expectedDay },
      ]);
      expect(result.notes).toContain('mixed-tags');
    });

    it('stays fully ids-only when every dimension degrades', () => {
      const result = buildSessionToCollectionQuery(
        session([
          rec(1, at(23, 50), { tags: '#work', search_query: 'wasm' }),
          rec(2, at(0, 10, 1), { tags: '#play', search_query: 'vite' }),
        ]),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const parsed = parseCollectionQueryV2(result.query);
      expect(parsed.ids).toEqual([1, 2]);
      expect(parsed.clauses).toEqual([]);
      expect(result.notes).toEqual(
        expect.arrayContaining(['cross-day', 'mixed-tags', 'search-omitted']),
      );
    });

    it('omits search with a note when search terms differ', () => {
      const result = buildSessionToCollectionQuery(
        session([
          rec(1, at(9), { search_query: 'wasm' }),
          rec(2, at(10), { search_query: 'vite' }),
        ]),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const parsed = parseCollectionQueryV2(result.query);
      expect(parsed.clauses).toHaveLength(1);
      expect(parsed.clauses[0]?.search).toBe('');
      expect(result.notes).toContain('search-omitted');
    });

    it('adds no search note when no record ever had a term', () => {
      const result = buildSessionToCollectionQuery(
        session([rec(1, at(9)), rec(2, at(10))]),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.notes).not.toContain('search-omitted');
    });

    it('refuses an empty session with the empty reason', () => {
      expect(buildSessionToCollectionQuery(session([]))).toEqual({
        ok: false,
        reason: 'empty',
        count: 0,
      });
    });

    it(`accepts exactly ${MAX_QUERY_IDS} records`, () => {
      const records = Array.from({ length: MAX_QUERY_IDS }, (_, i) =>
        rec(i + 1, at(9), { tags: '#t' }),
      );
      const result = buildSessionToCollectionQuery(session(records));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(parseCollectionQueryV2(result.query).ids).toHaveLength(MAX_QUERY_IDS);
    });

    it('refuses over-limit sessions with the count and no silent cut', () => {
      const records = Array.from({ length: MAX_QUERY_IDS + 1 }, (_, i) =>
        rec(i + 1, at(9), { tags: '#t' }),
      );
      expect(buildSessionToCollectionQuery(session(records))).toEqual({
        ok: false,
        reason: 'over-limit',
        count: MAX_QUERY_IDS + 1,
      });
    });

    it('warns without blocking when no record is quotable', () => {
      const result = buildSessionToCollectionQuery(
        session([
          rec(1, at(9), { title: '  ' }),
          rec(2, at(10), { title: '' }),
        ]),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(parseCollectionQueryV2(result.query).ids).toEqual([1, 2]);
      expect(result.notes).toContain('quotable-zero');
    });

    it('skips the quotable warning when at least one record has a title', () => {
      const result = buildSessionToCollectionQuery(
        session([
          rec(1, at(9), { title: '' }),
          rec(2, at(10), { title: 'titled' }),
        ]),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.notes).not.toContain('quotable-zero');
    });

    it('honours an injected quotability probe', () => {
      const records = [rec(1, at(9)), rec(2, at(10))];
      const denied = buildSessionToCollectionQuery(session(records), {
        isQuotable: () => false,
      });
      expect(denied.ok).toBe(true);
      if (!denied.ok) return;
      expect(denied.notes).toContain('quotable-zero');
      const allowed = buildSessionToCollectionQuery(session(records), {
        isQuotable: () => true,
      });
      expect(allowed.ok).toBe(true);
      if (!allowed.ok) return;
      expect(allowed.notes).not.toContain('quotable-zero');
    });
  });

  describe('isSessionSaveable', () => {
    it('disables the button for an empty session', () => {
      expect(isSessionSaveable(0)).toBe(false);
    });

    it('allows ordinary and boundary counts', () => {
      expect(isSessionSaveable(1)).toBe(true);
      expect(isSessionSaveable(MAX_QUERY_IDS)).toBe(true);
    });

    it('refuses over-limit counts', () => {
      expect(isSessionSaveable(MAX_QUERY_IDS + 1)).toBe(false);
    });
  });
});
