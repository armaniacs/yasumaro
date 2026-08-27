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
    pageBytes: (d.pageBytes as number) ?? null,
    candidateBytes: (d.candidateBytes as number) ?? null,
    originalBytes: (d.originalBytes as number) ?? null,
    cleansedBytes: (d.cleansedBytes as number) ?? null,
    aiSummaryOriginalBytes: (d.aiSummaryOriginalBytes as number) ?? null,
    aiSummaryCleansedBytes: (d.aiSummaryCleansedBytes as number) ?? null,
    aiSummaryCleansedElements: (d.aiSummaryCleansedElements as number) ?? null,
    aiSummaryCleansedReason: (d.aiSummaryCleansedReason as string) ?? null,
    aiSummaryCleansedReasons: (d.aiSummaryCleansedReasons as string[] | undefined) && (d.aiSummaryCleansedReasons as string[]).length > 0 ? (d.aiSummaryCleansedReasons as string[]) : null,
    fallbackTriggered: !!d.fallbackTriggered,
    fallbackTriggeredInt: d.fallbackTriggered ? 1 : 0 as 0 | 1,
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
