// @layer 0 — Foundation: pure validation, no chrome dependencies
/**
 * messaging/validators.ts
 * Unified MessageValidator interface + concrete validators for 3 domains.
 *
 * PBI 2026-08-23-03: MessageValidator<T> defines a single seam for
 * validating unknown messages. Handlers receive already-validated payloads.
 */

import {
  MAX_BYTE_STAT_BYTES,
  MAX_CLEANSED_ELEMENTS,
  MAX_CLEANSED_REASON_CHARS,
  MAX_CLEANSED_REASONS,
  MAX_SCROLL_RATIO_PERCENT,
  MAX_VISIT_DURATION_SECONDS,
  VALIDATOR_LIMITS,
} from '../utils/limits.js';
import { isHttpScheme, assertCutoffPair, CutoffMismatchError, decodeStagingName } from '../utils/archiveGuards.js';
import { isSkipReasonCode } from '../utils/skipReason.js';
import type {
  ExtensionMessage,
  ValidVisitMessage,
  FetchUrlMessage,
  ManualRecordMessage,
  ContentCleansingExecutedMessage,
  RegenerateSummaryMessage,
  AskHistoryMessage,
  ExportResearchReportMessage,
  OwE2eProbeQueryMessage,
  OwE2EProbeStateMessage,
  RecordingSkipReasonMessage,
  GenerateReviewSummaryMessage,
  LogForwardMessage,
} from '../background/messageTypes.js';
import { REGENERATE_CLEANSE_MODES } from '../utils/aiSummaryCleaner/cleanseModeLadder.js';
import { SELECTION_CONTENT_ORIGIN } from '../utils/selectionText.js';
import {
  REPORT_SCOPE_NUMBER_FIELDS,
  REPORT_SCOPE_STRING_FIELDS,
} from './responseCanonical.js';
import type { ResearchReportScope } from './responseCanonical.js';
import type { DashboardSqliteRequest } from './dashboardSqliteProtocol.js';
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

function assertMessageObject(msg: unknown, validatorName: string): Record<string, unknown> {
  if (!msg || typeof msg !== 'object') {
    throw new ValidationError(validatorName, 'Message must be an object');
  }
  return msg as Record<string, unknown>;
}

function assertEnvelopeType(msg: unknown, validatorName: string, expectedType: string): Record<string, unknown> {
  const m = assertMessageObject(msg, validatorName);
  if (m.type !== expectedType) {
    throw new ValidationError(validatorName, `type must be ${expectedType}`, 'type');
  }
  return m;
}

function assertPayloadObject(m: Record<string, unknown>, validatorName: string): Record<string, unknown> {
  if (!m.payload || typeof m.payload !== 'object') {
    throw new ValidationError(validatorName, 'payload is required', 'payload');
  }
  return m.payload as Record<string, unknown>;
}

// ------------------------------------------------------------------
// ValidVisitValidator — VALID_VISIT payload validation
// ------------------------------------------------------------------

/** Byte-valued ByteStats fields share one bound; all are rejected (never
 *  clamped) when clearly invalid so a compromised sender cannot shift
 *  storage metadata by degrees. */
const BYTE_STAT_FIELDS = [
  'pageBytes',
  'candidateBytes',
  'originalBytes',
  'cleansedBytes',
  'aiSummaryOriginalBytes',
  'aiSummaryCleansedBytes',
] as const;

function assertByteStatField(
  payload: Record<string, unknown>,
  field: string,
  max: number,
  validatorName: string,
): void {
  const v = payload[field];
  if (v === undefined) return;
  // Number.isInteger rejects NaN/Infinity/fractions as well as non-numbers.
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) {
    throw new ValidationError(
      validatorName,
      `payload.${field} must be an integer 0..${max}`,
      field,
    );
  }
}

/**
 * Engagement metric bound (PBI 2026-10-23-02, shared with the mapper's
 * second-layer clamps). visit_duration is seconds — a fraction is legitimate,
 * so the check is finiteness rather than integrality; scrollRatioPercent is
 * the 0..100 percentage the content script reports. Rejected (never clamped)
 * so a garbage value cannot violate the schema CHECK and lose the record.
 */
function assertMetricField(
  payload: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
  validatorName: string,
): void {
  const v = payload[field];
  if (v === undefined) return;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw new ValidationError(
      validatorName,
      `payload.${field} must be a finite number ${min}..${max}`,
      field,
    );
  }
}

function assertCleansedReasons(
  payload: Record<string, unknown>,
  validatorName: string,
): void {
  const v = payload.aiSummaryCleansedReasons;
  if (v === undefined) return;
  if (!Array.isArray(v) || v.length > MAX_CLEANSED_REASONS) {
    throw new ValidationError(
      validatorName,
      `payload.aiSummaryCleansedReasons must be an array of at most ${MAX_CLEANSED_REASONS}`,
      'aiSummaryCleansedReasons',
    );
  }
  for (const el of v) {
    if (typeof el !== 'string' || el.length > MAX_CLEANSED_REASON_CHARS) {
      throw new ValidationError(
        validatorName,
        `payload.aiSummaryCleansedReasons elements must be strings of at most ${MAX_CLEANSED_REASON_CHARS} chars`,
        'aiSummaryCleansedReasons',
      );
    }
  }
}

export class ValidVisitValidator implements MessageValidator<ValidVisitMessage> {
  validate(msg: unknown): ValidVisitMessage {
    const m = assertEnvelopeType(msg, 'ValidVisitValidator', 'VALID_VISIT');
    const payload = assertPayloadObject(m, 'ValidVisitValidator');
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
    for (const field of BYTE_STAT_FIELDS) {
      assertByteStatField(payload, field, MAX_BYTE_STAT_BYTES, 'ValidVisitValidator');
    }
    assertByteStatField(payload, 'aiSummaryCleansedElements', MAX_CLEANSED_ELEMENTS, 'ValidVisitValidator');
    // PBI 2026-10-23-02: the engagement metrics ride VALID_VISIT payloads —
    // a garbage value ('abc' → NaN, 250 → 2.5) would violate the schema CHECK
    // and lose the record, so the validator rejects (never clamps) them.
    assertMetricField(payload, 'visitDurationSeconds', 0, MAX_VISIT_DURATION_SECONDS, 'ValidVisitValidator');
    assertMetricField(payload, 'scrollRatioPercent', 0, MAX_SCROLL_RATIO_PERCENT, 'ValidVisitValidator');
    if (
      payload.aiSummaryCleansedReason !== undefined &&
      (typeof payload.aiSummaryCleansedReason !== 'string' ||
        payload.aiSummaryCleansedReason.length > MAX_CLEANSED_REASON_CHARS)
    ) {
      throw new ValidationError(
        'ValidVisitValidator',
        `payload.aiSummaryCleansedReason must be a string of at most ${MAX_CLEANSED_REASON_CHARS} chars`,
        'aiSummaryCleansedReason',
      );
    }
    assertCleansedReasons(payload, 'ValidVisitValidator');
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

// Shared type/bound predicates (PBI 2026-10-09-01): the archive wire-table
// handler gate composes its validate lambdas from these so a single bound
// change cannot land on one gate only. Keep them pure and dependency-free.
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

export function isPositiveInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

const finiteNumber = (field: string): DashboardSqliteFieldSpec => ({
  field,
  test: isFiniteNumber,
  message: (s) => `${s}: ${field} must be finite number`,
});

const nonNegativeInteger = (field: string): DashboardSqliteFieldSpec => ({
  field,
  test: isNonNegativeInteger,
  message: (s) => `${s}: ${field} must be a non-negative integer`,
});

const nonEmptyString = (field: string): DashboardSqliteFieldSpec => ({
  field,
  test: isNonEmptyString,
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
 * Exported so the all-subtype coverage test can fail closed on a forgotten
 * row (an undefined spec skips payload validation in validate() entirely).
 */
export const DASHBOARD_SQLITE_SUBTYPE_SPECS: Readonly<Record<string, DashboardSqliteSubtypeSpec>> = {
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
        test: (v) => isPositiveInteger(v) && v <= VALIDATOR_LIMITS.MAX_ARCHIVE_EXPORT_CHUNK_BYTES,
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
        test: (v) => isPositiveInteger(v) && v <= VALIDATOR_LIMITS.MAX_ARCHIVE_QUERY_LIMIT,
        message: (s) => `${s}: limit must be 1..${VALIDATOR_LIMITS.MAX_ARCHIVE_QUERY_LIMIT}`,
      },
      nonNegativeInteger('offset'),
    ],
  },
  archive_update: {
    guardFirst: stagingNameGuard,
    fields: [
      { field: 'id', test: isPositiveInteger, message: (s) => `${s}: id must be a positive integer` },
      { field: 'changes', test: (v) => v !== null && typeof v === 'object' && !Array.isArray(v), message: (s) => `${s}: changes must be an object` },
    ],
  },
};

/** First failure produced by `interpretSubtypeSpec`: either a field row that
 *  rejected, or the error a domain guard threw. Both presentations read this
 *  one result — see `interpretSubtypeSpec` below. */
export interface SubtypeSpecFailure {
  /** Rejection text — byte-identical on both presentations. */
  message: string;
  /** Field row that rejected. Guard rejections leave this undefined because
   *  their own ValidationError carries the field via `cause`. */
  field?: string;
  /** The original guard throw, rethrown verbatim by the envelope path so its
   *  validatorName / field / stack stay untouched. */
  cause?: Error;
}

/**
 * The ONE interpretation of a subtype spec row (single interpreter for the
 * envelope gate and the archive handler entry): guardFirst → field rows →
 * guardLast, first failure wins. Both presentations are thin renderers of the
 * returned failure:
 *
 *   - `evaluateSubtypeSpec` (archive handler entry, PBI 2026-10-16-02)
 *     renders `message`,
 *   - `DashboardSqliteValidator.validate` (envelope gate) rethrows `cause`
 *     verbatim, or wraps a field rejection in ValidationError.
 *
 * Before this existed, PBI 2026-10-11-10 had removed the wire rows' hand-
 * written checks but the envelope validator kept its own copy-pasted
 * interpretation of `spec.fields` — so every change to `optional` handling or
 * field attachment had to be made twice or the two gates drifted again.
 *
 * Unknown subtype fails closed (no spec row): the envelope validator
 * pre-gates subtypes against ALL_DASHBOARD_SQLITE_SUBTYPES, and the handler
 * entry dispatches on fixed descriptor subtypes — but the handler-entry
 * presentation never passes through that pre-gate,
 * so a pass-through here would be a fail-open on the handler path (PBI
 * 2026-10-16-01). A known subtype with intentionally no checks (e.g. `query`
 * accepts arbitrary extra fields) still passes; anything else is rejected.
 *
 * `subtype` is injected into the payload because the guards and messages read it.
 */
export function interpretSubtypeSpec(
  subtype: string,
  payload: Record<string, unknown>,
): SubtypeSpecFailure | null {
  const spec = DASHBOARD_SQLITE_SUBTYPE_SPECS[subtype];
  if (!spec) {
    if ((ALL_DASHBOARD_SQLITE_SUBTYPES as readonly string[]).includes(subtype)) return null;
    return { message: `Unknown subtype: ${subtype}`, field: 'subtype' };
  }
  const p: Record<string, unknown> = { ...payload, subtype };
  try {
    spec.guardFirst?.(p, subtype);
    for (const f of spec.fields ?? []) {
      if (f.optional && p[f.field] === undefined) continue;
      if (!f.test(p[f.field], p)) return { message: f.message(subtype), field: f.field };
    }
    spec.guardLast?.(p, subtype);
  } catch (error) {
    if (error instanceof Error) return { message: error.message, cause: error };
    return { message: String(error) };
  }
  return null;
}

/**
 * Evaluate a subtype spec against a payload without throwing (wire-table
 * presentation of the single interpreter).
 *
 * Returns the first error message, or null when the payload passes. Single
 * evaluator shared by the envelope validator (which throws ValidationError) and
 * the archive handler entry (PBI 2026-10-16-02): before that the wire rows
 * hand-wrote their own field checks, so the two paths accepted different
 * payloads and the divergence had to be pinned by a test instead of closed.
 */
export function evaluateSubtypeSpec(subtype: string, payload: Record<string, unknown>): string | null {
  const failure = interpretSubtypeSpec(subtype, payload);
  return failure === null ? null : failure.message;
}

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
    const m = assertMessageObject(msg, 'DashboardSqliteValidator');
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
    // in DASHBOARD_SQLITE_SUBTYPE_SPECS above — one row per required field,
    // interpreted uniformly, so adding a subtype is a table row instead of a
    // new if-block. Domain-mapping guards (staging-name decode, cutoff pair
    // verification, import byte estimate) stay as dedicated functions and keep
    // their original evaluation order. The interpretation loop itself lives
    // once, in interpretSubtypeSpec — this envelope gate and the archive wire
    // table are two renderings of its result, never two implementations.
    const failure = interpretSubtypeSpec(subtype, p);
    if (failure !== null) {
      // A guard's own ValidationError propagates verbatim (it already carries
      // validatorName / field); only field-row rejections are wrapped here.
      if (failure.cause !== undefined) throw failure.cause;
      throw new ValidationError('DashboardSqliteValidator', failure.message, failure.field);
    }

    return payload as DashboardSqliteRequest;
  }
}

// ------------------------------------------------------------------
// FetchUrlValidator — FETCH_URL payload validation
// ------------------------------------------------------------------
export class FetchUrlValidator implements MessageValidator<FetchUrlMessage> {
  validate(msg: unknown): FetchUrlMessage {
    const m = assertEnvelopeType(msg, 'FetchUrlValidator', 'FETCH_URL');
    const payload = assertPayloadObject(m, 'FetchUrlValidator');
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
    const m = assertMessageObject(msg, 'ManualRecordValidator');
    const allowedTypes = ['MANUAL_RECORD', 'PREVIEW_RECORD', 'SAVE_RECORD'];
    if (typeof m.type !== 'string' || !allowedTypes.includes(m.type as string)) {
      throw new ValidationError('ManualRecordValidator', 'type must be MANUAL_RECORD/PREVIEW_RECORD/SAVE_RECORD', 'type');
    }
    const payload = assertPayloadObject(m, 'ManualRecordValidator');
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
    // PBI 2026-10-21-02: the three payload types are `{...} & ByteStatsPayload`
    // unions, so the byte-stat fields are wire-reachable even though the popup
    // sender does not ship them today. Same reject (never clamp) policy as
    // ValidVisitValidator — an invalid value is a wire-contract violation.
    if (payload.fallbackTriggered !== undefined && typeof payload.fallbackTriggered !== 'boolean') {
      throw new ValidationError('ManualRecordValidator', 'payload.fallbackTriggered must be boolean', 'fallbackTriggered');
    }
    if (payload.fallbackReason !== undefined && typeof payload.fallbackReason !== 'string') {
      throw new ValidationError('ManualRecordValidator', 'payload.fallbackReason must be a string', 'fallbackReason');
    }
    // PBI 2026-10-31-03: the saved-row origin marker. Allowlist-fail-closed —
    // an arbitrary origin string must never reach the content_origin column,
    // so anything outside the shared domain (utils/selectionText) is a wire-
    // contract violation. Same reject (never clamp) policy as fallbackReason.
    if (
      payload.contentOrigin !== undefined &&
      payload.contentOrigin !== SELECTION_CONTENT_ORIGIN
    ) {
      throw new ValidationError(
        'ManualRecordValidator',
        `payload.contentOrigin must be "${SELECTION_CONTENT_ORIGIN}"`,
        'contentOrigin',
      );
    }
    for (const field of BYTE_STAT_FIELDS) {
      assertByteStatField(payload, field, MAX_BYTE_STAT_BYTES, 'ManualRecordValidator');
    }
    assertByteStatField(payload, 'aiSummaryCleansedElements', MAX_CLEANSED_ELEMENTS, 'ManualRecordValidator');
    if (
      payload.aiSummaryCleansedReason !== undefined &&
      (typeof payload.aiSummaryCleansedReason !== 'string' ||
        payload.aiSummaryCleansedReason.length > MAX_CLEANSED_REASON_CHARS)
    ) {
      throw new ValidationError(
        'ManualRecordValidator',
        `payload.aiSummaryCleansedReason must be a string of at most ${MAX_CLEANSED_REASON_CHARS} chars`,
        'aiSummaryCleansedReason',
      );
    }
    assertCleansedReasons(payload, 'ManualRecordValidator');
    return msg as ManualRecordMessage;
  }
}

// ------------------------------------------------------------------
// RegenerateSummaryValidator — REGENERATE_SUMMARY (PBI 2026-09-22-04)
// ------------------------------------------------------------------
export class RegenerateSummaryValidator implements MessageValidator<RegenerateSummaryMessage> {
  validate(msg: unknown): RegenerateSummaryMessage {
    const m = assertEnvelopeType(msg, 'RegenerateSummaryValidator', 'REGENERATE_SUMMARY');
    const payload = assertPayloadObject(m, 'RegenerateSummaryValidator');
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
// AskHistoryValidator — ASK_HISTORY (PBI 2026-10-23-08)
// ------------------------------------------------------------------
export class AskHistoryValidator implements MessageValidator<AskHistoryMessage> {
  validate(msg: unknown): AskHistoryMessage {
    const m = assertEnvelopeType(msg, 'AskHistoryValidator', 'ASK_HISTORY');
    const payload = assertPayloadObject(m, 'AskHistoryValidator');
    if (typeof payload.question !== 'string') {
      throw new ValidationError('AskHistoryValidator', 'payload.question must be string', 'question');
    }
    // Same cap as the DASHBOARD_SQLITE search query: the question is the
    // evidence search term and the prompt head.
    if (payload.question.length > VALIDATOR_LIMITS.MAX_SEARCH_QUERY_LENGTH) {
      throw new ValidationError('AskHistoryValidator', `payload.question exceeds ${VALIDATOR_LIMITS.MAX_SEARCH_QUERY_LENGTH} chars`, 'question');
    }
    if (payload.collectionId !== undefined && payload.collectionId !== null && typeof payload.collectionId !== 'string') {
      throw new ValidationError('AskHistoryValidator', 'payload.collectionId must be string or null', 'collectionId');
    }
    assertProtocolVersion(m, 'AskHistoryValidator');
    return msg as AskHistoryMessage;
  }
}

// ------------------------------------------------------------------
// ExportResearchReportValidator — EXPORT_RESEARCH_REPORT (PBI 2026-10-23-09)
// ------------------------------------------------------------------
export class ExportResearchReportValidator implements MessageValidator<ExportResearchReportMessage> {
  validate(msg: unknown): ExportResearchReportMessage {
    const m = assertEnvelopeType(msg, 'ExportResearchReportValidator', 'EXPORT_RESEARCH_REPORT');
    const payload = assertPayloadObject(m, 'ExportResearchReportValidator');
    const scope = payload.scope;
    if (scope !== undefined) {
      if (typeof scope !== 'object' || scope === null) {
        throw new ValidationError('ExportResearchReportValidator', 'payload.scope must be object', 'scope');
      }
      // Field sets are owned by the canonical scope tables (single owner
      // with the handler-side normalizer); only the rejection wording stays
      // here. The checked shape is ResearchReportScope.
      const s: Record<string, unknown> & Partial<ResearchReportScope> = scope as Record<string, unknown>;
      for (const field of REPORT_SCOPE_STRING_FIELDS) {
        const value = s[field];
        if (value !== undefined && typeof value !== 'string') {
          throw new ValidationError('ExportResearchReportValidator', `payload.scope.${field} must be string`, field);
        }
        if (typeof value === 'string' && value.length > VALIDATOR_LIMITS.MAX_SEARCH_QUERY_LENGTH) {
          throw new ValidationError('ExportResearchReportValidator', `payload.scope.${field} exceeds ${VALIDATOR_LIMITS.MAX_SEARCH_QUERY_LENGTH} chars`, field);
        }
      }
      for (const field of REPORT_SCOPE_NUMBER_FIELDS) {
        const value = s[field];
        if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
          throw new ValidationError('ExportResearchReportValidator', `payload.scope.${field} must be finite number`, field);
        }
      }
    }
    if (payload.sendToObsidian !== undefined && typeof payload.sendToObsidian !== 'boolean') {
      throw new ValidationError('ExportResearchReportValidator', 'payload.sendToObsidian must be boolean', 'sendToObsidian');
    }
    assertProtocolVersion(m, 'ExportResearchReportValidator');
    return msg as ExportResearchReportMessage;
  }
}

// ------------------------------------------------------------------
// CheckDomainValidator — CHECK_DOMAIN (no payload, content-script allowed)
// ------------------------------------------------------------------
export class CheckDomainValidator implements MessageValidator<ExtensionMessage> {
  validate(msg: unknown): ExtensionMessage {
    const m = assertEnvelopeType(msg, 'CheckDomainValidator', 'CHECK_DOMAIN');
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
    const m = assertEnvelopeType(msg, 'ContentCleansingExecutedValidator', 'CONTENT_CLEANSING_EXECUTED');
    const p = assertPayloadObject(m, 'ContentCleansingExecutedValidator');
    for (const field of ['hardStripRemoved', 'keywordStripRemoved', 'totalRemoved'] as const) {
      if (typeof p[field] !== 'number' || !Number.isFinite(p[field])) {
        throw new ValidationError('ContentCleansingExecutedValidator', `payload.${field} must be finite number`, field);
      }
    }
    return msg as ContentCleansingExecutedMessage;
  }
}

// ------------------------------------------------------------------
// TestObsidianValidator — TEST_OBSIDIAN (connection-test form values)
// ------------------------------------------------------------------
/**
 * Wire-shape gate for TEST_OBSIDIAN. The dashboard sends optional form values
 * (empty fields are dropped upstream), so every field is optional; what the
 * validator enforces is type + bound, matching the sibling validators' style.
 * Substantive host/loopback rules stay in obsidianConfigValidator downstream —
 * this row exists so TEST_OBSIDIAN reaches its handler through the same
 * validated path as every other message with a payload.
 */
const TEST_OBSIDIAN_FIELD_CAPS = {
  /** Obsidian Local REST API tokens are short UUID-ish strings. */
  apiKey: 512,
  /** Longest legitimate hostname is a fully-qualified DNS name (253 octets). */
  host: 253,
} as const;

export class TestObsidianValidator implements MessageValidator<ExtensionMessage> {
  validate(msg: unknown): ExtensionMessage {
    const m = assertEnvelopeType(msg, 'TestObsidianValidator', 'TEST_OBSIDIAN');
    if (m.payload === undefined) {
      return msg as ExtensionMessage;
    }
    if (!m.payload || typeof m.payload !== 'object' || Array.isArray(m.payload)) {
      throw new ValidationError('TestObsidianValidator', 'payload must be an object', 'payload');
    }
    const p = m.payload as Record<string, unknown>;
    for (const field of ['apiKey', 'host'] as const) {
      const value = p[field];
      if (value === undefined) continue;
      if (typeof value !== 'string' || value.length > TEST_OBSIDIAN_FIELD_CAPS[field]) {
        throw new ValidationError('TestObsidianValidator', `payload.${field} must be a string of at most ${TEST_OBSIDIAN_FIELD_CAPS[field]} chars`, field);
      }
    }
    if (p.protocol !== undefined && p.protocol !== 'http' && p.protocol !== 'https') {
      throw new ValidationError('TestObsidianValidator', 'payload.protocol must be "http" or "https"', 'protocol');
    }
    if (p.port !== undefined) {
      let portNum = NaN;
      if (typeof p.port === 'number') {
        portNum = p.port;
      } else if (typeof p.port === 'string') {
        portNum = Number(p.port);
      }
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        throw new ValidationError('TestObsidianValidator', 'payload.port must be an integer 1-65535', 'port');
      }
    }
    return msg as ExtensionMessage;
  }
}

// ------------------------------------------------------------------
// E2EProbeQueryValidator — OW_PROBE_QUERY (no payload, mirror CheckDomain)
// ------------------------------------------------------------------
export class E2EProbeQueryValidator implements MessageValidator<OwE2eProbeQueryMessage> {
  validate(msg: unknown): OwE2eProbeQueryMessage {
    const m = assertEnvelopeType(msg, 'E2EProbeQueryValidator', 'OW_PROBE_QUERY');
    // OW_PROBE_QUERY must not have payload (NO_PAYLOAD_TYPES), but tolerate undefined
    if (m.payload !== undefined) {
      throw new ValidationError('E2EProbeQueryValidator', 'OW_PROBE_QUERY must not have payload', 'payload');
    }
    return msg as OwE2eProbeQueryMessage;
  }
}

// ------------------------------------------------------------------
// E2EProbeStateValidator — OW_PROBE_STATE (strict probe-state shape)
// ------------------------------------------------------------------
const E2E_PROBE_STATE_NUMBER_FIELDS = [
  'maxScrollPercentage',
  'startTime',
  'minVisitDuration',
  'minScrollDepth',
  'duration',
] as const;

/** The complete OWTestState payload key set (6 keys) — SSOT: the shape in
 *  src/utils/e2eTestState.ts. Anything else is rejected, not stored. */
const E2E_PROBE_STATE_KEYS: ReadonlySet<string> = new Set<string>([
  ...E2E_PROBE_STATE_NUMBER_FIELDS,
  'isValidVisitReported',
]);

export class E2EProbeStateValidator implements MessageValidator<OwE2EProbeStateMessage> {
  validate(msg: unknown): OwE2EProbeStateMessage {
    const m = assertEnvelopeType(msg, 'E2EProbeStateValidator', 'OW_PROBE_STATE');
    if (!m.payload || typeof m.payload !== 'object' || Array.isArray(m.payload)) {
      throw new ValidationError('E2EProbeStateValidator', 'payload is required', 'payload');
    }
    const p = m.payload as Record<string, unknown>;
    // Unknown-key allowlist (Blue Team review 2026-10-15): the handler stores
    // this payload verbatim into chrome.storage.session, so a key outside
    // OWTestState would land in extension state unexamined. The six known keys
    // are the whole contract; every other key is a rejection.
    for (const key of Object.keys(p)) {
      if (!E2E_PROBE_STATE_KEYS.has(key)) {
        throw new ValidationError(
          'E2EProbeStateValidator',
          `payload.${key} is not a known probe-state key`,
          key,
        );
      }
    }
    // duration is fractional seconds — finite check, not integer.
    for (const field of E2E_PROBE_STATE_NUMBER_FIELDS) {
      if (typeof p[field] !== 'number' || !Number.isFinite(p[field])) {
        throw new ValidationError('E2EProbeStateValidator', `payload.${field} must be a finite number`, field);
      }
    }
    if (typeof p.isValidVisitReported !== 'boolean') {
      throw new ValidationError('E2EProbeStateValidator', 'payload.isValidVisitReported must be a boolean', 'isValidVisitReported');
    }
    return msg as OwE2EProbeStateMessage;
  }
}

// ------------------------------------------------------------------
// RecordingSkipReasonValidator — RECORDING_SKIP_REASON (PBI 2026-10-31-01)
// ------------------------------------------------------------------

/**
 * The complete skip reason payload key set — SSOT: the shared skip vocabulary
 * in src/utils/skipReason.ts. Anything else is rejected, not stored: the
 * handler persists a normalized record into extension state, so a payload key
 * outside the contract (a URL, a title) would land there unexamined.
 */
const SKIP_REASON_PAYLOAD_KEYS: ReadonlySet<string> = new Set<string>(['reason']);

export class RecordingSkipReasonValidator implements MessageValidator<RecordingSkipReasonMessage> {
  validate(msg: unknown): RecordingSkipReasonMessage {
    const m = assertEnvelopeType(msg, 'RecordingSkipReasonValidator', 'RECORDING_SKIP_REASON');
    if (!m.payload || typeof m.payload !== 'object' || Array.isArray(m.payload)) {
      throw new ValidationError('RecordingSkipReasonValidator', 'payload is required', 'payload');
    }
    const p = m.payload as Record<string, unknown>;
    // Unknown-key allowlist: reason is the whole contract; every other key is
    // a rejection (same policy as the E2E probe-state validator above).
    for (const key of Object.keys(p)) {
      if (!SKIP_REASON_PAYLOAD_KEYS.has(key)) {
        throw new ValidationError(
          'RecordingSkipReasonValidator',
          `payload.${key} is not a known skip-reason key`,
          key,
        );
      }
    }
    if (!isSkipReasonCode(p.reason)) {
      throw new ValidationError(
        'RecordingSkipReasonValidator',
        'payload.reason is not a known skip-reason code',
        'reason',
      );
    }
    return msg as RecordingSkipReasonMessage;
  }
}

// ------------------------------------------------------------------
// GenerateReviewSummaryValidator — GENERATE_REVIEW_SUMMARY (PBI 2026-10-21-02)
// ------------------------------------------------------------------
/**
 * Wire-shape gate for GENERATE_REVIEW_SUMMARY. The payload type is required
 * (`periodType: 'weekly' | 'monthly'`), but the message had no registered
 * validator, so dispatch's fail-open skip let undefined and garbage fall
 * through to the handler's silent weekly fallback. The enum is the whole
 * contract; anything else is a rejection.
 */
export class GenerateReviewSummaryValidator implements MessageValidator<GenerateReviewSummaryMessage> {
  validate(msg: unknown): GenerateReviewSummaryMessage {
    const m = assertEnvelopeType(msg, 'GenerateReviewSummaryValidator', 'GENERATE_REVIEW_SUMMARY');
    const payload = assertPayloadObject(m, 'GenerateReviewSummaryValidator');
    if (payload.periodType !== 'weekly' && payload.periodType !== 'monthly') {
      throw new ValidationError(
        'GenerateReviewSummaryValidator',
        'payload.periodType must be one of weekly, monthly',
        'periodType',
      );
    }
    assertProtocolVersion(m, 'GenerateReviewSummaryValidator');
    return msg as GenerateReviewSummaryMessage;
  }
}

// ------------------------------------------------------------------
// LogForwardValidator — LOG_FORWARD (PBI 2026-10-21-02)
// ------------------------------------------------------------------
/**
 * Wire-shape gate for LOG_FORWARD. The offscreen document is the expected
 * caller and the handler is the trust boundary, so level is checked against
 * the declared enum (unknown levels were silently demoted to debug before
 * this row existed) and the remaining fields are type-checked to match the
 * declared payload shape.
 */
export class LogForwardValidator implements MessageValidator<LogForwardMessage> {
  validate(msg: unknown): LogForwardMessage {
    const m = assertEnvelopeType(msg, 'LogForwardValidator', 'LOG_FORWARD');
    const payload = assertPayloadObject(m, 'LogForwardValidator');
    if (payload.level !== 'error' && payload.level !== 'warn' && payload.level !== 'info') {
      throw new ValidationError(
        'LogForwardValidator',
        'payload.level must be one of info, warn, error',
        'level',
      );
    }
    if (typeof payload.message !== 'string') {
      throw new ValidationError('LogForwardValidator', 'payload.message must be string', 'message');
    }
    if (
      payload.details !== undefined &&
      (typeof payload.details !== 'object' || payload.details === null || Array.isArray(payload.details))
    ) {
      throw new ValidationError('LogForwardValidator', 'payload.details must be an object', 'details');
    }
    if (typeof payload.source !== 'string') {
      throw new ValidationError('LogForwardValidator', 'payload.source must be string', 'source');
    }
    assertProtocolVersion(m, 'LogForwardValidator');
    return msg as LogForwardMessage;
  }
}

// Convenience singletons for registry wiring
export const validVisitValidator = new ValidVisitValidator();
export const dashboardSqliteValidator = new DashboardSqliteValidator();
export const fetchUrlValidator = new FetchUrlValidator();
export const manualRecordValidator = new ManualRecordValidator();
export const regenerateSummaryValidator = new RegenerateSummaryValidator();
export const askHistoryValidator = new AskHistoryValidator();
export const exportResearchReportValidator = new ExportResearchReportValidator();
export const checkDomainValidator = new CheckDomainValidator();
export const contentCleansingExecutedValidator = new ContentCleansingExecutedValidator();
export const testObsidianValidator = new TestObsidianValidator();
export const e2eProbeQueryValidator = new E2EProbeQueryValidator();
export const e2eProbeStateValidator = new E2EProbeStateValidator();
export const recordingSkipReasonValidator = new RecordingSkipReasonValidator();
export const generateReviewSummaryValidator = new GenerateReviewSummaryValidator();
export const logForwardValidator = new LogForwardValidator();
