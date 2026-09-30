// @layer 0 — Foundation: pure constants, no dependencies
/**
 * utils/limits.ts
 * Canonical registry for message-pipeline size caps.
 *
 * Validators, background handlers, and the dashboard pre-check all read
 * from here so the same concept cannot drift into per-module literals.
 * Every value below is the strictest effective bound previously enforced
 * on the validated path (MessageRouter runs the validator before the
 * handler), so unifying changes no reachable accept/reject decision.
 */

export const MAX_CONTENT_LENGTH = 1_000_000;
export const MAX_TITLE_LENGTH = 500;
export const MAX_SEARCH_QUERY_LENGTH = 1_000;

/**
 * Per-request import row cap. Previously 1000 in the validator against
 * 5000 in the handler; the validator gate fires first, so 1000 was the
 * effective bound and is kept.
 */
export const MAX_IMPORT_ROWS = 1_000;

/** Import payload size estimate (JSON length), enforced by the validator. */
export const MAX_IMPORT_BYTES = 2_000_000;

/** restore_db base64 string length, enforced by the validator. */
export const MAX_RESTORE_DB_BYTES = 10_000_000;

/** archive_export chunk length; base64 hops stay under the 10MB message ceiling. */
export const MAX_ARCHIVE_EXPORT_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * append_to_obsidian ids per request. Previously 1000 in the validator
 * against 100 in the handler; requests with 101-1000 ids were rejected
 * by the handler, so 100 was the effective bound and is kept.
 */
export const MAX_APPEND_IDS = 100;

/**
 * Pre-decode ceiling for restore_db in the maintenance handler. A separate
 * layer from MAX_RESTORE_DB_BYTES (validator string cap): this one guards
 * the base64 decode itself, so it stays larger by design.
 */
export const MAX_RESTORE_BASE64_BYTES = 150 * 1024 * 1024;

/**
 * INTENTIONAL divergence, documented but not unified: the OPFS worker caps
 * audit-log reads at 1000 (opfsWorker/auditHandlers.ts) while the IDB backend
 * allows 100000 (IdbVfsBackend.queryAuditLog). Each backend owns its constant;
 * these names exist so the split is greppable from one place.
 */
export const AUDIT_CAP_OPFS = 1_000;
export const AUDIT_CAP_IDB = 100_000;

// Caps absorbed from per-module literals; each value keeps its original number.

/** Plain listing hard ceiling (sqliteEngineHost / recordsRepo). Same value as QUERY_CAPS.fts. */
export const MAX_QUERY_LIMIT = 100_000;

/**
 * Read-limit caps, owned by the planner seam.
 *
 * Both caps live next to MAX_QUERY_LIMIT so the pair cannot drift apart
 * unnoticed.
 */
export const QUERY_CAPS = {
  fts: 100000,
  plain: 10000,
} as const;

/** Log-forward: forwarded log message chars, detail keys, serialized size (systemHandlers, VULN-004). */
export const MAX_LOG_FORWARD_MESSAGE_CHARS = 64 * 1024;
export const MAX_LOG_FORWARD_DETAILS_KEYS = 64;
export const MAX_LOG_FORWARD_SERIALIZED_CHARS = 256 * 1024;

/** Recording pipeline: per-record payload size (recordingValidator). */
export const MAX_RECORD_SIZE = 64 * 1024;

/** PII sanitizer input/output caps. */
export const MAX_PII_INPUT_SIZE = 64 * 1024;
export const MAX_PII_OUTPUT_SIZE = 128 * 1024;

/** AI usage tracker: token-count validation ceiling (VULN-002). */
export const MAX_TOKENS_PER_CALL = 10_000_000;

/** Encrypted backup envelope ciphertext length. */
export const MAX_ENVELOPE_CIPHERTEXT_LENGTH = 64 * 1024 * 1024;

/** Obsidian error-body read cap (obsidianClient). */
export const MAX_ERROR_BODY_SIZE = 1024 * 1024;

/**
 * Round 5 drift-guard follow-up — caps the first guard pass itself found:
 */
/** Pre-parse import text cap (dashboard importLogsService). */
export const MAX_IMPORT_TEXT_BYTES = 10 * 1024 * 1024;

/** Offscreen payloadGuard per-field text cap. */
export const MAX_PAYLOAD_STRING_BYTES = 1024 * 1024;

/** Offscreen payloadGuard batch totals. */
export const MAX_BATCH_TOTAL_BYTES = 20 * 1024 * 1024;
export const MAX_PAYLOAD_TOTAL_BYTES = 20 * 1024 * 1024;

/**
 * The 10 MiB family (round 6, PBI 2026-09-11-08): every "read at most 10MB of
 * a response/import/envelope" cap. These are independent concerns that
 * happen to share the value — if one ever needs to diverge, give it its own
 * name here rather than re-localizing a literal.
 */
/** FETCH_URL handler: response body cap. */
export const MAX_FILTER_LIST_SIZE = 10 * 1024 * 1024;
/** Obsidian config / arbitrary response body cap (obsidianConfigValidator). */
export const MAX_BODY_SIZE = 10 * 1024 * 1024;
/** Settings export/import read cap (importPipeline). */
export const DEFAULT_IMPORT_SIZE_CAP_BYTES = 10 * 1024 * 1024;
/** Encrypted envelope: PRE-DECODE base64 length cap. The decoded ciphertext
 * cap (MAX_ENVELOPE_CIPHERTEXT_LENGTH) is a different layer — 64 MiB binary
 * vs 10 MiB base64 text; do not merge them. */
export const MAX_ENVELOPE_BASE64_LENGTH = 10 * 1024 * 1024;

/** AI provider HTTP JSON response cap (summary + testConnection). */
export const MAX_AI_HTTP_RESPONSE_BYTES = 10 * 1024 * 1024;

/** chrome.storage.local quota (storage/quota helpers). */
export const STORAGE_QUOTA_BYTES = 10 * 1024 * 1024;

/** Dashboard import: total-row ceiling across an import (importLogsService). */
export const IMPORT_TOTAL_ROW_CAP = 100_000;

/** Dashboard import: per-row summary length cap (importLogsService). */
export const MAX_SUMMARY_LENGTH = 100_000;

/**
 * Max ids per query (round 6, PBI 2026-09-11-02): ids cross the wire, and an
 * unbounded array becomes a giant SQL IN(...) clause. 200 covers every
 * legitimate selection use (bulk select pages at 20/page).
 */
export const MAX_QUERY_IDS = 200;

/**
 * archive_query rows per request (PBI 2026-09-17-18). Previously a bare
 * `1..500` literal inside the validator; moved here so the drift guard sees it
 * alongside the other wire caps.
 */
export const MAX_ARCHIVE_QUERY_LIMIT = 500;

/**
 * ByteStats bounds for VALID_VISIT payloads. Page content is capped at
 * MAX_CONTENT_LENGTH chars (≈4MiB worst-case UTF-8) and AI responses at
 * 10MiB, so 16MiB accepts every legitimate measurement with headroom while
 * rejecting absurd self-reported values. Element/reason caps likewise sit
 * orders of magnitude above real cleanser output (hundreds of elements,
 * reason keys under 20 chars).
 */
export const MAX_BYTE_STAT_BYTES = 16 * 1024 * 1024;
export const MAX_CLEANSED_ELEMENTS = 1_000_000;
export const MAX_CLEANSED_REASON_CHARS = 128;
export const MAX_CLEANSED_REASONS = 64;

/**
 * Payload size caps. Oversized payloads are rejected (not truncated) so a
 * compromised or buggy sender cannot exhaust SW memory or chrome.storage
 * quota via the recording pipeline.
 */
export const VALIDATOR_LIMITS = {
  /** VALID_VISIT / MANUAL_RECORD body text */
  MAX_CONTENT_LENGTH,
  /** MANUAL_RECORD title */
  MAX_TITLE_LENGTH,
  /** DASHBOARD_SQLITE search query */
  MAX_SEARCH_QUERY_LENGTH,
  /** DASHBOARD_SQLITE import rows per request */
  MAX_IMPORT_ROWS,
  /** DASHBOARD_SQLITE import payload (JSON estimate) */
  MAX_IMPORT_BYTES,
  /** DASHBOARD_SQLITE restore_db payload */
  MAX_RESTORE_DB_BYTES,
  /** DASHBOARD_SQLITE archive_export chunk size (base64 hops stay under 10MB) */
  MAX_ARCHIVE_EXPORT_CHUNK_BYTES,
  /** DASHBOARD_SQLITE append_to_obsidian ids per request */
  MAX_APPEND_IDS,
  /** DASHBOARD_SQLITE archive_query rows per request */
  MAX_ARCHIVE_QUERY_LIMIT,
  /** VALID_VISIT ByteStats byte fields (page/candidate/original/cleansed/AI-summary bytes) */
  MAX_BYTE_STAT_BYTES,
  /** VALID_VISIT aiSummaryCleansedElements */
  MAX_CLEANSED_ELEMENTS,
  /** VALID_VISIT aiSummaryCleansedReason / aiSummaryCleansedReasons[] element length */
  MAX_CLEANSED_REASON_CHARS,
  /** VALID_VISIT aiSummaryCleansedReasons[] element count */
  MAX_CLEANSED_REASONS,
} as const;
