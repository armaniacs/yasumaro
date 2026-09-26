/**
 * commonStorageFields.ts
 * Single source of truth for RecordingContext → storage field extraction.
 * Previously duplicated in saveMetadataStep.ts and BrowsingLogRecordMapper.ts.
 */

import type { RecordingContext } from '../types.js';
import type { BrowsingLogRecord } from '../../../utils/sqlite-types.js';
import type { SavedUrlEntryMetadataPatch } from '../../../utils/storage/savedUrlRepository.js';
import type { AiSummaryCleansedReason } from '../../../utils/commonTypes.js';
import { extractDomain } from '../../../utils/domainUtils.js';
import {
  MAX_BYTE_STAT_BYTES,
  MAX_CLEANSED_ELEMENTS,
  MAX_CLEANSED_REASON_CHARS,
  MAX_CLEANSED_REASONS,
} from '../../../messaging/validators.js';

export interface CommonStorageFields {
  url: string;
  title: string | null;
  content: string | null;
  summary: string | null;
  tagsArray: string[] | null;
  providerName: string | null;
  modelName: string | null;
  privacyMode: string | null;
  maskedCount: number | null;
  maskedCountForPatch: number | undefined;
  sentTokens: number | null;
  receivedTokens: number | null;
  originalTokens: number | null;
  cleansedTokens: number | null;
  pageBytes: number | null;
  candidateBytes: number | null;
  originalBytes: number | null;
  cleansedBytes: number | null;
  aiSummaryOriginalBytes: number | null;
  aiSummaryCleansedBytes: number | null;
  aiSummaryCleansedElements: number | null;
  aiSummaryCleansedReason: string | null;
  aiSummaryCleansedReasons: string[] | null;
  fallbackTriggered: boolean;
  fallbackTriggeredInt: 0 | 1;
  /** PBI 05: フォールバック発動理由（未発動時は null） */
  fallbackReason: string | null;
  // PBI 03: opt-in navigation trail. Kept out of toMetadataPatch on purpose —
  // the legacy chrome.storage side has no column for it and never held one.
  navSourceUrl: string | null;
  searchQuery: string | null;
  aiDuration: number | null;
  obsidianDuration: number | null;
  extractedSentencesBytes: number | null;
  extractedSentencesOriginalBytes: number | null;
  cleansedReason: string | null;
  recordType: string;

  /**
   * Builds the SQLite BrowsingLogRecord shape. `contentEnabled` gates whether
   * the (potentially large) page content is included, mirroring the
   * CONTENT_STORAGE_ENABLED setting check previously duplicated in the mapper.
   */
  toBrowsingLogRecord(contentEnabled: boolean): BrowsingLogRecord;

  /**
   * Builds the legacy chrome.storage metadata patch. Falsy/empty-collection
   * fields are omitted (key absent) rather than set to null/false, matching
   * applyMetadataPatch's "undefined means don't touch" semantics and avoiding
   * clobbering existing entry data with empty values.
   */
  toMetadataPatch(): SavedUrlEntryMetadataPatch;
}

/**
 * Second-layer guard for ByteStats: the message validator rejects malformed
 * wire values, but internal-only paths (re-extraction, offline retry) never
 * cross it, so the mapper clamps instead of trusting bare casts. Bounds are
 * shared with the validator so the two layers cannot drift apart.
 */
function clampByteStat(value: unknown, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(Math.max(Math.trunc(value), 0), max);
}

function clampCleansedReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.length > MAX_CLEANSED_REASON_CHARS ? value.slice(0, MAX_CLEANSED_REASON_CHARS) : value;
}

function clampCleansedReasons(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const kept: string[] = [];
  for (const el of value) {
    if (kept.length >= MAX_CLEANSED_REASONS) break;
    if (typeof el !== 'string') continue;
    kept.push(el.length > MAX_CLEANSED_REASON_CHARS ? el.slice(0, MAX_CLEANSED_REASON_CHARS) : el);
  }
  return kept.length > 0 ? kept : null;
}

export function extractCommonStorageFields(context: RecordingContext): CommonStorageFields {
  const { data, privacyResult, aiDuration, obsidianDuration, extractedSentencesBytes, extractedSentencesOriginalBytes } = context;
  const privacy = privacyResult as unknown as Record<string, unknown> | undefined;
  const d = data as unknown as Record<string, unknown>;
  const rawMasked = (d.precomputedMaskedCount as number | undefined)
    ?? (d.maskedCount as number | undefined)
    ?? (privacy?.maskedCount as number | undefined)
    ?? null;

  const fields: Omit<CommonStorageFields, 'toBrowsingLogRecord' | 'toMetadataPatch'> = {
    url: d.url as string,
    title: (d.title as string) || null,
    content: (d.content as string) || null,
    summary: (privacy?.summary as string) || null,
    tagsArray: (privacy?.tags as string[] | undefined) && (privacy?.tags as string[]).length > 0 ? (privacy?.tags as string[]) : null,
    providerName: (privacy?.providerName as string) ?? null,
    modelName: (privacy?.modelName as string) ?? null,
    privacyMode: (privacy?.mode as string) ?? null,
    // `?? null` (not `||`) so a legitimate 0 maskedCount survives instead of collapsing to null.
    maskedCount: rawMasked ?? null,
    maskedCountForPatch: rawMasked && rawMasked > 0 ? rawMasked : undefined,
    sentTokens: (privacy?.sentTokens as number) ?? null,
    receivedTokens: (privacy?.receivedTokens as number) ?? null,
    originalTokens: (privacy?.originalTokens as number) ?? null,
    cleansedTokens: (privacy?.cleansedTokens as number) ?? null,
    pageBytes: clampByteStat(d.pageBytes, MAX_BYTE_STAT_BYTES),
    candidateBytes: clampByteStat(d.candidateBytes, MAX_BYTE_STAT_BYTES),
    originalBytes: clampByteStat(d.originalBytes, MAX_BYTE_STAT_BYTES),
    cleansedBytes: clampByteStat(d.cleansedBytes, MAX_BYTE_STAT_BYTES),
    aiSummaryOriginalBytes: clampByteStat(d.aiSummaryOriginalBytes, MAX_BYTE_STAT_BYTES),
    aiSummaryCleansedBytes: clampByteStat(d.aiSummaryCleansedBytes, MAX_BYTE_STAT_BYTES),
    aiSummaryCleansedElements: clampByteStat(d.aiSummaryCleansedElements, MAX_CLEANSED_ELEMENTS),
    aiSummaryCleansedReason: clampCleansedReason(d.aiSummaryCleansedReason),
    aiSummaryCleansedReasons: clampCleansedReasons(d.aiSummaryCleansedReasons),
    fallbackTriggered: !!d.fallbackTriggered,
    fallbackTriggeredInt: d.fallbackTriggered ? 1 : 0 as 0 | 1,
    fallbackReason: (d.fallbackReason as string | undefined) ?? null,
    // `?? null` not `|| ''`: an empty referrer is a real 'none' and must not
    // become a string that the row codec would render.
    navSourceUrl: typeof d.navSourceUrl === 'string' ? d.navSourceUrl : null,
    searchQuery: typeof d.searchQuery === 'string' ? d.searchQuery : null,
    aiDuration: (aiDuration as number) ?? null,
    obsidianDuration: (obsidianDuration as number) ?? null,
    extractedSentencesBytes: (extractedSentencesBytes as number) ?? null,
    extractedSentencesOriginalBytes: (extractedSentencesOriginalBytes as number) ?? null,
    cleansedReason: (d.cleansedReason as string) ?? null,
    recordType: (d.recordType as string) ?? 'auto',
  };

  return {
    ...fields,

    toBrowsingLogRecord(contentEnabled: boolean): BrowsingLogRecord {
      return {
        url: fields.url,
        title: fields.title,
        summary: fields.summary,
        tags: fields.tagsArray ? fields.tagsArray.map(t => `#${t}`).join(' ') : null,
        created_at: Date.now(),
        domain: extractDomain(fields.url) || null,
        visit_duration: null,
        scroll_ratio: null,
        is_starred: 0,
        is_deleted: 0,
        content: contentEnabled ? fields.content : null,
        cleansed_reason: fields.cleansedReason,
        masked_count: fields.maskedCount,
        ai_provider: fields.providerName,
        ai_model: fields.modelName,
        ai_duration_ms: fields.aiDuration,
        obsidian_duration_ms: fields.obsidianDuration,
        sent_tokens: fields.sentTokens,
        received_tokens: fields.receivedTokens,
        original_tokens: fields.originalTokens,
        cleansed_tokens: fields.cleansedTokens,
        page_bytes: fields.pageBytes,
        candidate_bytes: fields.candidateBytes,
        original_bytes: fields.originalBytes,
        cleansed_bytes: fields.cleansedBytes,
        ai_summary_original_bytes: fields.aiSummaryOriginalBytes,
        ai_summary_cleansed_bytes: fields.aiSummaryCleansedBytes,
        extracted_sentences_bytes: fields.extractedSentencesBytes,
        extracted_sentences_original_bytes: fields.extractedSentencesOriginalBytes,
        fallback_triggered: fields.fallbackTriggeredInt,
        fallback_reason: fields.fallbackReason,
        nav_source_url: fields.navSourceUrl,
        search_query: fields.searchQuery,
      };
    },

    toMetadataPatch(): SavedUrlEntryMetadataPatch {
      const patch: SavedUrlEntryMetadataPatch = {};
      (patch as Record<string, unknown>).recordType = fields.recordType;

      if (fields.maskedCountForPatch !== undefined) patch.maskedCount = fields.maskedCountForPatch;
      if (fields.content) patch.content = fields.content;
      if (fields.tagsArray) patch.tags = fields.tagsArray;
      if (fields.summary) patch.aiSummary = fields.summary;
      if (fields.originalTokens !== null) patch.originalTokens = fields.originalTokens;
      if (fields.cleansedTokens !== null) patch.cleansedTokens = fields.cleansedTokens;
      if (fields.sentTokens !== null) patch.sentTokens = fields.sentTokens;
      if (fields.receivedTokens !== null) patch.receivedTokens = fields.receivedTokens;

      if (fields.pageBytes !== null) patch.pageBytes = fields.pageBytes;
      if (fields.candidateBytes !== null) patch.candidateBytes = fields.candidateBytes;
      if (fields.originalBytes !== null) patch.originalBytes = fields.originalBytes;
      if (fields.cleansedBytes !== null) patch.cleansedBytes = fields.cleansedBytes;
      if (fields.aiSummaryOriginalBytes !== null) patch.aiSummaryOriginalBytes = fields.aiSummaryOriginalBytes;
      if (fields.aiSummaryCleansedBytes !== null) patch.aiSummaryCleansedBytes = fields.aiSummaryCleansedBytes;
      if (fields.aiSummaryCleansedElements !== null) patch.aiSummaryCleansedElements = fields.aiSummaryCleansedElements;
      if (fields.aiSummaryCleansedReason !== null) patch.aiSummaryCleansedReason = fields.aiSummaryCleansedReason as AiSummaryCleansedReason;
      if (fields.aiSummaryCleansedReasons) patch.aiSummaryCleansedReasons = fields.aiSummaryCleansedReasons;

      patch.fallbackTriggered = fields.fallbackTriggered;
      // PBI 05: unconditional like fallbackTriggered — null clears a stale
      // reason when a later regenerate has no fallback (applyMetadataPatch
      // only skips undefined).
      patch.fallbackReason = fields.fallbackReason;

      if (fields.providerName) patch.aiProvider = fields.providerName;
      if (fields.modelName) patch.aiModel = fields.modelName;
      if (fields.privacyMode) (patch as Record<string, unknown>).privacyMode = fields.privacyMode;

      if (fields.extractedSentencesBytes !== null) patch.extractedSentencesBytes = fields.extractedSentencesBytes;
      if (fields.extractedSentencesOriginalBytes !== null) patch.extractedSentencesOriginalBytes = fields.extractedSentencesOriginalBytes;

      if (fields.aiDuration !== null) patch.aiDuration = fields.aiDuration;
      if (fields.obsidianDuration !== null) patch.obsidianDuration = fields.obsidianDuration;

      return patch;
    },
  };
}
