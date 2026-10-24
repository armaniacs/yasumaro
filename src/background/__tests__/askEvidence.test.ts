/**
 * askEvidence.test.ts
 * PBI 2026-10-24-04 — independent pure module for evidence shaping.
 * Pins: rows-to-evidence assembly (scope-match, select, truncate),
 * the never-raw snippet rule (cleansed content only), snippet truncation,
 * the fail-closed context head, and the no-evidence widening suggestion.
 */
import { describe, it, expect } from 'vitest';
import {
  ASK_EVIDENCE_COUNT,
  ASK_SNIPPET_MAX_CHARS,
  assembleAskEvidence,
  buildEvidenceContext,
  buildWidenSuggestion,
  matchesCollectionScope,
  nameEvidenceGap,
  pickEvidenceRows,
  truncateSnippet,
} from '../askEvidence.js';
import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';

function makeRow(id: number, overrides: Partial<BrowsingLogRecord> = {}): BrowsingLogRecord {
  return {
    id,
    url: `https://example${id}.com/page`,
    title: `Example ${id}`,
    created_at: 1700000000000 + id,
    content: `Cleansed body ${id}`,
    ...overrides,
  };
}

describe('askEvidence', () => {
  describe('pickEvidenceRows', () => {
    it.each([
      ['cleansed content is quoted', { content: 'Cleansed body', summary: 'AI summary' }, 'Cleansed body'],
      ['AI summary is the fallback', { content: null, summary: 'AI summary' }, 'AI summary'],
      ['no quotable text is skipped', { content: null, summary: null }, null],
    ])('%s', (_name, overrides, expected) => {
      const { evidence } = pickEvidenceRows([makeRow(1, overrides)], () => 'allowed');
      if (expected === null) {
        expect(evidence).toEqual([]);
      } else {
        expect(evidence).toHaveLength(1);
        expect(evidence[0]?.snippet).toBe(expected);
      }
    });

    it('takes at most the evidence count and keeps the search order', () => {
      const rows = [1, 2, 3, 4, 5].map((id) => makeRow(id));
      const { evidence } = pickEvidenceRows(rows, () => 'allowed');
      expect(ASK_EVIDENCE_COUNT).toBe(3);
      expect(evidence.map((e) => e.id)).toEqual([1, 2, 3]);
    });

    it('skips rows whose domain the user opted out of AI processing', () => {
      const rows = [makeRow(1), makeRow(2), makeRow(3)];
      const { evidence, excludedNoSummary } = pickEvidenceRows(rows, (url) =>
        url.includes('example2.com') ? 'no-summary' : 'allowed',
      );
      expect(excludedNoSummary).toBe(1);
      expect(evidence.map((e) => e.id)).toEqual([1, 3]);
    });

    it('truncates long cleansed text at the snippet cap', () => {
      const long = 'あ'.repeat(ASK_SNIPPET_MAX_CHARS + 10);
      const { evidence } = pickEvidenceRows([makeRow(1, { content: long })], () => 'allowed');
      expect(evidence[0]?.snippet?.length).toBe(ASK_SNIPPET_MAX_CHARS + 1);
      expect(evidence[0]?.snippet?.endsWith('…')).toBe(true);
    });
  });

  describe('truncateSnippet', () => {
    it('returns null for empty or whitespace-only text', () => {
      expect(truncateSnippet('', 100)).toBeNull();
      expect(truncateSnippet('   ', 100)).toBeNull();
      expect(truncateSnippet(null, 100)).toBeNull();
    });

    it('returns the trimmed text when it fits', () => {
      expect(truncateSnippet('  body  ', 100)).toBe('body');
    });
  });

  describe('buildEvidenceContext', () => {
    it('carries the question and numbered excerpts with URLs', () => {
      const context = buildEvidenceContext('この件について教えて', [
        { id: 1, title: 'A', url: 'https://a.example', snippet: '引用1' },
        { id: 2, title: 'B', url: 'https://b.example', snippet: '引用2' },
      ]);
      expect(context).toContain('質問: この件について教えて');
      expect(context).toContain('[1] A');
      expect(context).toContain('https://a.example');
      expect(context).toContain('[2] B');
      // The fail-closed instruction is in the prompt head.
      expect(context).toContain('分かりません');
    });
  });

  describe('buildWidenSuggestion', () => {
    it('names the widen action for each no-evidence reason', () => {
      expect(buildWidenSuggestion('no_matches')).toContain('検索語を短く');
      expect(buildWidenSuggestion('no_quotable')).toContain('要約');
      expect(buildWidenSuggestion('domain_excluded')).toContain('対象外');
    });
  });

  describe('matchesCollectionScope', () => {
    it('filters rows by tag membership and the local day range', () => {
      const scope = { tag: 'rust', date: null };
      expect(matchesCollectionScope(makeRow(1, { tags: 'rust, wasm' }), scope, null)).toBe(true);
      expect(matchesCollectionScope(makeRow(1, { tags: 'wasm' }), scope, null)).toBe(false);
    });

    it('drops rows outside the saved day range', () => {
      const scope = { tag: null, date: '2026-10-23' };
      const dayRange = { since: 1794380400000, until: 1794466740999 };
      expect(matchesCollectionScope(makeRow(1, { created_at: 1794400000000 }), scope, dayRange)).toBe(true);
      expect(matchesCollectionScope(makeRow(1, { created_at: 1700000000000 }), scope, dayRange)).toBe(false);
    });
  });

  describe('assembleAskEvidence', () => {
    it('applies the scope filter and selects evidence in one call', () => {
      const rows = [
        makeRow(1, { tags: 'rust' }),
        makeRow(2, { tags: 'wasm' }),
        makeRow(3, { tags: 'rust, ai' }),
      ];
      const result = assembleAskEvidence({
        rows,
        scope: { tag: 'rust', date: null },
        dayRange: null,
        resolveDomainPolicy: () => 'allowed',
      });
      expect(result.scopedCount).toBe(2);
      expect(result.evidence.map((e) => e.id)).toEqual([1, 3]);
      expect(result.excludedNoSummary).toBe(0);
    });

    it('counts excluded domains while selecting the remaining rows', () => {
      const rows = [makeRow(1), makeRow(2), makeRow(3)];
      const result = assembleAskEvidence({
        rows,
        scope: { tag: null, date: null },
        dayRange: null,
        resolveDomainPolicy: (url) => (url.includes('example2.com') ? 'no-summary' : 'allowed'),
      });
      expect(result.excludedNoSummary).toBe(1);
      expect(result.scopedCount).toBe(3);
      expect(result.evidence.map((e) => e.id)).toEqual([1, 3]);
    });

    it('returns an empty evidence set when no rows survive the scope', () => {
      const result = assembleAskEvidence({
        rows: [makeRow(1, { tags: 'wasm' })],
        scope: { tag: 'rust', date: null },
        dayRange: null,
        resolveDomainPolicy: () => 'allowed',
      });
      expect(result.evidence).toEqual([]);
      expect(result.scopedCount).toBe(0);
    });

    it('honours an explicit max count instead of the default', () => {
      const rows = [1, 2, 3, 4, 5].map((id) => makeRow(id));
      const result = assembleAskEvidence({
        rows,
        scope: { tag: null, date: null },
        dayRange: null,
        resolveDomainPolicy: () => 'allowed',
        maxCount: 1,
      });
      expect(result.evidence).toHaveLength(1);
    });
  });

  describe('nameEvidenceGap', () => {
    it('returns null when evidence exists', () => {
      expect(nameEvidenceGap(2, 0, 2)).toBeNull();
    });

    it('prefers the domain exclusion over the other reasons', () => {
      expect(nameEvidenceGap(0, 1, 3)).toBe('domain_excluded');
      expect(nameEvidenceGap(0, 0, 2)).toBe('no_quotable');
      expect(nameEvidenceGap(0, 0, 0)).toBe('no_matches');
    });
  });
});
