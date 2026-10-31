/**
 * selectionText.ts
 * Selection-text normalization + cap (PBI 2026-10-31-03).
 *
 * The selection a user highlights on a page becomes a record's `content`, so
 * it must carry the same one-line sanitize every Markdown output already
 * applies: markdownFormatter.normalizeSingleLine is the single owner of the
 * line-separator (U+2028/U+2029/U+0085) replacement and the run-of-spaces
 * compression — reusing it here keeps the selection capture from forking that
 * behavior (the markdown injection-prevention pin tests guard it).
 *
 * The 10,000-char cap is applied after normalization: the normalized text is
 * what the pipeline stores, so the cap bounds the stored form, not the raw
 * selection a hostile page could inflate with separator characters.
 */

import { normalizeSingleLine } from './markdownFormatter.js';

/** Maximum stored length of a recorded selection (PBI 2026-10-31-03: truncate, never reject). */
export const SELECTION_MAX_CHARS = 10000;

/**
 * Marker value written to the saved row's `content_origin` column when the
 * record's content came from a selection. NULL means the page/normal path.
 */
export const SELECTION_CONTENT_ORIGIN = 'selection';

/**
 * Normalize a captured selection for the record pipeline: one line, no run of
 * spaces, trimmed, and capped at SELECTION_MAX_CHARS. An empty selection
 * normalizes to '' — callers treat that as "no selection" and fall back to
 * the page record.
 */
export function normalizeSelectionText(raw: string): string {
  return normalizeSingleLine(raw).slice(0, SELECTION_MAX_CHARS);
}
