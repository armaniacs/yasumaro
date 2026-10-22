// @layer 0 — Foundation (no imports)
/**
 * degradedSummary.ts
 *
 * Degraded-summary generator for the cost-aware cascade (PBI 2026-10-23-03).
 * When the remote quota is exhausted, the send must not stop: the record
 * keeps a title + opening slice instead, and the degradation is visible in
 * the note. This is a pure formatter — the seam that calls it decides when
 * the cascade degrades.
 *
 * Boundary contract: empty/NaN/negative inputs fail closed to the title-only
 * form, so a metric the page never produced cannot poison the slice.
 */

/** Short cap for the opening slice, distinct from the remote content limit. */
export const DEGRADED_SUMMARY_CHARS = 120;
/** Note appended so the degradation is visible in the panel and the ledger. */
export const DEGRADED_SUMMARY_NOTE = '（予算上限のため要約を省略しました）';

export function degradedSummary(title: string, content: string, chars: number = DEGRADED_SUMMARY_CHARS): string {
    const safeChars = Number.isFinite(chars) && chars > 0 ? chars : DEGRADED_SUMMARY_CHARS;
    const cleanTitle = (title ?? '').trim();
    const head = typeof content === 'string' ? content.trim().substring(0, safeChars).trim() : '';
    const parts = [cleanTitle, head].filter((p) => p.length > 0);
    const body = parts.join(' ― ');
    return body.length > 0 ? `${body} ${DEGRADED_SUMMARY_NOTE}` : `${cleanTitle} ${DEGRADED_SUMMARY_NOTE}`.trim();
}
