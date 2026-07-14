import type { RecordingContext } from '../types.js';
import type { BrowsingLogRecord } from '../../../utils/sqlite-types.js';
import { extractDomain } from '../../../utils/domainUtils.js';
import { StorageKeys } from '../../../utils/storage.js';

export function mapToBrowsingLogRecord(context: RecordingContext): BrowsingLogRecord {
  const { data, privacyResult, aiDuration, obsidianDuration, extractedSentencesBytes, extractedSentencesOriginalBytes } = context;
  const { url, title } = data;

  const settings = context.settings as Record<string, unknown>;
  const contentStorageEnabled = settings[StorageKeys.CONTENT_STORAGE_ENABLED] === true;

  return {
    url,
    title: title || null,
    summary: privacyResult?.summary || null,
    tags: privacyResult?.tags && privacyResult.tags.length > 0
      ? privacyResult.tags.map(t => `#${t}`).join(' ')
      : null,
    created_at: Date.now(),
    domain: extractDomain(url) || null,
    visit_duration: null,
    scroll_ratio: null,
    is_starred: 0,
    is_deleted: 0,
    content: contentStorageEnabled ? (data.content || null) : null,
    cleansed_reason: data.cleansedReason || null,
    masked_count: (data.maskedCount ?? privacyResult?.maskedCount) || null,
    ai_provider: null as null | string,
    ai_model: null as null | string,
    ai_duration_ms: aiDuration ?? null,
    obsidian_duration_ms: obsidianDuration ?? null,
    sent_tokens: null as null | number,
    received_tokens: null as null | number,
    original_tokens: privacyResult?.originalTokens ?? null,
    cleansed_tokens: privacyResult?.cleansedTokens ?? null,
    page_bytes: data.pageBytes ?? null,
    candidate_bytes: data.candidateBytes ?? null,
    original_bytes: data.originalBytes ?? null,
    cleansed_bytes: data.cleansedBytes ?? null,
    ai_summary_original_bytes: data.aiSummaryOriginalBytes ?? null,
    ai_summary_cleansed_bytes: data.aiSummaryCleansedBytes ?? null,
    extracted_sentences_bytes: extractedSentencesBytes ?? null,
    extracted_sentences_original_bytes: extractedSentencesOriginalBytes ?? null,
    fallback_triggered: data.fallbackTriggered ? 1 : 0,
  };
}
