/**
 * browsingLogCodec.ts
 * Pure mapper between untrusted payload objects and BrowsingLogRecord.
 * Single source for the 30+ field manual mapping that was previously
 * duplicated between offscreen.ts:buildRecordFromPayload and the
 * repo-side insert param builders.
 */

import type { BrowsingLogRecord } from '../utils/sqlite-types.js';
import { MAX_TAGS_PER_RECORD } from '../utils/computeLimits.js';

/**
 * Defense-in-depth tag cap on the SQLite write path: a stored record must not
 * carry an unbounded number of tags, since those tags later flow into O(n^2)
 * dashboard computations (VULN-041/053). Whitespace-separated; first N kept.
 */
function capTags(raw: string): string {
  const parts = raw.split(/\s+/).filter(Boolean);
  return parts.length <= MAX_TAGS_PER_RECORD
    ? raw
    : parts.slice(0, MAX_TAGS_PER_RECORD).join(' ');
}

/**
 * Build a BrowsingLogRecord from an untrusted payload dictionary.
 * Explicit field mapping prevents prototype-pollution / SQL injection
 * via raw spread and guarantees every column has a deterministic value.
 */
function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Final-defense validation for the SQLite write path (PBI 2026-11-08-06).
 *
 * buildRecordFromPayload below stays a lenient coercer (dashboard and
 * migration senders rely on its numeric-string/boolean coercion), so it can
 * still turn a finite out-of-range number into a stored value that violates
 * the schema CHECKs (visit_duration < 0, scroll_ratio outside 0..1, flags
 * outside 0/1) and fails the whole write at the backend. This validator
 * rejects exactly those values — plus non-object rows and non-string urls,
 * which String() would mangle — so the offscreen runners fail closed with
 * the field named. Everything else keeps the legacy coercion:
 * absent/nullable fields, numeric strings, booleans for flags, and
 * non-finite numbers (which the codec already neutralizes to null/0/now).
 *
 * Returns the rejection reason, or null when the payload may proceed.
 */
const CODEC_TEXT_FIELDS: ReadonlySet<string> = new Set([
  'title', 'summary', 'tags', 'domain', 'content', 'cleansed_reason',
  'ai_provider', 'ai_model', 'fallback_reason', 'nav_source_url', 'search_query',
]);

const CODEC_FLAG_FIELDS: ReadonlySet<string> = new Set([
  'is_starred', 'is_deleted', 'obsidian_synced', 'gist_synced', 'fallback_triggered',
]);

export function validateRecordForInsert(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'must be an object';
  }
  const r = payload as Record<string, unknown>;
  const url = r.url;
  if (url !== undefined && url !== null && typeof url !== 'string') {
    return 'url must be a string';
  }
  for (const field of CODEC_TEXT_FIELDS) {
    const v = r[field];
    if (v !== undefined && v !== null && (typeof v === 'object' || typeof v === 'function' || typeof v === 'symbol')) {
      return `${field} must be a string`;
    }
  }
  const visitDuration = r.visit_duration;
  if (typeof visitDuration === 'number' && visitDuration < 0) {
    return 'visit_duration must be >= 0';
  }
  const scrollRatio = r.scroll_ratio;
  if (typeof scrollRatio === 'number' && (scrollRatio < 0 || scrollRatio > 1)) {
    return 'scroll_ratio must be between 0 and 1';
  }
  for (const field of CODEC_FLAG_FIELDS) {
    const v = r[field];
    if (typeof v === 'number' && Number.isFinite(v) && v !== 0 && v !== 1) {
      return `${field} must be 0 or 1`;
    }
  }
  return null;
}

export function buildRecordFromPayload(payload: Record<string, unknown>): BrowsingLogRecord {
  return {
    url: payload.url != null ? String(payload.url) : '',
    title: payload.title != null ? String(payload.title) : null,
    summary: payload.summary != null ? String(payload.summary) : null,
    tags: payload.tags != null ? capTags(String(payload.tags)) : null,
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
    fallback_reason: payload.fallback_reason != null ? String(payload.fallback_reason) : null,
    // PBI 03: opt-in navigation trail.
    nav_source_url: payload.nav_source_url != null ? String(payload.nav_source_url) : null,
    search_query: payload.search_query != null ? String(payload.search_query) : null,
  };
}
