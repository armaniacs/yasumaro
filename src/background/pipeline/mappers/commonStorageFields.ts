/**
 * commonStorageFields.ts
 * Single source of truth for RecordingContext → storage field extraction.
 * Previously duplicated in saveMetadataStep.ts and BrowsingLogRecordMapper.ts.
 */

import type { RecordingContext } from '../types.js';
import type { BrowsingLogRecord } from '../../../utils/sqlite-types.js';
import type { SavedUrlEntryMetadataPatch } from '../../../utils/storage/savedUrlRepository.js';
import type { AiSummaryCleansedReason, RecordType } from '../../../utils/commonTypes.js';
import { extractDomain } from '../../../utils/domainUtils.js';
import {
  MAX_BYTE_STAT_BYTES,
  MAX_CLEANSED_ELEMENTS,
  MAX_CLEANSED_REASON_CHARS,
  MAX_CLEANSED_REASONS,
  MAX_SCROLL_RATIO_PERCENT,
  MAX_VISIT_DURATION_SECONDS,
} from '../../../utils/limits.js';

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
  recordType: RecordType;
  /** PBI 2026-10-23-02: engagement metrics from the wire payload (null on manual records). */
  visitDurationSeconds: number | null;
  scrollRatioPercent: number | null;

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

/**
 * Second-layer guard for the engagement metrics (PBI 2026-10-23-02), the same
 * shape as clampByteStat: the message validator rejects malformed wire values,
 * but internal-only paths never cross it, so the mapper clamps instead of
 * trusting bare casts. Bounds are shared with the validator (src/utils/limits)
 * so the two layers cannot drift apart. A garbage value collapses to NULL —
 * an unread metric is honest, a wrong one would violate the schema CHECK and
 * lose the record.
 */
function clampVisitDuration(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(Math.max(value, 0), MAX_VISIT_DURATION_SECONDS);
}

function clampScrollRatioPercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(Math.max(value, 0), MAX_SCROLL_RATIO_PERCENT);
}

export function extractCommonStorageFields(context: RecordingContext): CommonStorageFields {
  const { data, privacyResult, aiDuration, obsidianDuration, extractedSentencesBytes, extractedSentencesOriginalBytes } = context;
  // Typed context access: RecordingData / PrivacyPipelineResult already
  // declare every field read below, so no Record widening or bare cast is
  // needed (PBI 20: the former `as unknown as Record<string, unknown>` chain
  // is gone; the byte-stat clamps below stay the second-layer guard).
  const privacy = privacyResult;
  const rawMasked = data.precomputedMaskedCount
    ?? data.maskedCount
    ?? privacy?.maskedCount
    ?? null;
  const tags = privacy?.tags;

  const fields: Omit<CommonStorageFields, 'toBrowsingLogRecord' | 'toMetadataPatch'> = {
    url: data.url,
    title: data.title || null,
    content: data.content || null,
    summary: privacy?.summary || null,
    tagsArray: tags && tags.length > 0 ? tags : null,
    providerName: privacy?.providerName ?? null,
    modelName: privacy?.modelName ?? null,
    privacyMode: privacy?.mode ?? null,
    // `?? null` (not `||`) so a legitimate 0 maskedCount survives instead of collapsing to null.
    maskedCount: rawMasked ?? null,
    maskedCountForPatch: rawMasked && rawMasked > 0 ? rawMasked : undefined,
    sentTokens: privacy?.sentTokens ?? null,
    receivedTokens: privacy?.receivedTokens ?? null,
    originalTokens: privacy?.originalTokens ?? null,
    cleansedTokens: privacy?.cleansedTokens ?? null,
    pageBytes: clampByteStat(data.pageBytes, MAX_BYTE_STAT_BYTES),
    candidateBytes: clampByteStat(data.candidateBytes, MAX_BYTE_STAT_BYTES),
    originalBytes: clampByteStat(data.originalBytes, MAX_BYTE_STAT_BYTES),
    cleansedBytes: clampByteStat(data.cleansedBytes, MAX_BYTE_STAT_BYTES),
    aiSummaryOriginalBytes: clampByteStat(data.aiSummaryOriginalBytes, MAX_BYTE_STAT_BYTES),
    aiSummaryCleansedBytes: clampByteStat(data.aiSummaryCleansedBytes, MAX_BYTE_STAT_BYTES),
    aiSummaryCleansedElements: clampByteStat(data.aiSummaryCleansedElements, MAX_CLEANSED_ELEMENTS),
    aiSummaryCleansedReason: clampCleansedReason(data.aiSummaryCleansedReason),
    aiSummaryCleansedReasons: clampCleansedReasons(data.aiSummaryCleansedReasons),
    fallbackTriggered: !!data.fallbackTriggered,
    fallbackTriggeredInt: data.fallbackTriggered ? 1 : 0,
    fallbackReason: data.fallbackReason ?? null,
    // `?? null` not `|| ''`: an empty referrer is a real 'none' and must not
    // become a string that the row codec would render.
    navSourceUrl: data.navSourceUrl ?? null,
    searchQuery: data.searchQuery ?? null,
    aiDuration: aiDuration ?? null,
    obsidianDuration: obsidianDuration ?? null,
    extractedSentencesBytes: extractedSentencesBytes ?? null,
    extractedSentencesOriginalBytes: extractedSentencesOriginalBytes ?? null,
    cleansedReason: data.cleansedReason ?? null,
    recordType: data.recordType ?? 'auto',
    // PBI 2026-10-23-02: engagement metrics ride the wire payload. The clamp
    // is the second-layer guard (the validator rejects malformed wire values);
    // the `?? null` result keeps a manual record (no metrics) saving NULL.
    visitDurationSeconds: clampVisitDuration(data.visitDurationSeconds),
    scrollRatioPercent: clampScrollRatioPercent(data.scrollRatioPercent),
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
        // PBI 2026-10-23-02: the saved row carries the wire metrics, so the
        // NULL常态 is resolved for valid visits (manual records stay NULL).
        visit_duration: fields.visitDurationSeconds,
        // Contract mismatch fix (discovered in PBI 2026-10-22-04 O5): the wire
        // field is a PERCENTAGE (visitReporter sends pageState
        // .maxScrollPercentage, 0..100) while every downstream consumer reads
        // a FRACTION — browsingLogSchema's CHECK requires scroll_ratio 0..1
        // and the reminder aggregate's UNREAD_SCROLL_RATIO is 0.9. Storing the
        // raw percentage violated the CHECK (the insert failed, the record was
        // lost) or, without the CHECK, would have read every scrolled page as
        // already read. The mapper is the unit boundary: normalize here, once,
        // so the wire keeps its honest name and the column keeps its schema.
        scroll_ratio: fields.scrollRatioPercent !== null ? fields.scrollRatioPercent / 100 : null,
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
      patch.recordType = fields.recordType;

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
      if (fields.privacyMode) patch.privacyMode = fields.privacyMode;

      if (fields.extractedSentencesBytes !== null) patch.extractedSentencesBytes = fields.extractedSentencesBytes;
      if (fields.extractedSentencesOriginalBytes !== null) patch.extractedSentencesOriginalBytes = fields.extractedSentencesOriginalBytes;

      if (fields.aiDuration !== null) patch.aiDuration = fields.aiDuration;
      if (fields.obsidianDuration !== null) patch.obsidianDuration = fields.obsidianDuration;

      return patch;
    },
  };
}
