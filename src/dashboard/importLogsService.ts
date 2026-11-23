/**
 * importLogsService.ts
 * Import browsing logs from JSON export files into SQLite.
 */

import { sqliteClient } from './dashboardSqliteService.js';
import { exportHmacSigner } from '../utils/storage/encryptionSession.js';
import type { HmacSigner } from '../utils/crypto/hmacSigner.js';
import { logWarn } from '../utils/logger/api.js';

interface ExportedRow {
  url: string;
  title?: string;
  summary?: string;
  tags?: string;
  created_at: number;
  domain?: string;
  visit_duration?: number;
  scroll_ratio?: number;
  is_starred?: number;
  is_deleted?: number;
}

interface ExportedData {
  version?: number;
  table?: string;
  rows?: ExportedRow[];
  signature?: string;
}

/**
 * Upper bound on total rows accepted from a single import file (VULN-023).
 * A different concept from the per-message MAX_IMPORT_ROWS in
 * utils/limits.ts: this pre-check gates the whole file before it is
 * split into per-request batches, so it stays larger by design.
 */
import { IMPORT_TOTAL_ROW_CAP, MAX_SUMMARY_LENGTH } from '../utils/limits.js';
export { IMPORT_TOTAL_ROW_CAP };
/** Upper bound on the raw import text, mirroring the settings 10 MiB cap. */
import { MAX_IMPORT_TEXT_BYTES } from '../utils/limits.js';
export { MAX_IMPORT_TEXT_BYTES };

const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 2048;
const MAX_TAGS_LENGTH = 8192;
const MAX_DOMAIN_LENGTH = 256;
// created_at is epoch milliseconds. Only a positive, finite value bounded above
// by now + 1 day of skew is required: older exports may have used a smaller
// epoch unit, and rejecting them would drop genuine history.
const MIN_CREATED_AT = 1;
const CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;
const MAX_VISIT_DURATION_MS = 24 * 60 * 60 * 1000;
/** How many rejected rows the tolerant report exemplifies (reason counts cover all). */
const MAX_INVALID_SAMPLES = 3;

function isOptionalFiniteInRange(value: unknown, min: number, max: number): boolean {
  return (
    value === undefined ||
    (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max)
  );
}

function isOptionalFlag(value: unknown): boolean {
  return value === undefined || value === 0 || value === 1;
}

/**
 * Tolerant import shapes (PBI 2026-11-23-05; AI repair is out of scope).
 *
 * Legacy exports predate the `{ version, table, rows }` envelope: the row
 * list may live under a different key, be a keyed object instead of an
 * array, or be a bare top-level array. `rows` stays first so the current
 * path keeps its exact precedence.
 */
const ROW_LIST_KEYS = ['rows', 'logs', 'records', 'items', 'entries', 'data', 'history'] as const;

/**
 * Legacy aliases for the four remapped fields. `url` has no alias and is
 * never complemented: a row without `url` stays invalid. `created_at` is
 * remapped but never defaulted: a row without any datetime key stays invalid.
 */
const CREATED_AT_ALIASES = ['createdAt', 'timestamp', 'time', 'date', 'visited_at', 'visitedAt'] as const;
const TITLE_ALIASES = ['name', 'pageTitle', 'page_title', 'heading', 'subject'] as const;
const SUMMARY_ALIASES = ['description', 'snippet', 'excerpt'] as const;
const TAGS_ALIASES = ['tag', 'labels', 'label', 'keywords'] as const;

/** First defined value under any of the keys, or `undefined` when absent. */
function pickAlias(src: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (key in src && src[key] !== undefined) return src[key];
  }
  return undefined;
}

/** True when any alias key is present (even with an `undefined` value). */
function hasAlias(src: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((key) => key in src);
}

/**
 * Normalize one raw row to the canonical shape.
 *
 * Rows that already use canonical keys pass through untouched (same
 * reference), so the current path keeps its exact bytes. Only rows carrying
 * a legacy alias are rebuilt: aliases are mapped to canonical keys and
 * missing optional text is filled with `''`. Unknown keys ride along, the
 * same as today. A tags array is stringified (legacy exports stored it
 * unserialized); every other mistyped value is left for validation to
 * reject with a reason.
 *
 * @internal exported for testing
 */
export function normalizeImportRow(raw: unknown): ExportedRow | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const mapped =
    hasAlias(src, CREATED_AT_ALIASES) ||
    hasAlias(src, TITLE_ALIASES) ||
    hasAlias(src, SUMMARY_ALIASES) ||
    hasAlias(src, TAGS_ALIASES) ||
    (('tags' in src) && Array.isArray(src.tags));
  if (!mapped) return src as unknown as ExportedRow;
  const tagsValue = pickAlias(src, ['tags', ...TAGS_ALIASES]);
  const canonical: Record<string, unknown> = { ...src };
  for (const key of [...CREATED_AT_ALIASES, ...TITLE_ALIASES, ...SUMMARY_ALIASES, ...TAGS_ALIASES]) {
    delete canonical[key];
  }
  return {
    ...canonical,
    url: src.url as string,
    created_at: (pickAlias(src, ['created_at', ...CREATED_AT_ALIASES]) ?? src.created_at) as number,
    title: (pickAlias(src, ['title', ...TITLE_ALIASES]) ?? '') as string,
    summary: (pickAlias(src, ['summary', ...SUMMARY_ALIASES]) ?? '') as string,
    tags: (Array.isArray(tagsValue) ? JSON.stringify(tagsValue) : (tagsValue ?? '')) as string,
  };
}

/**
 * Collect the row list from any accepted top-level shape: the current
 * `{ rows: [...] }` envelope, a legacy envelope key holding an array or a
 * keyed object, or a bare top-level array.
 *
 * @internal exported for testing
 */
export function extractImportRows(parsed: unknown): { rows: unknown[] } | { error: string } {
  if (Array.isArray(parsed)) return { rows: parsed };
  if (parsed && typeof parsed === 'object') {
    const body = parsed as Record<string, unknown>;
    for (const key of ROW_LIST_KEYS) {
      const candidate = body[key];
      if (Array.isArray(candidate)) return { rows: candidate };
      if (candidate && typeof candidate === 'object') return { rows: Object.values(candidate) };
    }
  }
  return { error: 'No records found in file' };
}

/**
 * Verifier seam for the log import authentication (PBI 2026-11-06-03).
 * Structural (not nominal): a test double with a different secret reproduces
 * a foreign-profile environment without mocking `encryptionSession`.
 */
export type ImportLogsVerifier = Pick<HmacSigner, 'verify'>;

export interface ImportLogsOptions {
  verifier?: ImportLogsVerifier | undefined;
}

/**
 * Verify the HMAC signature over the signature-stripped body. Returns an error
 * string to abort the import, or `null` when the file is authentic.
 */
async function verifyExportSignature(
  parsed: ExportedData,
  verifier: ImportLogsVerifier
): Promise<string | null> {
  if (typeof parsed.signature !== 'string' || parsed.signature.length === 0) {
    return 'This log file is unsigned and cannot be imported. Re-export it from this extension.';
  }
  const { signature, ...body } = parsed;
  if (!(await verifier.verify(JSON.stringify(body, null, 2), signature))) {
    return 'Log file signature verification failed. The file may be corrupted or was exported from a different browser profile.';
  }
  return null;
}

/**
 * Options for the canonical row validator.
 *
 * `strict: true` (default) is the dashboard file-import gate: length caps,
 * the `created_at` floor, the future bound, and non-null numerics/flags.
 * `strict: false` reproduces the background envelope gate
 * (`validateImportRow` in messaging/validators.ts) exactly: no length caps,
 * no `created_at` floor or future bound, no `visit_duration` ceiling, and
 * `null` counts as absent for optional fields. `now` injects the clock for
 * the future bound so tests stay deterministic without real-time waits.
 */
export interface ImportRowValidationOptions {
  strict?: boolean | undefined;
  now?: number | undefined;
}

/**
 * Canonical per-row rejection reason, or `null` when the row may proceed.
 *
 * Single definition behind both the boolean gate and the tolerant report,
 * with a strict/lenient switch: the dashboard calls with `strict: true`
 * (via `validateImportRowReason` below), while `strict: false` is the
 * background envelope parity shape. The lenient branch intentionally
 * duplicates `validateImportRow` instead of importing it (dashboard must not
 * depend on the messaging layer); parity is pinned by
 * importLogsService-validateRow.test.ts, so the background path decision
 * never changes here. Messages stay byte-identical to both gates where the
 * checks overlap.
 *
 * @internal exported for testing
 */
export function validateImportRowWithOptions(
  row: unknown,
  options?: ImportRowValidationOptions
): string | null {
  const strict = options?.strict ?? true;
  const now = options?.now ?? Date.now();
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    return 'must be an object';
  }
  const r = row as unknown as Record<string, unknown>;

  if (typeof r.url !== 'string' || r.url.length === 0) return 'url must be a non-empty string';
  if (strict && r.url.length > MAX_URL_LENGTH) {
    return `url must be at most ${MAX_URL_LENGTH} characters`;
  }

  if (typeof r.created_at !== 'number' || !Number.isFinite(r.created_at)) {
    return 'created_at must be a finite number';
  }
  if (strict) {
    if (r.created_at < MIN_CREATED_AT) {
      return 'created_at must be a finite number';
    }
    if (r.created_at > now + CLOCK_SKEW_MS) {
      return 'created_at must not be in the future';
    }
  }

  const textFields: Array<[string, number]> = [
    ['title', MAX_TITLE_LENGTH],
    ['summary', MAX_SUMMARY_LENGTH],
    ['tags', MAX_TAGS_LENGTH],
    ['domain', MAX_DOMAIN_LENGTH],
  ];
  for (const [field, maxLen] of textFields) {
    const value = r[field];
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return `${field} must be a string`;
    }
    if (strict && typeof value === 'string' && value.length > maxLen) {
      return `${field} must be at most ${maxLen} characters`;
    }
  }
  // String-only envelope columns with no cap on either path (mirrors the
  // background gate; the strict dashboard gate enforces the type too so a
  // strict-accepted row always passes the background gate as well).
  for (const field of ['nav_source_url', 'search_query'] as const) {
    const value = r[field];
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return `${field} must be a string`;
    }
  }
  if (strict) {
    if (!isOptionalFiniteInRange(r.visit_duration, 0, MAX_VISIT_DURATION_MS)) {
      if (typeof r.visit_duration !== 'number' || !Number.isFinite(r.visit_duration)) {
        return 'visit_duration must be a finite number';
      }
      return 'visit_duration must be >= 0';
    }
    if (!isOptionalFiniteInRange(r.scroll_ratio, 0, 1)) {
      if (typeof r.scroll_ratio !== 'number' || !Number.isFinite(r.scroll_ratio)) {
        return 'scroll_ratio must be a finite number';
      }
      return 'scroll_ratio must be between 0 and 1';
    }
    if (!isOptionalFlag(r.is_starred)) return 'is_starred must be 0 or 1';
    if (!isOptionalFlag(r.is_deleted)) return 'is_deleted must be 0 or 1';
  } else {
    const visitDuration = r.visit_duration;
    if (visitDuration !== undefined && visitDuration !== null) {
      if (typeof visitDuration !== 'number' || !Number.isFinite(visitDuration)) {
        return 'visit_duration must be a finite number';
      }
      if (visitDuration < 0) {
        return 'visit_duration must be >= 0';
      }
    }
    const scrollRatio = r.scroll_ratio;
    if (scrollRatio !== undefined && scrollRatio !== null) {
      if (typeof scrollRatio !== 'number' || !Number.isFinite(scrollRatio)) {
        return 'scroll_ratio must be a finite number';
      }
      if (scrollRatio < 0 || scrollRatio > 1) {
        return 'scroll_ratio must be between 0 and 1';
      }
    }
    for (const field of ['is_starred', 'is_deleted'] as const) {
      const value = r[field];
      if (value !== undefined && value !== null && value !== 0 && value !== 1) {
        return `${field} must be 0 or 1`;
      }
    }
  }

  return null;
}

/**
 * Per-row rejection reason, or `null` when the row may proceed.
 *
 * Thin strict wrapper over the canonical `validateImportRowWithOptions`:
 * the dashboard file-import gate always calls with `strict: true`, so the
 * two can never contradict each other. Messages mirror `validateImportRow`
 * in messaging/validators.ts where the checks overlap (a normalized row
 * that passes here also passes there — this gate is the stricter one:
 * length caps and the future bound exist only here); the length/future
 * extras keep the same "`field` must ..." vocabulary.
 *
 * @internal exported for testing
 */
export function validateImportRowReason(row: ExportedRow): string | null {
  return validateImportRowWithOptions(row, { strict: true });
}

/** One rejected row for the report: source index plus the reason. */
export interface ImportRowIssue {
  index: number;
  reason: string;
}

export interface ImportLogsSuccess {
  inserted: number;
  skipped: number;
  total: number;
  /**
   * Tolerant-import report (PBI 2026-11-23-05). Present only when at least
   * one row was rejected: `total` counts the valid rows, `invalid` the
   * rejected ones, with a reason breakdown and the first samples.
   */
  invalid?: number | undefined;
  invalidReasons?: Record<string, number> | undefined;
  invalidSamples?: ImportRowIssue[] | undefined;
}

export type ImportLogsResult = ImportLogsSuccess | { error: string };

/**
 * Narrowing helper for the import result shape.
 *
 * Kept separate from `isServiceError` on purpose: the success side here
 * carries bare `{ inserted, skipped, total }` with no `data` wrapper, so it
 * is not a `ServiceResult<T>` and must never be passed to that guard.
 */
export function isImportError(result: ImportLogsResult): result is { error: string } {
  return 'error' in result;
}

export async function importFromJson(
  jsonText: string,
  onProgress?: (current: number, total: number) => void,
  opts?: ImportLogsOptions
): Promise<ImportLogsResult> {
  // Size cap before parse (VULN-023): reject an oversized file up front.
  if (typeof jsonText === 'string' && jsonText.length > MAX_IMPORT_TEXT_BYTES) {
    return { error: 'Import file is too large' };
  }

  let parsed: ExportedData;
  try {
    parsed = JSON.parse(jsonText) as ExportedData;
  } catch {
    return { error: 'Invalid JSON format' };
  }

  // Signature gate (VULN-035): reject unsigned or tampered files before any
  // row reaches SQLite. Mirrors settingsExportImport.importSettings — v1
  // (unsigned) files are not accepted.
  const verifier: ImportLogsVerifier = opts?.verifier ?? exportHmacSigner;
  const signatureError = await verifyExportSignature(parsed, verifier);
  if (signatureError) {
    return { error: signatureError };
  }

  return importValidatedRows(parsed, onProgress);
}

/**
 * Profile migration import (PBI 2026-11-06-03): ingest a log file that was
 * signed by a DIFFERENT profile's HMAC key (Edge/Chrome/Firefox or another
 * profile of the same browser).
 *
 * This is the only path that skips HMAC verification, and it must only run
 * after an explicit user confirmation (`showConfirmDialog` in the UI layer).
 * Row validation, the row cap, and batching match the normal path; the
 * application is audit-logged.
 *
 * The normal `importFromJson` above is untouched: foreign-signed or unsigned
 * files keep being rejected there (VULN-035).
 */
export async function importFromJsonForMigration(
  jsonText: string,
  onProgress?: (current: number, total: number) => void
): Promise<ImportLogsResult> {
  // Size cap before parse (VULN-023), same as the normal path.
  if (typeof jsonText === 'string' && jsonText.length > MAX_IMPORT_TEXT_BYTES) {
    return { error: 'Import file is too large' };
  }

  let parsed: ExportedData;
  try {
    parsed = JSON.parse(jsonText) as ExportedData;
  } catch {
    return { error: 'Invalid JSON format' };
  }

  const hadSignature = typeof parsed.signature === 'string' && parsed.signature.length > 0;
  const result = await importValidatedRows(parsed, onProgress);
  if (!isImportError(result)) {
    await logWarn(
      'Log migration import applied (signature check skipped by explicit user confirmation)',
      {
        inserted: result.inserted,
        skipped: result.skipped,
        total: result.total,
        invalid: result.invalid ?? 0,
        hadSignature,
      },
      undefined,
      'importLogsService.ts'
    );
  }
  return result;
}

/**
 * Row validation + batched SQLite import shared by the normal and migration
 * paths. The signature decision already happened above; everything from here
 * on is identical for both.
 *
 * Tolerant behavior (PBI 2026-11-23-05): any accepted top-level shape is
 * collected, legacy aliases are remapped, and unfixable rows are skipped
 * with a per-row reason instead of aborting the whole file. Re-imports stay
 * idempotent: the backend ignores duplicates via UNIQUE(url, created_at) +
 * INSERT OR IGNORE, so already-present rows surface as `skipped`.
 */
async function importValidatedRows(
  parsed: unknown,
  onProgress?: (current: number, total: number) => void
): Promise<ImportLogsResult> {
  const extracted = extractImportRows(parsed);
  if ('error' in extracted) {
    return { error: extracted.error };
  }
  const rawRows = extracted.rows;
  if (rawRows.length === 0) {
    return { error: 'No records found in file' };
  }

  if (rawRows.length > IMPORT_TOTAL_ROW_CAP) {
    return { error: `Import exceeds the ${IMPORT_TOTAL_ROW_CAP} row limit` };
  }

  // Normalize aliases, then validate: unfixable rows are counted by reason.
  const validRows: ExportedRow[] = [];
  const invalidReasons: Record<string, number> = {};
  const invalidSamples: ImportRowIssue[] = [];
  rawRows.forEach((raw, index) => {
    const normalized = normalizeImportRow(raw);
    const reason = normalized === null ? 'must be an object' : validateImportRowReason(normalized);
    if (reason !== null) {
      invalidReasons[reason] = (invalidReasons[reason] ?? 0) + 1;
      if (invalidSamples.length < MAX_INVALID_SAMPLES) invalidSamples.push({ index, reason });
      return;
    }
    validRows.push(normalized as ExportedRow);
  });
  const invalid = rawRows.length - validRows.length;
  const report =
    invalid > 0
      ? { invalid, invalidReasons, invalidSamples }
      : { invalid: undefined, invalidReasons: undefined, invalidSamples: undefined };

  if (validRows.length === 0) {
    const breakdown = Object.entries(invalidReasons)
      .map(([reason, count]) => `${reason} x${count}`)
      .join('; ');
    const first = invalidSamples[0]
      ? ` First invalid row at index ${invalidSamples[0].index}: ${invalidSamples[0].reason}.`
      : '';
    return {
      error: `No valid records found (url and created_at required). Invalid rows: ${invalid} (${breakdown}).${first}`,
    };
  }

  const BATCH_SIZE = 200;
  let inserted = 0;
  let skipped = 0;
  // Distinct reasons across batches, not just the last one: a large import
  // spans many batches and different batches can fail for different reasons.
  const batchErrors = new Set<string>();

  for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
    const batch = validRows.slice(i, i + BATCH_SIZE);
    // PBI 2026-09-23-02: generic seam call — decode/defaultError live in the import row.
    const result = await sqliteClient.call('import', { subtype: 'import', rows: batch });
    if ('data' in result) {
      inserted += result.data.inserted;
      skipped += result.data.skipped;
    } else {
      skipped += batch.length;
      batchErrors.add(result.error);
    }
    onProgress?.(Math.min(i + BATCH_SIZE, validRows.length), validRows.length);
  }

  if (batchErrors.size > 0 && inserted === 0) {
    // Every batch failed the same way: surfacing that reason beats reporting
    // "0 inserted" and leaving the user to guess why.
    return { error: Array.from(batchErrors).join('; ') };
  }

  return { inserted, skipped, total: validRows.length, ...report };
}
