// src/dashboard/panels/asyncData/__tests__/researchSessionSelection.test.ts
import { describe, expect, it } from 'vitest';
import { expandSelectedIds, summarizeSelection } from '../../../researchSessionSelection.js';
import type { ResearchSession } from '../../../researchSessionAggregate.js';
import { buildSessionTree } from '../../../sessionPathAggregate.js';

function record(id: number, url: string, nav?: string) {
  return { id, url, title: url, domain: 'e.com', tags: null, created_at: id * 1000, nav_source_url: nav ?? null, search_query: null };
}

describe('expandSelectedIds', () => {
  it('session choice expands to all record ids without duplicates', () => {
    const sessions = [{ startAt: 1, endAt: 2, durationMs: 1, records: [record(1, 'https://e.com/a'), record(2, 'https://e.com/b')], topTags: [], topDomains: [], starredCount: 0 }] as ResearchSession[];
    expect(expandSelectedIds(sessions, [{ kind: 'session', sessionIndex: 0 }])).toEqual(new Set([1, 2]));
  });

  it('subtree choice expands to the node and all descendants', () => {
    const sessions = [{ startAt: 1, endAt: 3, durationMs: 2, records: [record(1, 'https://e.com/a'), record(2, 'https://e.com/b', 'https://e.com/a'), record(3, 'https://e.com/c', 'https://e.com/b')], topTags: [], topDomains: [], starredCount: 0 }] as ResearchSession[];
    const trees = sessions.map(buildSessionTree);
    expect(expandSelectedIds(sessions, [{ kind: 'subtree', recordId: 2 }], trees)).toEqual(new Set([2, 3]));
  });

  it('empty selection expands to empty set', () => {
    expect(expandSelectedIds([], [])).toEqual(new Set());
  });
});

describe('summarizeSelection', () => {
  it('counts pages and date range for the confirm dialog', () => {
    const sessions = [{ startAt: 1_000, endAt: 5_000, durationMs: 4_000, records: [record(1, 'https://e.com/a'), record(2, 'https://f.com/b')], topTags: [], topDomains: [], starredCount: 0 }] as ResearchSession[];
    expect(summarizeSelection(sessions, [{ kind: 'session', sessionIndex: 0 }])).toEqual({ pages: 2, earliest: 1_000, latest: 2_000 });
  });
});
