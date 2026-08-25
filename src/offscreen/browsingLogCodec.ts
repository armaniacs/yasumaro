/**
 * browsingLogCodec.ts
 * Pure mapper between untrusted payload objects and BrowsingLogRecord.
 * Single source for the 30+ field manual mapping that was previously
 * duplicated between offscreen.ts:buildRecordFromPayload and the
 * repo-side insert param builders.
 */

import type { BrowsingLogRecord } from '../utils/sqlite-types.js';

/**
 * Build a BrowsingLogRecord from an untrusted payload dictionary.
 * Explicit field mapping prevents prototype-pollution / SQL injection
 * via raw spread and guarantees every column has a deterministic value.
 */
export function buildRecordFromPayload(payload: Record<string, unknown>): BrowsingLogRecord {
  return {
    url: String(payload.url || ''),
    title: payload.title != null ? String(payload.title) : null,
    summary: payload.summary != null ? String(payload.summary) : null,
    tags: payload.tags != null ? String(payload.tags) : null,
    created_at: Number(payload.created_at || Date.now()),
    domain: payload.domain != null ? String(payload.domain) : null,
    visit_duration: payload.visit_duration != null ? Number(payload.visit_duration) : null,
    scroll_ratio: payload.scroll_ratio != null ? Number(payload.scroll_ratio) : null,
    is_starred: payload.is_starred != null ? Number(payload.is_starred) : 0,
    is_deleted: payload.is_deleted != null ? Number(payload.is_deleted) : 0,
    obsidian_synced: payload.obsidian_synced != null ? Number(payload.obsidian_synced) : 0,
    gist_synced: payload.gist_synced != null ? Number(payload.gist_synced) : 0,
    content: payload.content != null ? String(payload.content) : null,
    masked_count: payload.masked_count != null ? Number(payload.masked_count) : null,
    cleansed_reason: payload.cleansed_reason != null ? String(payload.cleansed_reason) : null,
    ai_provider: payload.ai_provider != null ? String(payload.ai_provider) : null,
    ai_model: payload.ai_model != null ? String(payload.ai_model) : null,
    ai_duration_ms: payload.ai_duration_ms != null ? Number(payload.ai_duration_ms) : null,
    obsidian_duration_ms: payload.obsidian_duration_ms != null ? Number(payload.obsidian_duration_ms) : null,
    sent_tokens: payload.sent_tokens != null ? Number(payload.sent_tokens) : null,
    received_tokens: payload.received_tokens != null ? Number(payload.received_tokens) : null,
    original_tokens: payload.original_tokens != null ? Number(payload.original_tokens) : null,
    cleansed_tokens: payload.cleansed_tokens != null ? Number(payload.cleansed_tokens) : null,
    page_bytes: payload.page_bytes != null ? Number(payload.page_bytes) : null,
    candidate_bytes: payload.candidate_bytes != null ? Number(payload.candidate_bytes) : null,
    original_bytes: payload.original_bytes != null ? Number(payload.original_bytes) : null,
    cleansed_bytes: payload.cleansed_bytes != null ? Number(payload.cleansed_bytes) : null,
    ai_summary_original_bytes: payload.ai_summary_original_bytes != null ? Number(payload.ai_summary_original_bytes) : null,
    ai_summary_cleansed_bytes: payload.ai_summary_cleansed_bytes != null ? Number(payload.ai_summary_cleansed_bytes) : null,
    extracted_sentences_bytes: payload.extracted_sentences_bytes != null ? Number(payload.extracted_sentences_bytes) : null,
    extracted_sentences_original_bytes: payload.extracted_sentences_original_bytes != null ? Number(payload.extracted_sentences_original_bytes) : null,
    fallback_triggered: payload.fallback_triggered != null ? Number(payload.fallback_triggered) : 0,
  };
}
