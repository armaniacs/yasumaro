/**
 * regenerateUpdateFields.ts — the UPDATE whitelist for REGENERATE_SUMMARY
 * (PBI 2026-09-22-04).
 *
 * Named, testable projection: only columns a re-extraction/re-summarization
 * legitimately replaces. Everything else on the row is immutable by design:
 *
 * - identity/history: id, url, title, domain, created_at, record_type
 *   (a regenerate must not relabel an 'auto' row as 'manual')
 * - user state: is_starred, is_deleted, obsidian_synced, gist_synced
 *   (side-effect skips mean sync flags never change during regenerate)
 * - visit metrics: visit_duration, scroll_ratio, obsidian_duration_ms
 *   (regenerate has no visit and no Obsidian write)
 *
 * `content` is included as-is: the caller maps records through
 * `toBrowsingLogRecord(contentEnabled)`, which already nulls content when
 * the privacy setting is off — so honoring contentEnabled needs no extra
 * branch here.
 */

import type { BrowsingLogRecord } from '../../../utils/sqlite-types.js';

/** Columns a regenerate UPDATE may write (column-name = record-field exact). */
export const REGENERATE_UPDATE_FIELDS = [
  'summary',
  'content',
  'tags',
  'page_bytes',
  'candidate_bytes',
  'original_bytes',
  'cleansed_bytes',
  'ai_summary_original_bytes',
  'ai_summary_cleansed_bytes',
  'extracted_sentences_bytes',
  'extracted_sentences_original_bytes',
  'masked_count',
  'cleansed_reason',
  'ai_provider',
  'ai_model',
  'ai_duration_ms',
  'sent_tokens',
  'received_tokens',
  'original_tokens',
  'cleansed_tokens',
  'fallback_triggered',
  'fallback_reason',
] as const satisfies ReadonlyArray<keyof BrowsingLogRecord>;

export type RegenerateUpdateFields = (typeof REGENERATE_UPDATE_FIELDS)[number];

/** String-literal union of whitelist keys (for Partial delete-safety at call sites). */
export type RegenerateUpdateFieldKey = RegenerateUpdateFields;

/**
 * Project a freshly-mapped record onto the regenerate whitelist.
 * Keys are taken from the mapped record even when its value is null/undefined
 * so the UPDATE clears stale diagnostics (e.g. an old summary when the new AI
 * call returned none).
 */
export function buildRegenerateUpdateFields(
  record: BrowsingLogRecord,
): Record<RegenerateUpdateFields, BrowsingLogRecord[RegenerateUpdateFields]> {
  const out = {} as Record<RegenerateUpdateFields, BrowsingLogRecord[RegenerateUpdateFields]>;
  for (const field of REGENERATE_UPDATE_FIELDS) {
    out[field] = record[field];
  }
  return out;
}
