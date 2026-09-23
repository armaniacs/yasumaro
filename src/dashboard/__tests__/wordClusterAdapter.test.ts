import { describe, it, expect } from 'vitest';
import {
  buildWordClusterRows,
  SUMMARY_FALLBACK_LITERAL,
  type WordClusterSourceRow,
} from '../wordClusterAdapter.js';
import { parseTagsForDisplay } from '../../utils/tagUtils.js';
import { MAX_TAGS_PER_RECORD } from '../../utils/computeLimits.js';

function row(partial: Partial<WordClusterSourceRow>): WordClusterSourceRow {
  return partial;
}

describe('wordClusterAdapter — pseudo-tag building', () => {
  it('merges summary and title keywords into a #kw pseudo-tags string', () => {
    const { rows } = buildWordClusterRows([
      row({ title: 'Machine learning notes', summary: 'Neural networks explained clearly' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(parseTagsForDisplay(rows[0]!.tags)).toEqual(
      expect.arrayContaining(['neural', 'networks', 'explained', 'clearly', 'machine', 'learning', 'notes']),
    );
  });

  it('dedupes keywords shared between summary and title (summary first)', () => {
    const { rows } = buildWordClusterRows([
      row({ title: 'Rust ownership', summary: 'Rust ownership rules prevent data races' }),
    ]);
    expect(rows).toHaveLength(1);
    const tags = parseTagsForDisplay(rows[0]!.tags);
    expect(tags.filter((t) => t === 'rust')).toHaveLength(1);
    expect(tags[0]).toBe('rust');
  });

  it('round-trips through parseTagsForDisplay for every keyword', () => {
    const { rows } = buildWordClusterRows([
      row({ title: 'TypeScript strict mode', summary: '型推論とコンパイル時間の話' }),
    ]);
    for (const r of rows) {
      for (const tag of parseTagsForDisplay(r.tags)) {
        expect(`#${tag}`).toBeTruthy();
        expect(tag).toMatch(/^[\p{L}\p{N}]+$/u);
      }
    }
  });
});

describe('wordClusterAdapter — summary exclusion rules', () => {
  it('counts null summaries as excluded but still extracts from the title', () => {
    const result = buildWordClusterRows([row({ title: 'Fallback string handling', summary: null })]);
    expect(result.summaryExcludedCount).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(parseTagsForDisplay(result.rows[0]!.tags)).toContain('fallback');
  });

  it('counts the exact fallback literal as excluded (trimmed comparison)', () => {
    const result = buildWordClusterRows([
      row({ title: 'Retry logic', summary: SUMMARY_FALLBACK_LITERAL }),
      row({ title: 'Cache warming', summary: '  Summary not available.  ' }),
    ]);
    expect(result.summaryExcludedCount).toBe(2);
    expect(result.rows).toHaveLength(2);
  });

  it('counts whitespace-only summaries as excluded', () => {
    const result = buildWordClusterRows([row({ title: 'Index page', summary: '   ' })]);
    expect(result.summaryExcludedCount).toBe(1);
    expect(result.rows).toHaveLength(1);
  });

  it('does not count usable summaries as excluded', () => {
    const result = buildWordClusterRows([
      row({ title: 'Title', summary: 'A real AI summary with content' }),
    ]);
    expect(result.summaryExcludedCount).toBe(0);
  });
});

describe('wordClusterAdapter — skipped rows', () => {
  it('skips rows where both summary and title are unusable', () => {
    const result = buildWordClusterRows([
      row({ title: null, summary: null }),
      row({ title: '', summary: SUMMARY_FALLBACK_LITERAL }),
      row({ title: '   ', summary: undefined }),
    ]);
    expect(result.skippedRows).toBe(3);
    expect(result.summaryExcludedCount).toBe(3);
    expect(result.rows).toHaveLength(0);
  });

  it('does not skip rows with a usable title even when the summary failed', () => {
    const result = buildWordClusterRows([
      row({ title: 'Usable title only', summary: null }),
    ]);
    expect(result.skippedRows).toBe(0);
    expect(result.rows).toHaveLength(1);
  });

  it('emits no row when text exists but yields no keywords, without counting it as skipped', () => {
    const result = buildWordClusterRows([
      row({ title: '...', summary: 'the and of to in on a' }),
    ]);
    expect(result.skippedRows).toBe(0);
    expect(result.rows).toHaveLength(0);
  });
});

describe('wordClusterAdapter — cap and empty input', () => {
  it('caps merged keywords per record at MAX_TAGS_PER_RECORD with summary precedence', () => {
    const summaryWords = Array.from({ length: 60 }, (_, i) => `sum${i}`).join(' ');
    const titleWords = Array.from({ length: 60 }, (_, i) => `tit${i}`).join(' ');
    const result = buildWordClusterRows([row({ title: titleWords, summary: summaryWords })]);
    expect(result.rows).toHaveLength(1);
    const tags = parseTagsForDisplay(result.rows[0]!.tags);
    expect(tags).toHaveLength(MAX_TAGS_PER_RECORD);
    expect(tags[0]).toBe('sum0');
    expect(tags).not.toContain('tit0');
  });

  it('returns empty counts for an empty rows array', () => {
    expect(buildWordClusterRows([])).toEqual({ rows: [], summaryExcludedCount: 0, skippedRows: 0 });
  });

  it('is deterministic for the same input', () => {
    const rows: WordClusterSourceRow[] = [
      row({ title: '自然言語処理入門', summary: 'Transformer architecture overview' }),
      row({ title: null, summary: SUMMARY_FALLBACK_LITERAL }),
      row({ title: 'Compiler design', summary: null }),
    ];
    expect(buildWordClusterRows(rows)).toEqual(buildWordClusterRows(rows));
  });
});
