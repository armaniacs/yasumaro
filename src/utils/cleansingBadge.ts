/**
 * CleansingBadge (PBI 2026-09-11-05) — single table for the cleansing badge
 * display policy. Previously `hard / keyword / both` reason→text conversion
 * was re-declared in three popup sites and the counts→reason derivation in a
 * background handler; a new reason value or key rename had to be applied in
 * four places.
 *
 * Layer 0 (pure): the message resolver is injected, so background handlers and
 * popup UI share the same policy without a layering violation.
 */

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
 * Derive the reason from strip counts — the single copy of the
 * hard/keyword/both policy (was duplicated in systemHandlers).
 * Returns 'none' when nothing was removed.
 */
export function deriveCleansedReasonFromCounts(counts: CleansingCounts): Exclude<CleansedReason, 'none'> {
  const hard = (counts.hardStripRemoved ?? 0) > 0;
  const keyword = (counts.keywordStripRemoved ?? 0) > 0;
  if (hard && keyword) return 'both';
  if (hard) return 'hard';
  if (keyword) return 'keyword';
  return 'both';
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
