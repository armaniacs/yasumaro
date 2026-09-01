/**
 * exportLogsService.ts
 * Export browsing logs from SQLite in .json / Markdown / CSV formats.
 * Uses the DASHBOARD_SQLITE service worker messaging for data access.
 */

import { queryLogs, backupDb } from './dashboardSqliteService.js';
import { sanitizeForObsidian } from '../utils/markdownSanitizer.js';
import { yamlQuote, yamlQuoteList } from '../utils/yamlFrontmatter.js';
import { getOrCreateHmacSecret } from '../utils/storage/encryptionSession.js';
import { computeHMAC } from '../utils/crypto/index.js';

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
 * Upper bound on rows pulled into a single export. Exceeding it is reported
 * rather than silently truncating the file.
 */
const EXPORT_ROW_LIMIT = 10000;

/**
 * Loads every row for an export.
 *
 * Throws instead of returning `[]` on failure: the three exporters below turn
 * their result straight into a downloaded file, so collapsing an error into an
 * empty list made a broken database indistinguishable from an empty one — the
 * user got an empty file and an "export completed" message. The callers in
 * exportLogsPanel.ts already wrap these in try/catch, which this makes
 * reachable.
 */
async function queryAllData() {
  const result = await queryLogs({ limit: EXPORT_ROW_LIMIT, orderBy: 'created_at', orderDir: 'DESC' });

  if ('error' in result) {
    throw new Error(result.error);
  }
  if (result.data.total > result.data.rows.length) {
    throw new Error(
      `This export is limited to ${EXPORT_ROW_LIMIT} records, but ${result.data.total} are stored. ` +
      'Use the .db export to capture the full history.'
    );
  }

  return result.data.rows;
}

export async function exportMarkdown(ids?: number[]): Promise<string> {
  const all = await queryAllData();
  const entries = ids ? all.filter(e => ids.includes(e.id)) : all;

  return entries.map(entry => {
    const date = new Date(entry.created_at).toLocaleDateString('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    let tags: string[] = [];
    if (entry.tags) {
      try { tags = JSON.parse(entry.tags); } catch { tags = []; }
    }

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
  const hmacSecret = await getOrCreateHmacSecret();
  const signature = await computeHMAC(hmacSecret, JSON.stringify(body, null, 2));
  const json = JSON.stringify({ ...body, signature }, null, 2);
  return new Blob([json], { type: 'application/json' });
}

// ============================================================================
// Binary .db Export
// ============================================================================

export async function exportDb(): Promise<Blob> {
  const result = await backupDb();
  // Preserve the backend error so callers can report the actual failure reason.
  if ('error' in result) {
    throw new Error(result.error);
  }
  // Uint8Array を Blob に変換
  return new Blob([new Uint8Array(result.data)], { type: 'application/x-sqlite3' });
}

// ============================================================================
// Download Helpers
// ============================================================================

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadText(text: string, filename: string, mimeType = 'text/plain'): void {
  downloadBlob(new Blob([text], { type: mimeType }), filename);
}
