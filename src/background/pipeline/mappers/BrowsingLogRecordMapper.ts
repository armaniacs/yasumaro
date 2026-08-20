import type { RecordingContext } from '../types.js';
import type { BrowsingLogRecord } from '../../../utils/sqlite-types.js';
import { extractDomain } from '../../../utils/domainUtils.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import { extractCommonStorageFields } from './commonStorageFields.js';

export function mapToBrowsingLogRecord(context: RecordingContext): BrowsingLogRecord {
  const common = extractCommonStorageFields(context);
  const settings = context.settings as Record<string, unknown>;
  const contentStorageEnabled = settings[StorageKeys.CONTENT_STORAGE_ENABLED] === true;

  return {
    url: common.url,
    title: common.title,
    summary: common.summary,
    tags: common.tagsArray ? common.tagsArray.map(t => `#${t}`).join(' ') : null,
    created_at: Date.now(),
    domain: extractDomain(common.url) || null,
    visit_duration: null,
    scroll_ratio: null,
    is_starred: 0,
    is_deleted: 0,
    content: contentStorageEnabled ? common.content : null,
    cleansed_reason: common.cleansedReason,
    masked_count: common.maskedCount,
    ai_provider: common.providerName,
    ai_model: common.modelName,
    ai_duration_ms: common.aiDuration,
    obsidian_duration_ms: common.obsidianDuration,
    sent_tokens: common.sentTokens,
    received_tokens: common.receivedTokens,
    original_tokens: common.originalTokens,
    cleansed_tokens: common.cleansedTokens,
    page_bytes: common.pageBytes,
    candidate_bytes: common.candidateBytes,
    original_bytes: common.originalBytes,
    cleansed_bytes: common.cleansedBytes,
    ai_summary_original_bytes: common.aiSummaryOriginalBytes,
    ai_summary_cleansed_bytes: common.aiSummaryCleansedBytes,
    extracted_sentences_bytes: common.extractedSentencesBytes,
    extracted_sentences_original_bytes: common.extractedSentencesOriginalBytes,
    fallback_triggered: common.fallbackTriggeredInt,
  };
}
