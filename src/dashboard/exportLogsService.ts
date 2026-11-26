/**
 * exportLogsService.ts
 * Export browsing logs from SQLite in .json / Markdown / CSV formats.
 * Uses the DASHBOARD_SQLITE service worker messaging for data access.
 */

import { isServiceError, sqliteClient, backupDb, type BrowsingLogEntry } from './dashboardSqliteService.js';
import { getLocalDateString, parseJsonTagsArray } from './markdownExport.js';
import { sanitizeForObsidian } from '../utils/markdownSanitizer.js';
import { yamlQuote, yamlQuoteList } from '../utils/yamlFrontmatter.js';
import { exportHmacSigner } from '../utils/storage/encryptionSession.js';
import { MAX_EXPORT_ROWS, QUERY_CAPS } from '../utils/limits.js';

/**
 * Thrown when the stored history exceeds the export ceiling. The panel
 * swaps the message for the localized template (exportLogsRowLimitExceeded)
 * via instanceof — matching on the English sentence would drift when the
 * wording changes.
 */
export class ExportRowLimitError extends Error {
  readonly storedTotal: number;

  constructor(storedTotal: number) {
    super(
      `This export is limited to ${MAX_EXPORT_ROWS} records, but ${storedTotal} are stored. ` +
      'Use the .db export to capture the full history.',
    );
    this.name = 'ExportRowLimitError';
    this.storedTotal = storedTotal;
  }
}

/**
 * Log JSON export format version. v2 adds an HMAC `signature` over the
 * signature-stripped body (VULN-035), mirroring settingsExportImport's
 * unencrypted export. v1 files (no signature) are rejected on import.
 */
export const LOG_EXPORT_VERSION = 2;

// ============================================================================
// Markdown Export
// ============================================================================

/**
 * Loads every row for an export with a keyset cursor.
 *
 * Throws instead of returning `[]` on failure: the three exporters below turn
 * their result straight into a downloaded file, so collapsing an error into an
 * empty list made a broken database indistinguishable from an empty one — the
 * user got an empty file and an "export completed" message. The callers in
 * exportLogsPanel.ts already wrap these in try/catch, which this makes
 * reachable.
 *
 * WHY keyset paging: one plain query caps at QUERY_CAPS.plain (the history
 * listing cap), so exports beyond one page continue with `until` = the
 * previous page's oldest created_at — inclusive, so boundary ties are
 * re-read — and merge by unique id. An offset window over a live table
 * double-counts or skips rows while the recorder keeps inserting
 * (fetchAllPeriodRows precedent). Map preserves first-insertion order, so
 * re-read boundary rows stay in place and the pages compose newest-first.
 *
 * @internal exported for testing — the three exporters call this with no
 * arguments and their call signature is unchanged.
 */
export async function queryAllData(): Promise<BrowsingLogEntry[]> {
  const byId = new Map<number, BrowsingLogEntry>();
  // Frozen from the first page (POSITIVE_INFINITY until then). Rows recorded
  // while this export pages carry newer timestamps and are excluded by the
  // cursor anyway, so the first page's total is the set this export is
  // pinned to; live growth beyond it is a .db-export concern, not chased here.
  let frozenTotal = Number.POSITIVE_INFINITY;
  let cursor: number | undefined;
  while (byId.size < MAX_EXPORT_ROWS && byId.size < frozenTotal) {
    // PBI 2026-09-23-02: generic seam call — retry lives in the records row.
    const result = await sqliteClient.call('records', {
      subtype: 'query',
      limit: QUERY_CAPS.plain,
      orderBy: 'created_at',
      orderDir: 'DESC',
      ...(cursor === undefined ? {} : { until: cursor }),
    });

    if (isServiceError(result)) {
      throw new Error(result.error);
    }
    if (frozenTotal === Number.POSITIVE_INFINITY) {
      frozenTotal = result.data.total;
      if (frozenTotal > MAX_EXPORT_ROWS) {
        throw new ExportRowLimitError(frozenTotal);
      }
    }
    const batch = result.data.rows;
    if (batch.length === 0) break;
    const sizeBefore = byId.size;
    for (const row of batch) {
      byId.set(row.id, row);
    }
    if (batch.length < QUERY_CAPS.plain) break;
    const oldest = batch[batch.length - 1]!.created_at;
    // WHY: an entire page of boundary-tie rows (no new id merged) means more
    // than a page shares one created_at; step back 1ms so the loop cannot
    // stall. Rows beyond a full page sharing that exact millisecond are not
    // fetched (pathological: >10k records with identical created_at).
    cursor = byId.size === sizeBefore ? oldest - 1 : oldest;
  }
  return Array.from(byId.values());
}

export async function exportMarkdown(ids?: number[]): Promise<string> {
  const all = await queryAllData();
  const entries = ids ? all.filter(e => ids.includes(e.id)) : all;

  return entries.map(entry => {
    const date = getLocalDateString(new Date(entry.created_at).getTime());
    const tags: string[] = parseJsonTagsArray(entry.tags);

    return `---
title: ${yamlQuote(entry.title || entry.url)}
url: ${yamlQuote(entry.url)}
date: ${yamlQuote(date)}
tags: ${yamlQuoteList(tags)}
---

${sanitizeForObsidian(entry.summary || '')}
`;
  }).join('\n---\n');
}

// ============================================================================
// CSV Export (UTF-8 BOM for Excel compatibility)
// ============================================================================

/** @internal exported for testing */
export function escapeCsv(value: unknown): string {
  if (value == null) return '';
  let str = String(value);
  // VULN-005 (CWE-1236): neutralize leading formula-trigger characters so a
  // spreadsheet treats the cell as text instead of evaluating it as a formula.
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function exportCsv(): Promise<Blob> {
  const all = await queryAllData();

  const header = 'url,title,summary,tags,created_at,domain,is_starred';
  const rows = all.map(e =>
    [e.url, e.title, e.summary, e.tags, e.created_at, e.domain, e.is_starred]
      .map(escapeCsv).join(',')
  );

  const bom = '\uFEFF';
  const csv = bom + header + '\n' + rows.join('\n');
  return new Blob([csv], { type: 'text/csv;charset=utf-8' });
}

// ============================================================================
// JSON Export (for .db replacement)
// ============================================================================

export async function exportJson(): Promise<Blob> {
  const all = await queryAllData();
  const body = { version: LOG_EXPORT_VERSION, table: 'browsing_logs', rows: all };
  // Sign the signature-stripped body; import recomputes over the same bytes.
  const signature = await exportHmacSigner.sign(JSON.stringify(body, null, 2));
  const json = JSON.stringify({ ...body, signature }, null, 2);
  return new Blob([json], { type: 'application/json' });
}

// ============================================================================
// Binary .db Export
// ============================================================================

export async function exportDb(): Promise<Blob> {
  const result = await backupDb();
  // Preserve the backend error so callers can report the actual failure reason.
  if (isServiceError(result)) {
    throw new Error(result.error);
  }
  // Uint8Array を Blob に変換
  return new Blob([new Uint8Array(result.data)], { type: 'application/x-sqlite3' });
}

// ============================================================================
// Download Helpers
// ============================================================================

/**
 * Revoke on a bounded delay, not on settle: the anchor-click path
 * (a.click() + download attribute) is fire-and-forget — no promise or event
 * exposes the download's completion to the page, so there is no settle point
 * to revoke on, unlike the chrome.downloads.download paths
 * (generalSettings/connectionTests.ts, markdownExport.ts) whose promise
 * resolves once the blob fetch has started. 60s is a deliberate upper bound:
 * generous enough that a slow environment persists a large download before
 * the revoke fires, while still releasing the object URL instead of leaking
 * it for the page's lifetime.
 */
export const DOWNLOAD_REVOKE_DELAY_MS = 60_000;

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_REVOKE_DELAY_MS);
}

export function downloadText(text: string, filename: string, mimeType = 'text/plain'): void {
  downloadBlob(new Blob([text], { type: mimeType }), filename);
}
