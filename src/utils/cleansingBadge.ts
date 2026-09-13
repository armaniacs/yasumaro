// @layer 0
/**
 * CleansingBadge (PBI 2026-09-11-05, round 4; reason unification PBI 2026-09-11-07,
 * round 5) — single table for the cleansing badge display policy. Previously
 * `hard / keyword / both` reason→text conversion was re-declared in three
 * popup sites and the counts→reason derivation in a background handler.
 *
 * Layer 0 (pure): the message resolver is injected, so background handlers and
 * popup UI share the same policy without a layering violation.
 */

import { resolveCleanseReason } from './contentExtractor/cleansedReason.js';

/** Reason values carried on ContentResponse / savedUrl entries. */
export type CleansedReason = 'hard' | 'keyword' | 'both' | 'none';

export interface CleansingCounts {
  hardStripRemoved?: number;
  keywordStripRemoved?: number;
  totalRemoved?: number;
}

/** i18n keys for the badge text, per reason. */
const BADGE_KEY_BY_REASON: Record<Exclude<CleansedReason, 'none'>, string> = {
  hard: 'cleansedBadgeHard',
  keyword: 'cleansedBadgeKeyword',
  both: 'cleansedBadgeBoth',
};

/** Fallback literals when the message resolver has no entry (test DOMs). */
const BADGE_FALLBACK_BY_REASON: Record<Exclude<CleansedReason, 'none'>, string> = {
  hard: '🧹 Hard',
  keyword: '🧹 Keyword',
  both: '🧹 Both',
};

/**
 * Derive the reason from strip counts — delegates to the single dual-axis
 * owner `resolveCleanseReason` (PBI 2026-09-11-07: the former local copy
 * answered (0,0) with 'both', contradicting the extractor-side 'none').
 * Callers that must not show a badge check the result against 'none'.
 */
export function deriveCleansedReasonFromCounts(counts: CleansingCounts): CleansedReason {
  // ExtractResult['cleansedReason'] is typed optional, but resolveCleanseReason
  // always returns (falls through to 'none') — the ?? documents that guarantee.
  return resolveCleanseReason(counts.hardStripRemoved ?? 0, counts.keywordStripRemoved ?? 0) ?? 'none';
}

/**
 * Badge text for a reason. Returns '' for undefined / 'none' / unknown values
 * (the old switch's default branch kept as a runtime guard).
 */
export function getCleansedBadgeText(
  cleansedReason: CleansedReason | undefined,
  getMessage: (key: string) => string,
): string {
  if (!cleansedReason || cleansedReason === 'none') return '';
  const reason = cleansedReason as Exclude<CleansedReason, 'none'>;
  const key = BADGE_KEY_BY_REASON[reason];
  if (!key) return '';
  return getMessage(key) || BADGE_FALLBACK_BY_REASON[reason] || '';
}

/**
 * Count detail line for the preview badge — "Hard: 3, Keyword: 2" with the
 * i18n key per axis (PBI 2026-09-11-07: was an English literal inline in
 * previewPresenter). Returns '' when nothing was removed.
 * Substitutions go as an array — the getMessage wrapper only expands
 * placeholders for array form.
 */
export function buildCleansingCountDetail(
  counts: CleansingCounts,
  getMessage: (key: string, substitutions?: string | string[]) => string,
): string {
  const hard = counts.hardStripRemoved ?? 0;
  const keyword = counts.keywordStripRemoved ?? 0;
  const details: string[] = [];
  if (hard > 0) details.push(getMessage('cleansingDetailHard', [String(hard)]) || `Hard: ${hard}`);
  if (keyword > 0) details.push(getMessage('cleansingDetailKeyword', [String(keyword)]) || `Keyword: ${keyword}`);
  return details.join(', ');
}
