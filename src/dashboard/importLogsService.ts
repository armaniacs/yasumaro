/**
 * importLogsService.ts
 * Import browsing logs from JSON export files into SQLite.
 */

import { importLogs } from './dashboardSqliteService.js';
import { getOrCreateHmacSecret } from '../utils/storage/encryptionSession.js';
import { computeHMAC, constantTimeCompare } from '../utils/crypto/index.js';

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

/** Upper bound on rows accepted from a single import file (VULN-023). */
export const MAX_IMPORT_ROWS = 100_000;
/** Upper bound on the raw import text, mirroring the settings 10 MiB cap. */
export const MAX_IMPORT_TEXT_BYTES = 10 * 1024 * 1024;

const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 2048;
const MAX_SUMMARY_LENGTH = 100_000;
const MAX_TAGS_LENGTH = 8192;
const MAX_DOMAIN_LENGTH = 256;
// created_at is epoch milliseconds. Only a positive, finite value bounded above
// by now + 1 day of skew is required: older exports may have used a smaller
// epoch unit, and rejecting them would drop genuine history.
const MIN_CREATED_AT = 1;
const CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;
const MAX_VISIT_DURATION_MS = 24 * 60 * 60 * 1000;

function isOptionalString(value: unknown, maxLen: number): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= maxLen);
}

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
 * Verify the HMAC signature over the signature-stripped body. Returns an error
 * string to abort the import, or `null` when the file is authentic.
 */
async function verifyExportSignature(parsed: ExportedData): Promise<string | null> {
  if (typeof parsed.signature !== 'string' || parsed.signature.length === 0) {
    return 'This log file is unsigned and cannot be imported. Re-export it from this extension.';
  }
  const { signature, ...body } = parsed;
  const hmacSecret = await getOrCreateHmacSecret();
  const expected = await computeHMAC(hmacSecret, JSON.stringify(body, null, 2));
  if (!(await constantTimeCompare(signature, expected))) {
    return 'Log file signature verification failed. The file may be corrupted or was exported from a different browser profile.';
  }
  return null;
}

function validateRow(row: unknown): row is ExportedRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;

  if (typeof r.url !== 'string' || !r.url || r.url.length > MAX_URL_LENGTH) return false;

  if (
    typeof r.created_at !== 'number' ||
    !Number.isFinite(r.created_at) ||
    r.created_at < MIN_CREATED_AT ||
    r.created_at > Date.now() + CLOCK_SKEW_MS
  ) {
    return false;
  }

  if (!isOptionalString(r.title, MAX_TITLE_LENGTH)) return false;
  if (!isOptionalString(r.summary, MAX_SUMMARY_LENGTH)) return false;
  if (!isOptionalString(r.tags, MAX_TAGS_LENGTH)) return false;
  if (!isOptionalString(r.domain, MAX_DOMAIN_LENGTH)) return false;
  if (!isOptionalFiniteInRange(r.visit_duration, 0, MAX_VISIT_DURATION_MS)) return false;
  if (!isOptionalFiniteInRange(r.scroll_ratio, 0, 1)) return false;
  if (!isOptionalFlag(r.is_starred)) return false;
  if (!isOptionalFlag(r.is_deleted)) return false;

  return true;
}

export async function importFromJson(
  jsonText: string,
  onProgress?: (current: number, total: number) => void,
): Promise<{ inserted: number; skipped: number; total: number } | { error: string }> {
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
  const signatureError = await verifyExportSignature(parsed);
  if (signatureError) {
    return { error: signatureError };
  }

  const rows = parsed.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: 'No records found in file' };
  }

  if (rows.length > MAX_IMPORT_ROWS) {
    return { error: `Import exceeds the ${MAX_IMPORT_ROWS} row limit` };
  }

  // Validate and filter
  const validRows = rows.filter(validateRow);
  if (validRows.length === 0) {
    return { error: 'No valid records found (url and created_at required)' };
  }

  const BATCH_SIZE = 200;
  let inserted = 0;
  let skipped = 0;
  // Distinct reasons across batches, not just the last one: a large import
  // spans many batches and different batches can fail for different reasons.
  const batchErrors = new Set<string>();

  for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
    const batch = validRows.slice(i, i + BATCH_SIZE);
    const result = await importLogs(batch);
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

  return { inserted, skipped, total: validRows.length };
}
