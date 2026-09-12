import { describe, it, expect } from 'vitest';
import { selectTagFilter } from '../queryPlan.js';

describe('selectTagFilter — path-aware mapping (PBI 2026-09-12-39)', () => {
  it.each([
    ['plain', true],
    ['plain', false],
  ])('plain path: %s engine → %s semantics (rides on spec)', (path, fts) => {
    const longTag = 'typescript';
    const result = selectTagFilter(longTag, path as 'plain', fts);
    expect(result).not.toBeNull();
    if (fts) {
      expect(result!.condition).toContain('IN (SELECT rowid FROM browsing_logs_fts WHERE tags MATCH ?)');
    } else {
      expect(result!.condition).toContain('tags LIKE ?');
    }
  });

  it('fts path: long tag uses b.id qualification even when the spec lacks it', () => {
    const result = selectTagFilter('typescript', 'fts', true);
    expect(result!.condition).toContain('b.id IN (SELECT rowid FROM browsing_logs_fts WHERE tags MATCH ?)');
  });

  it('fts path: non-FTS engine gets tags LIKE (no MATCH against a missing table)', () => {
    // Direct-call protection: handleSearchFts on a non-FTS engine must get
    // tags LIKE ? — the round-12 hardcode `fts5Available: true` was blind to this.
    const result = selectTagFilter('typescript', 'fts', false);
    expect(result!.condition).toContain('tags LIKE ?');
    expect(result!.condition).not.toContain('MATCH');
  });

  it('like path: long tag gets tags LIKE even on an FTS-capable engine', () => {
    // Cross case: engine is FTS-capable, text is short → LIKE path. The spec
    // would derive trigram MATCH, which the LIKE SQL cannot run.
    const result = selectTagFilter('typescript', 'like', true);
    expect(result!.condition).toContain('tags LIKE ?');
    expect(result!.condition).not.toContain('MATCH');
  });

  it('like path: short tag also gets tags LIKE (non-FTS engine)', () => {
    const result = selectTagFilter('ru', 'like', false);
    expect(result!.condition).toContain('tags LIKE ?');
  });

  it('undefined/empty tag returns null on all paths', () => {
    expect(selectTagFilter(undefined, 'plain', true)).toBeNull();
    expect(selectTagFilter(undefined, 'fts', true)).toBeNull();
    expect(selectTagFilter(undefined, 'like', true)).toBeNull();
    expect(selectTagFilter('', 'fts', true)).toBeNull();
  });
});
