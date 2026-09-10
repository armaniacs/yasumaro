// @layer 0 — Foundation: pure constants, no dependencies
/**
 * messaging/limits.ts
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
 * audit-log reads at 1000 (opfsWorker/auditHandlers.ts) while the IDB
 * backend allows 100000 (IdbVfsBackend.queryAuditLog). Each backend owns
 * its constant; these names exist so the split is greppable from one place.
 */
export const AUDIT_CAP_OPFS = 1_000;
export const AUDIT_CAP_IDB = 100_000;
