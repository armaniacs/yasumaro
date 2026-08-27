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
function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function buildRecordFromPayload(payload: Record<string, unknown>): BrowsingLogRecord {
  return {
    url: payload.url != null ? String(payload.url) : '',
    title: payload.title != null ? String(payload.title) : null,
    summary: payload.summary != null ? String(payload.summary) : null,
    tags: payload.tags != null ? String(payload.tags) : null,
    created_at: payload.created_at != null ? (toFiniteNumber(payload.created_at) ?? Date.now()) : Date.now(),
    domain: payload.domain != null ? String(payload.domain) : null,
    visit_duration: payload.visit_duration != null ? toFiniteNumber(payload.visit_duration) : null,
    scroll_ratio: payload.scroll_ratio != null ? toFiniteNumber(payload.scroll_ratio) : null,
    is_starred: payload.is_starred != null ? (toFiniteNumber(payload.is_starred) ?? 0) : 0,
    is_deleted: payload.is_deleted != null ? (toFiniteNumber(payload.is_deleted) ?? 0) : 0,
    obsidian_synced: payload.obsidian_synced != null ? (toFiniteNumber(payload.obsidian_synced) ?? 0) : 0,
    gist_synced: payload.gist_synced != null ? (toFiniteNumber(payload.gist_synced) ?? 0) : 0,
    content: payload.content != null ? String(payload.content) : null,
    masked_count: payload.masked_count != null ? toFiniteNumber(payload.masked_count) : null,
    cleansed_reason: payload.cleansed_reason != null ? String(payload.cleansed_reason) : null,
    ai_provider: payload.ai_provider != null ? String(payload.ai_provider) : null,
    ai_model: payload.ai_model != null ? String(payload.ai_model) : null,
    ai_duration_ms: payload.ai_duration_ms != null ? toFiniteNumber(payload.ai_duration_ms) : null,
    obsidian_duration_ms: payload.obsidian_duration_ms != null ? toFiniteNumber(payload.obsidian_duration_ms) : null,
    sent_tokens: payload.sent_tokens != null ? toFiniteNumber(payload.sent_tokens) : null,
    received_tokens: payload.received_tokens != null ? toFiniteNumber(payload.received_tokens) : null,
    original_tokens: payload.original_tokens != null ? toFiniteNumber(payload.original_tokens) : null,
    cleansed_tokens: payload.cleansed_tokens != null ? toFiniteNumber(payload.cleansed_tokens) : null,
    page_bytes: payload.page_bytes != null ? toFiniteNumber(payload.page_bytes) : null,
    candidate_bytes: payload.candidate_bytes != null ? toFiniteNumber(payload.candidate_bytes) : null,
    original_bytes: payload.original_bytes != null ? toFiniteNumber(payload.original_bytes) : null,
    cleansed_bytes: payload.cleansed_bytes != null ? toFiniteNumber(payload.cleansed_bytes) : null,
    ai_summary_original_bytes: payload.ai_summary_original_bytes != null ? toFiniteNumber(payload.ai_summary_original_bytes) : null,
    ai_summary_cleansed_bytes: payload.ai_summary_cleansed_bytes != null ? toFiniteNumber(payload.ai_summary_cleansed_bytes) : null,
    extracted_sentences_bytes: payload.extracted_sentences_bytes != null ? toFiniteNumber(payload.extracted_sentences_bytes) : null,
    extracted_sentences_original_bytes: payload.extracted_sentences_original_bytes != null ? toFiniteNumber(payload.extracted_sentences_original_bytes) : null,
    fallback_triggered: payload.fallback_triggered != null ? (toFiniteNumber(payload.fallback_triggered) ?? 0) : 0,
  };
}
