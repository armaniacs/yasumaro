// @layer 0 — Foundation: pure validation, no chrome dependencies
/**
 * messaging/validators.ts
 * Unified MessageValidator interface + concrete validators for 3 domains.
 *
 * PBI 2026-08-23-03: MessageValidator<T> defines a single seam for
 * validating unknown messages. Handlers receive already-validated payloads.
 */

import { isServiceWorkerRequest } from './types.js';
import {
  MAX_CONTENT_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_SEARCH_QUERY_LENGTH,
  MAX_IMPORT_ROWS,
  MAX_IMPORT_BYTES,
  MAX_RESTORE_DB_BYTES,
  MAX_ARCHIVE_EXPORT_CHUNK_BYTES,
  MAX_APPEND_IDS,
  MAX_ARCHIVE_QUERY_LIMIT,
} from './limits.js';
import { isHttpScheme, assertCutoffPair, CutoffMismatchError, decodeStagingName } from '../utils/archiveGuards.js';
import type {
  ExtensionMessage,
  ValidVisitMessage,
  FetchUrlMessage,
  ManualRecordMessage,
  ContentCleansingExecutedMessage,
  RegenerateSummaryMessage,
} from '../background/messageTypes.js';
import { REGENERATE_CLEANSE_MODES } from '../utils/aiSummaryCleaner/cleanseModeLadder.js';
import type { DashboardSqliteRequest } from '../background/handlers/dashboardSqliteProtocol.js';
import { ALL_DASHBOARD_SQLITE_SUBTYPES } from './sqliteOperationSecurity.js';

export class ValidationError extends Error {
  constructor(
    public readonly validatorName: string,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export interface MessageValidator<T> {
  validate(msg: unknown): T;
}

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
  /** DASHBOARD_SQLITE archive_query rows per request (PBI 2026-09-17-18) */
  MAX_ARCHIVE_QUERY_LIMIT,
} as const;

// ------------------------------------------------------------------
// Shared wire checks (PBI 2026-09-18-05): protocolVersion, http(s) URL,
// and content-length rejections used to be copy-pasted across the three
// validators below. The messages and fields are pinned by
// validators-shared-checks-parity.test.ts — keep them byte-identical.
// ------------------------------------------------------------------
function assertProtocolVersion(m: Record<string, unknown>, validatorName: string): void {
  if ('protocolVersion' in m && typeof m.protocolVersion !== 'number') {
    throw new ValidationError(validatorName, 'protocolVersion must be a number', 'protocolVersion');
  }
}

function assertHttpUrl(raw: unknown, validatorName: string): URL {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new ValidationError(validatorName, 'payload.url must be non-empty string', 'url');
  }
  // Basic URL shape check — detailed SSRF is handled by ssrfGuard downstream.
  // Scheme allowlist is the SSOT in utils/archiveGuards.ts (PBI 2026-09-06-01).
  try {
    const parsed = new URL(raw);
    if (!isHttpScheme(parsed.protocol)) {
      throw new ValidationError(validatorName, 'payload.url must be http or https', 'url');
    }
    return parsed;
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    throw new ValidationError(validatorName, 'payload.url must be valid URL', 'url');
  }
}

function assertContentLength(text: string, validatorName: string): void {
  if (text.length > VALIDATOR_LIMITS.MAX_CONTENT_LENGTH) {
    throw new ValidationError(
      validatorName,
      `payload.content exceeds ${VALIDATOR_LIMITS.MAX_CONTENT_LENGTH} chars`,
      'content',
    );
  }
}

// ------------------------------------------------------------------
// ServiceWorkerRequestValidator — generic ExtensionMessage validation
// ------------------------------------------------------------------
export class ServiceWorkerRequestValidator implements MessageValidator<ExtensionMessage> {
  validate(msg: unknown): ExtensionMessage {
    if (!isServiceWorkerRequest(msg)) {
      throw new ValidationError('ServiceWorkerRequestValidator', 'Invalid message format', 'type');
    }
    return msg as ExtensionMessage;
  }
}

// ------------------------------------------------------------------
// ValidVisitValidator — VALID_VISIT payload validation
// ------------------------------------------------------------------
export class ValidVisitValidator implements MessageValidator<ValidVisitMessage> {
  validate(msg: unknown): ValidVisitMessage {
    if (!msg || typeof msg !== 'object') {
      throw new ValidationError('ValidVisitValidator', 'Message must be an object');
    }
    const m = msg as Record<string, unknown>;
    if (m.type !== 'VALID_VISIT') {
      throw new ValidationError('ValidVisitValidator', 'type must be VALID_VISIT', 'type');
    }
    if (!m.payload || typeof m.payload !== 'object') {
      throw new ValidationError('ValidVisitValidator', 'payload is required', 'payload');
    }
    const payload = m.payload as Record<string, unknown>;
    if (typeof payload.content !== 'string') {
      throw new ValidationError('ValidVisitValidator', 'payload.content must be a string', 'content');
    }
    if (payload.content.length === 0) {
      throw new ValidationError('ValidVisitValidator', 'payload.content must not be empty', 'content');
    }
    assertContentLength(payload.content, 'ValidVisitValidator');
    if (payload.force !== undefined && typeof payload.force !== 'boolean') {
      throw new ValidationError('ValidVisitValidator', 'payload.force must be boolean', 'force');
    }
    // PBI 05: fallback outcome fields travel with VALID_VISIT payloads.
    if (payload.fallbackTriggered !== undefined && typeof payload.fallbackTriggered !== 'boolean') {
      throw new ValidationError('ValidVisitValidator', 'payload.fallbackTriggered must be boolean', 'fallbackTriggered');
    }
    if (payload.fallbackReason !== undefined && typeof payload.fallbackReason !== 'string') {
      throw new ValidationError('ValidVisitValidator', 'payload.fallbackReason must be a string', 'fallbackReason');
    }
    // VALID_MESSAGE_TYPES check already ensures type is known, but verify protocolVersion if present
    assertProtocolVersion(m, 'ValidVisitValidator');
    return msg as ValidVisitMessage;
  }
}

// ------------------------------------------------------------------
// DashboardSqlite payload schema (PBI 2026-09-17-18)
// ------------------------------------------------------------------

/** Field-level check row: `test` gates the wire type/bound, `message` renders
 *  the exact (unchanged) rejection text, `field` names the ValidationError field. */
interface DashboardSqliteFieldSpec {
  field: string;
  optional?: boolean;
  test: (v: unknown, p: Record<string, unknown>) => boolean;
  message: (subtype: string) => string;
}

/** Domain-mapping guard: converts third-party errors (staging decode, cutoff
 *  pairing) or cross-field estimates into the stable layer messages. */
type DashboardSqliteGuard = (p: Record<string, unknown>, subtype: string) => void;

interface DashboardSqliteSubtypeSpec {
  /** Runs before the field rows (e.g. staging decode proves the name before
   *  any paging field is judged — preserves the original check order). */
  guardFirst?: DashboardSqliteGuard;
  fields?: readonly DashboardSqliteFieldSpec[];
  /** Runs after the field rows (e.g. the import JSON-size estimate needs the
   *  whole already-type-checked array). */
  guardLast?: DashboardSqliteGuard;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const finiteNumber = (field: string): DashboardSqliteFieldSpec => ({
  field,
  test: isFiniteNumber,
  message: (s) => `${s}: ${field} must be finite number`,
});

const nonNegativeInteger = (field: string): DashboardSqliteFieldSpec => ({
  field,
  test: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0,
  message: (s) => `${s}: ${field} must be a non-negative integer`,
});

const nonEmptyString = (field: string): DashboardSqliteFieldSpec => ({
  field,
  test: (v) => typeof v === 'string' && v.length > 0,
  message: (s) => `${s}: ${field} must be non-empty string`,
});

const stringField = (field: string): DashboardSqliteFieldSpec => ({
  field,
  test: (v) => typeof v === 'string',
  message: (s) => `${s}: ${field} must be string`,
});

const stringLengthCap = (field: string, cap: number): DashboardSqliteFieldSpec => ({
  field,
  test: (v) => typeof v === 'string' && v.length <= cap,
  message: (s) => `${s}: ${field} exceeds ${cap} chars`,
});

const arrayField = (field: string): DashboardSqliteFieldSpec => ({
  field,
  test: (v) => Array.isArray(v),
  message: (s) => `${s}: ${field} must be array`,
});

const arrayLengthCap = (field: string, cap: number): DashboardSqliteFieldSpec => ({
  field,
  test: (v) => Array.isArray(v) && v.length <= cap,
  message: (s) => `${s}: ${field} exceeds ${cap}`,
});

/** Staging-name boundary decode — one implementation for all 9 staging
 *  subtypes (previously 6 copy-pasted try/catch blocks; PBI 2026-09-17-18).
 *  The brand proves the name crossed validation, but the wire payload stays
 *  `string` (PBI 2026-09-07-22 touches wire shape). */
function stagingNameGuard(p: Record<string, unknown>, subtype: string): void {
  try {
    decodeStagingName(p.stagingName);
  } catch {
    throw new ValidationError('DashboardSqliteValidator', `${subtype}: stagingName must be a valid staging name`, 'stagingName');
  }
}

/** Cutoff pairing (archive_preview / archive_create, PBI 2026-09-06-02): the
 *  worker re-derives the cutoff from the date string, so a fabricated cutoffMs
 *  pair is rejected before reaching the staging registry. Pair verification
 *  itself is the `assertCutoffPair` seam (PBI 2026-09-07-21); this guard only
 *  maps its throws to the stable layer messages. */
function cutoffPairGuard(p: Record<string, unknown>, subtype: string): void {
  if (typeof p.cutoffDate !== 'string') {
    throw new ValidationError('DashboardSqliteValidator', `${subtype}: cutoffDate must be string`, 'cutoffDate');
  }
  if (!isFiniteNumber(p.cutoffMs)) {
    throw new ValidationError('DashboardSqliteValidator', `${subtype}: cutoffMs must be finite number`, 'cutoffMs');
  }
  try {
    assertCutoffPair(p.cutoffDate, p.cutoffMs);
  } catch (e) {
    if (e instanceof CutoffMismatchError) {
      throw new ValidationError('DashboardSqliteValidator', `${subtype}: cutoffMs does not match cutoffDate`, 'cutoffMs');
    }
    throw new ValidationError('DashboardSqliteValidator', `${subtype}: ${e instanceof Error ? e.message : 'invalid cutoffDate'}`, 'cutoffDate');
  }
  if (typeof p.includeDeleted !== 'boolean') {
    throw new ValidationError('DashboardSqliteValidator', `${subtype}: includeDeleted must be boolean`, 'includeDeleted');
  }
}

/** Import rows byte-estimate — needs the whole type-checked array, so it runs
 *  after the row-count field checks (guardLast). */
function importBytesGuard(p: Record<string, unknown>): void {
  const approxBytes = JSON.stringify(p.rows).length;
  if (approxBytes > VALIDATOR_LIMITS.MAX_IMPORT_BYTES) {
    throw new ValidationError('DashboardSqliteValidator', `import: payload exceeds ${VALIDATOR_LIMITS.MAX_IMPORT_BYTES} bytes`, 'rows');
  }
}

/**
 * Per-subtype wire-field schema for DASHBOARD_SQLITE payloads. One entry per
 * subtype; field rows are interpreted uniformly by DashboardSqliteValidator.
 * `query` is intentionally absent — it accepts arbitrary extra fields.
 */
const DASHBOARD_SQLITE_SUBTYPE_SPECS: Readonly<Record<string, DashboardSqliteSubtypeSpec>> = {
  toggle_star: { fields: [finiteNumber('id')] },
  delete: { fields: [finiteNumber('id')] },
  create_confirm_token: {
    fields: [
      nonEmptyString('action'),
      { field: 'id', optional: true, test: isFiniteNumber, message: (s) => `${s}: id must be finite number` },
    ],
  },
  update: {
    fields: [
      finiteNumber('id'),
      { field: 'changes', test: (v) => v !== null && typeof v === 'object', message: (s) => `${s}: changes is required` },
    ],
  },
  search: {
    fields: [
      stringField('query'),
      stringLengthCap('query', VALIDATOR_LIMITS.MAX_SEARCH_QUERY_LENGTH),
    ],
  },
  import: {
    fields: [
      arrayField('rows'),
      arrayLengthCap('rows', VALIDATOR_LIMITS.MAX_IMPORT_ROWS),
    ],
    guardLast: importBytesGuard,
  },
  restore_db: {
    fields: [
      stringField('data'),
      stringLengthCap('data', VALIDATOR_LIMITS.MAX_RESTORE_DB_BYTES),
    ],
  },
  append_to_obsidian: {
    fields: [
      arrayField('ids'),
      arrayLengthCap('ids', VALIDATOR_LIMITS.MAX_APPEND_IDS),
    ],
  },
  archive_preview: { guardFirst: cutoffPairGuard },
  archive_create: {
    guardFirst: cutoffPairGuard,
    fields: [
      { field: 'yasumaroVersion', test: (v) => typeof v === 'string' && v.length >= 1 && v.length <= 64, message: () => 'archive_create: yasumaroVersion must be 1-64 chars' },
    ],
  },
  archive_export: {
    guardFirst: stagingNameGuard,
    fields: [
      nonNegativeInteger('offset'),
      {
        field: 'length',
        test: (v) => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= VALIDATOR_LIMITS.MAX_ARCHIVE_EXPORT_CHUNK_BYTES,
        message: (s) => `${s}: length must be 1..${VALIDATOR_LIMITS.MAX_ARCHIVE_EXPORT_CHUNK_BYTES}`,
      },
    ],
  },
  archive_delete_by_staging: { guardFirst: stagingNameGuard },
  archive_open: { guardFirst: stagingNameGuard },
  archive_save: { guardFirst: stagingNameGuard },
  archive_close: { guardFirst: stagingNameGuard },
  archive_restore_preview: { guardFirst: stagingNameGuard },
  archive_restore: { guardFirst: stagingNameGuard },
  archive_query: {
    guardFirst: stagingNameGuard,
    fields: [
      stringField('query'),
      stringLengthCap('query', VALIDATOR_LIMITS.MAX_SEARCH_QUERY_LENGTH),
      {
        field: 'limit',
        test: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= VALIDATOR_LIMITS.MAX_ARCHIVE_QUERY_LIMIT,
        message: (s) => `${s}: limit must be 1..${VALIDATOR_LIMITS.MAX_ARCHIVE_QUERY_LIMIT}`,
      },
      nonNegativeInteger('offset'),
    ],
  },
  archive_update: {
    guardFirst: stagingNameGuard,
    fields: [
      { field: 'id', test: (v) => typeof v === 'number' && Number.isInteger(v) && v > 0, message: (s) => `${s}: id must be a positive integer` },
      { field: 'changes', test: (v) => v !== null && typeof v === 'object' && !Array.isArray(v), message: (s) => `${s}: changes must be an object` },
    ],
  },
};

/** Subtypes whose payload carries a staging name — derived from the spec
 *  table so the set and the guard can never drift apart (PBI 2026-09-17-18). */
export const STAGING_NAME_SUBTYPES: readonly string[] = Object.entries(DASHBOARD_SQLITE_SUBTYPE_SPECS)
  .filter(([, spec]) => spec.guardFirst === stagingNameGuard)
  .map(([subtype]) => subtype);

// ------------------------------------------------------------------
// DashboardSqliteValidator — DASHBOARD_SQLITE payload validation
// ------------------------------------------------------------------
export class DashboardSqliteValidator implements MessageValidator<DashboardSqliteRequest> {
  validate(msg: unknown): DashboardSqliteRequest {
    if (!msg || typeof msg !== 'object') {
      throw new ValidationError('DashboardSqliteValidator', 'Message must be an object');
    }
    const m = msg as Record<string, unknown>;
    // If the caller passes the full ExtensionMessage, unwrap payload
    const payload: unknown = (m.payload !== undefined ? m.payload : m) as unknown;
    if (!payload || typeof payload !== 'object') {
      throw new ValidationError('DashboardSqliteValidator', 'payload must be an object', 'payload');
    }
    const p = payload as Record<string, unknown>;
    if (typeof p.subtype !== 'string') {
      throw new ValidationError('DashboardSqliteValidator', 'subtype is required', 'subtype');
    }
    if (!(ALL_DASHBOARD_SQLITE_SUBTYPES as readonly string[]).includes(p.subtype)) {
      throw new ValidationError('DashboardSqliteValidator', `Unknown subtype: ${p.subtype}`, 'subtype');
    }
    const subtype = p.subtype as DashboardSqliteRequest['subtype'];

    // Per-subtype wire-field enforcement (PBI 2026-09-17-18): the schema lives
    // in DASHBOARD_SQLITE_SUBTYPE_SPECS below — one row per required field,
    // interpreted uniformly, so adding a subtype is a table row instead of a
    // new if-block. Domain-mapping guards (staging-name decode, cutoff pair
    // verification, import byte estimate) stay as dedicated functions and keep
    // their original evaluation order.
    const spec = DASHBOARD_SQLITE_SUBTYPE_SPECS[subtype];
    if (spec) {
      spec.guardFirst?.(p, subtype);
      for (const f of spec.fields ?? []) {
        if (f.optional && p[f.field] === undefined) continue;
        if (!f.test(p[f.field], p)) {
          throw new ValidationError('DashboardSqliteValidator', f.message(subtype), f.field);
        }
      }
      spec.guardLast?.(p, subtype);
    }

    return payload as DashboardSqliteRequest;
  }
}

// ------------------------------------------------------------------
// FetchUrlValidator — FETCH_URL payload validation
// ------------------------------------------------------------------
export class FetchUrlValidator implements MessageValidator<FetchUrlMessage> {
  validate(msg: unknown): FetchUrlMessage {
    if (!msg || typeof msg !== 'object') {
      throw new ValidationError('FetchUrlValidator', 'Message must be an object');
    }
    const m = msg as Record<string, unknown>;
    if (m.type !== 'FETCH_URL') {
      throw new ValidationError('FetchUrlValidator', 'type must be FETCH_URL', 'type');
    }
    if (!m.payload || typeof m.payload !== 'object') {
      throw new ValidationError('FetchUrlValidator', 'payload is required', 'payload');
    }
    const payload = m.payload as Record<string, unknown>;
    assertHttpUrl(payload.url, 'FetchUrlValidator');
    assertProtocolVersion(m, 'FetchUrlValidator');
    return msg as FetchUrlMessage;
  }
}

// ------------------------------------------------------------------
// ManualRecordValidator — MANUAL_RECORD / PREVIEW_RECORD / SAVE_RECORD payload validation
// ------------------------------------------------------------------
export class ManualRecordValidator implements MessageValidator<ManualRecordMessage> {
  validate(msg: unknown): ManualRecordMessage {
    if (!msg || typeof msg !== 'object') {
      throw new ValidationError('ManualRecordValidator', 'Message must be an object');
    }
    const m = msg as Record<string, unknown>;
    const allowedTypes = ['MANUAL_RECORD', 'PREVIEW_RECORD', 'SAVE_RECORD'];
    if (typeof m.type !== 'string' || !allowedTypes.includes(m.type as string)) {
      throw new ValidationError('ManualRecordValidator', 'type must be MANUAL_RECORD/PREVIEW_RECORD/SAVE_RECORD', 'type');
    }
    if (!m.payload || typeof m.payload !== 'object') {
      throw new ValidationError('ManualRecordValidator', 'payload is required', 'payload');
    }
    const payload = m.payload as Record<string, unknown>;
    if (typeof payload.title !== 'string') {
      throw new ValidationError('ManualRecordValidator', 'payload.title must be string', 'title');
    }
    if (payload.title.length > VALIDATOR_LIMITS.MAX_TITLE_LENGTH) {
      throw new ValidationError('ManualRecordValidator', `payload.title exceeds ${VALIDATOR_LIMITS.MAX_TITLE_LENGTH} chars`, 'title');
    }
    // Same http/https restriction as FetchUrlValidator — blocks
    // javascript:/data: scheme URLs from reaching SQLite/dashboard rendering.
    // Scheme allowlist is the SSOT in utils/archiveGuards.ts (PBI 2026-09-06-01).
    // The non-empty check lives inside assertHttpUrl (single site).
    assertHttpUrl(payload.url, 'ManualRecordValidator');
    if (typeof payload.content !== 'string') {
      throw new ValidationError('ManualRecordValidator', 'payload.content must be string', 'content');
    }
    assertContentLength(payload.content, 'ManualRecordValidator');
    if (payload.force !== undefined && typeof payload.force !== 'boolean') {
      throw new ValidationError('ManualRecordValidator', 'payload.force must be boolean', 'force');
    }
    return msg as ManualRecordMessage;
  }
}

// ------------------------------------------------------------------
// RegenerateSummaryValidator — REGENERATE_SUMMARY (PBI 2026-09-22-04)
// ------------------------------------------------------------------
export class RegenerateSummaryValidator implements MessageValidator<RegenerateSummaryMessage> {
  validate(msg: unknown): RegenerateSummaryMessage {
    if (!msg || typeof msg !== 'object') {
      throw new ValidationError('RegenerateSummaryValidator', 'Message must be an object');
    }
    const m = msg as Record<string, unknown>;
    if (m.type !== 'REGENERATE_SUMMARY') {
      throw new ValidationError('RegenerateSummaryValidator', 'type must be REGENERATE_SUMMARY', 'type');
    }
    if (!m.payload || typeof m.payload !== 'object') {
      throw new ValidationError('RegenerateSummaryValidator', 'payload is required', 'payload');
    }
    const payload = m.payload as Record<string, unknown>;
    if (typeof payload.id !== 'number' || !Number.isInteger(payload.id) || payload.id <= 0) {
      throw new ValidationError('RegenerateSummaryValidator', 'payload.id must be a positive integer', 'id');
    }
    assertHttpUrl(payload.url, 'RegenerateSummaryValidator');
    if (typeof payload.title !== 'string') {
      throw new ValidationError('RegenerateSummaryValidator', 'payload.title must be string', 'title');
    }
    if (payload.title.length > VALIDATOR_LIMITS.MAX_TITLE_LENGTH) {
      throw new ValidationError('RegenerateSummaryValidator', `payload.title exceeds ${VALIDATOR_LIMITS.MAX_TITLE_LENGTH} chars`, 'title');
    }
    if (
      typeof payload.cleanseMode !== 'string' ||
      !(REGENERATE_CLEANSE_MODES as readonly string[]).includes(payload.cleanseMode)
    ) {
      throw new ValidationError(
        'RegenerateSummaryValidator',
        `payload.cleanseMode must be one of ${REGENERATE_CLEANSE_MODES.join(', ')}`,
        'cleanseMode',
      );
    }
    if (payload.force !== undefined && typeof payload.force !== 'boolean') {
      throw new ValidationError('RegenerateSummaryValidator', 'payload.force must be boolean', 'force');
    }
    assertProtocolVersion(m, 'RegenerateSummaryValidator');
    return msg as RegenerateSummaryMessage;
  }
}

// ------------------------------------------------------------------
// CheckDomainValidator — CHECK_DOMAIN (no payload, content-script allowed)
// ------------------------------------------------------------------
export class CheckDomainValidator implements MessageValidator<ExtensionMessage> {
  validate(msg: unknown): ExtensionMessage {
    if (!msg || typeof msg !== 'object') {
      throw new ValidationError('CheckDomainValidator', 'Message must be an object');
    }
    const m = msg as Record<string, unknown>;
    if (m.type !== 'CHECK_DOMAIN') {
      throw new ValidationError('CheckDomainValidator', 'type must be CHECK_DOMAIN', 'type');
    }
    // CHECK_DOMAIN must not have payload (NO_PAYLOAD_TYPES), but tolerate undefined
    if (m.payload !== undefined) {
      throw new ValidationError('CheckDomainValidator', 'CHECK_DOMAIN must not have payload', 'payload');
    }
    return msg as ExtensionMessage;
  }
}

// ------------------------------------------------------------------
// ContentCleansingExecutedValidator — CONTENT_CLEANSING_EXECUTED
// ------------------------------------------------------------------
export class ContentCleansingExecutedValidator implements MessageValidator<ContentCleansingExecutedMessage> {
  validate(msg: unknown): ContentCleansingExecutedMessage {
    if (!msg || typeof msg !== 'object') {
      throw new ValidationError('ContentCleansingExecutedValidator', 'Message must be an object');
    }
    const m = msg as Record<string, unknown>;
    if (m.type !== 'CONTENT_CLEANSING_EXECUTED') {
      throw new ValidationError('ContentCleansingExecutedValidator', 'type must be CONTENT_CLEANSING_EXECUTED', 'type');
    }
    if (!m.payload || typeof m.payload !== 'object') {
      throw new ValidationError('ContentCleansingExecutedValidator', 'payload is required', 'payload');
    }
    const p = m.payload as Record<string, unknown>;
    for (const field of ['hardStripRemoved', 'keywordStripRemoved', 'totalRemoved'] as const) {
      if (typeof p[field] !== 'number' || !Number.isFinite(p[field])) {
        throw new ValidationError('ContentCleansingExecutedValidator', `payload.${field} must be finite number`, field);
      }
    }
    return msg as ContentCleansingExecutedMessage;
  }
}

// Convenience singletons for registry wiring
export const serviceWorkerRequestValidator = new ServiceWorkerRequestValidator();
export const validVisitValidator = new ValidVisitValidator();
export const dashboardSqliteValidator = new DashboardSqliteValidator();
export const fetchUrlValidator = new FetchUrlValidator();
export const manualRecordValidator = new ManualRecordValidator();
export const regenerateSummaryValidator = new RegenerateSummaryValidator();
export const checkDomainValidator = new CheckDomainValidator();
export const contentCleansingExecutedValidator = new ContentCleansingExecutedValidator();
