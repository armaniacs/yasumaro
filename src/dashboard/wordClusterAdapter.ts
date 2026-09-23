/**
 * wordClusterAdapter.ts
 * Bridges stored rows into the existing tag-cooccurrence pipeline
 * (PBI 2026-09-24-07). For each row it extracts keywords from the AI summary
 * (when usable) and the page title, then emits a pseudo-tags string
 * "#kw1 #kw2 ..." shaped exactly like a stored tags value, so
 * computeTagCooccurrenceHybrid / narrowEntriesToTopTagsHybrid need no changes.
 *
 * Exclusion rules (PBI acceptance criteria):
 * - summary === 'Summary not available.' (the AI-failure fallback literal,
 *   compared on the trimmed value) and null/empty/whitespace summaries are
 *   excluded from summary extraction but counted; the title is still used.
 * - rows with neither a usable summary nor a usable title are skipped
 *   entirely and counted as skipped.
 * - rows whose text yields no keywords emit no pseudo-tag row (they add no
 *   nodes or edges) and are not counted as skipped — the "records exist but
 *   zero keywords survived filtering" case surfaces as the panel's distinct
 *   empty state.
 */

import { extractKeywords } from './keywordExtractor.js';
import { MAX_TAGS_PER_RECORD } from '../utils/computeLimits.js';

/** Literal stored when AI summary generation failed (see sqlite-types summary). */
export const SUMMARY_FALLBACK_LITERAL = 'Summary not available.';

export interface WordClusterSourceRow {
  title?: string | null;
  summary?: string | null;
}

export interface WordClusterAdapterResult {
  /** Pseudo-tag rows compatible with Array<{ tags?: string | null }> pipelines. */
  rows: Array<{ tags: string }>;
  /** Rows whose summary was unusable (null, empty, whitespace, or the fallback literal). Title still used. */
  summaryExcludedCount: number;
  /** Rows skipped entirely — neither summary nor title usable. */
  skippedRows: number;
}

function isUsableSummary(summary: string | null | undefined): summary is string {
  if (typeof summary !== 'string') return false;
  const trimmed = summary.trim();
  // Trimmed comparison: trailing-whitespace variants of the literal are the
  // same AI-failure artifact, and an empty summary has no content either way.
  return trimmed.length > 0 && trimmed !== SUMMARY_FALLBACK_LITERAL;
}

function isUsableTitle(title: string | null | undefined): title is string {
  return typeof title === 'string' && title.trim().length > 0;
}

export function buildWordClusterRows(rows: Array<WordClusterSourceRow>): WordClusterAdapterResult {
  const out: Array<{ tags: string }> = [];
  let summaryExcludedCount = 0;
  let skippedRows = 0;

  for (const row of rows) {
    // WHY: direct predicate calls in the extraction ternaries (not boolean
    // aliases) — TS narrows user-defined type predicates only at the point
    // of use, so the alias form would need a cast.
    const summaryUsable = isUsableSummary(row.summary);
    const titleUsable = isUsableTitle(row.title);
    if (!summaryUsable) summaryExcludedCount += 1;
    if (!summaryUsable && !titleUsable) {
      skippedRows += 1;
      continue;
    }

    // Summary first: it is the denser text, so under the per-record cap the
    // summary's keywords win the slots and the title fills the remainder.
    // The extractor dedupes per call; this second pass dedupes across calls.
    const merged: string[] = [];
    const seen = new Set<string>();
    const summaryKeywords = isUsableSummary(row.summary) ? extractKeywords(row.summary) : [];
    const titleKeywords = isUsableTitle(row.title) ? extractKeywords(row.title) : [];
    for (const keyword of [...summaryKeywords, ...titleKeywords]) {
      if (seen.has(keyword)) continue;
      seen.add(keyword);
      merged.push(keyword);
      if (merged.length >= MAX_TAGS_PER_RECORD) break;
    }

    if (merged.length === 0) continue;
    out.push({ tags: merged.map((keyword) => `#${keyword}`).join(' ') });
  }

  return { rows: out, summaryExcludedCount, skippedRows };
}
