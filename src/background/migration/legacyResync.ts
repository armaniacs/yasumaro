/**
 * legacyResync.ts
 * SQLite → legacy chrome.storage.local resync (MANUAL-ONLY, PBI 22).
 *
 * Background: when LEGACY_DUAL_WRITE is disabled, saveMetadataStep drops the
 * legacy write and no resync path exists, so records accumulated only in
 * SQLite are invisible to legacy readers (savedUrlsWithTimestamps). This
 * module closes that gap in the reverse direction of `backfillMetadata`
 * (which is chrome.storage → SQLite and must NOT be merged with this job).
 *
 * Trigger policy: MANUAL-ONLY. This function is called explicitly — via the
 * `resync_legacy` diagnostics action or MigrationService.resyncLegacyStore().
 * It is never auto-run on startup or on flag changes: an automatic resync
 * writing legacy storage on upgrade is riskier, and the dual-write flag is
 * currently OFF by default. The function deliberately does NOT consult the
 * LEGACY_DUAL_WRITE flag — the explicit user trigger is the gate.
 *
 * Safety properties:
 * - Bounded: at most `maxRecords` rows are read (created_at DESC) and
 *   written; invalid values fall back to the default, oversized values are
 *   capped — no unbounded loops.
 * - Idempotent: every write goes through saveSavedUrlEntryMetadata keyed by
 *   URL with refreshTimestamp:false, so re-running merges the same patch and
 *   never duplicates entries or churns timestamps.
 * - Lock-safe: saveSavedUrlEntryMetadata uses withOptimisticLock CAS, the
 *   same discipline as the pipeline and the pending-write retry queue, so a
 *   concurrent new recording cannot be lost.
 */

import { addLog, LogType } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errorUtils.js';
import type { SqliteClient } from '../sqlite/offscreenGateway.js';
import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';
import {
  saveSavedUrlEntryMetadata,
  type SavedUrlEntryMetadataPatch,
} from '../../utils/storage/savedUrlRepository.js';

/** Sane default bound for one manual resync run. */
export const DEFAULT_LEGACY_RESYNC_MAX_RECORDS = 1000;

/** Hard ceiling so a caller cannot request an unbounded run. */
export const MAX_LEGACY_RESYNC_MAX_RECORDS = 5000;

export interface LegacyResyncOptions {
  /** Maximum SQLite rows to resync (newest first). Defaults to 1000, capped at 5000. */
  maxRecords?: number;
}

export interface LegacyResyncResult {
  /** Rows read from SQLite in this run. */
  examined: number;
  /** Rows successfully merged into the legacy store. */
  written: number;
  /** Rows skipped (missing URL or per-row write failure). */
  skipped: number;
  /** Total matching rows in SQLite (may exceed `examined` when bounded). */
  total: number;
}

function resolveMaxRecords(requested: number | undefined): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested) || requested <= 0) {
    return DEFAULT_LEGACY_RESYNC_MAX_RECORDS;
  }
  return Math.min(Math.floor(requested), MAX_LEGACY_RESYNC_MAX_RECORDS);
}

/**
 * Split a SQLite `tags` TEXT column back into a tag array. Accepts both the
 * legacy comma form (`a, b`, written by mapLegacyEntryToRecord) and the
 * SQLite hash form (`#a #b`, written by toBrowsingLogRecord).
 */
function parseTagsColumn(tags: string | null | undefined): string[] | undefined {
  if (typeof tags !== 'string' || tags.trim() === '') return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of tags.split(/[\s,]+/)) {
    const tag = part.startsWith('#') ? part.slice(1) : part;
    if (tag === '' || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Map a SQLite BrowsingLogRecord to a legacy metadata patch — the exact
 * reverse of mapLegacyEntryToRecord(). Fields with no SQLite column
 * (recordType, aiSummaryCleansedElements/Reason(s)) cannot be restored and
 * are omitted rather than invented. maskedCount follows toMetadataPatch
 * semantics (only positive values are stored).
 */
export function mapSqliteRecordToLegacyPatch(record: BrowsingLogRecord): SavedUrlEntryMetadataPatch {
  const patch: SavedUrlEntryMetadataPatch = {};
  const set = <K extends keyof SavedUrlEntryMetadataPatch>(key: K, value: SavedUrlEntryMetadataPatch[K] | null | undefined): void => {
    if (value !== null && value !== undefined) patch[key] = value as SavedUrlEntryMetadataPatch[K];
  };

  const tags = parseTagsColumn(record.tags);
  if (tags !== undefined) patch.tags = tags;
  set('aiSummary', typeof record.summary === 'string' && record.summary !== '' ? record.summary : undefined);
  set('content', record.content);
  // WHY: the legacy store types cleansedReason as a narrow union while
  // SQLite holds free-form text — only known literals round-trip, anything
  // else is omitted rather than written as an invalid value.
  if (record.cleansed_reason === 'hard' || record.cleansed_reason === 'keyword'
    || record.cleansed_reason === 'both' || record.cleansed_reason === 'none') {
    patch.cleansedReason = record.cleansed_reason;
  }
  if (record.masked_count !== null && record.masked_count !== undefined && record.masked_count > 0) {
    patch.maskedCount = record.masked_count;
  }
  set('sentTokens', record.sent_tokens);
  set('receivedTokens', record.received_tokens);
  set('originalTokens', record.original_tokens);
  set('cleansedTokens', record.cleansed_tokens);
  set('pageBytes', record.page_bytes);
  set('candidateBytes', record.candidate_bytes);
  set('originalBytes', record.original_bytes);
  set('cleansedBytes', record.cleansed_bytes);
  set('aiSummaryOriginalBytes', record.ai_summary_original_bytes);
  set('aiSummaryCleansedBytes', record.ai_summary_cleansed_bytes);
  set('aiProvider', record.ai_provider);
  set('aiModel', record.ai_model);
  set('aiDuration', record.ai_duration_ms);
  set('obsidianDuration', record.obsidian_duration_ms);
  patch.fallbackTriggered = record.fallback_triggered === 1;
  return patch;
}

/**
 * Manually resync recent SQLite records into the legacy
 * `savedUrlsWithTimestamps` store. See the module doc comment for the
 * trigger policy and safety properties.
 */
export async function resyncLegacyFromSqlite(
  sqliteClient: Pick<SqliteClient, 'query'>,
  options: LegacyResyncOptions = {},
): Promise<LegacyResyncResult> {
  const maxRecords = resolveMaxRecords(options.maxRecords);
  addLog(LogType.INFO, 'LegacyResync: starting (manual)', { maxRecords });

  const queryResult = await sqliteClient.query({
    limit: maxRecords,
    orderBy: 'created_at',
    orderDir: 'DESC',
  });
  if (!queryResult.success) {
    const message = queryResult.error.message;
    addLog(LogType.ERROR, 'LegacyResync: SQLite query failed', { error: message });
    throw new Error(message);
  }
  const rows = queryResult.data.rows;
  const total = queryResult.data.total;

  let written = 0;
  let skipped = 0;
  for (const record of rows) {
    if (typeof record.url !== 'string' || record.url === '') {
      skipped++;
      continue;
    }
    try {
      await saveSavedUrlEntryMetadata(record.url, mapSqliteRecordToLegacyPatch(record), {
        refreshTimestamp: false,
        mergeTags: true,
        createIfMissing: true,
        timestamp: record.created_at,
      });
      written++;
    } catch (error) {
      skipped++;
      addLog(LogType.WARN, 'LegacyResync: row write failed, continuing', {
        url: record.url,
        error: errorMessage(error),
      });
    }
  }

  const result: LegacyResyncResult = { examined: rows.length, written, skipped, total };
  addLog(LogType.INFO, 'LegacyResync: completed (manual)', result);
  return result;
}
