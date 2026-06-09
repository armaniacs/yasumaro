/**
 * exportLogsService.ts
 * Export browsing logs from SQLite in .json / Markdown / CSV formats.
 * Uses the DASHBOARD_SQLITE service worker messaging for data access.
 */

import { queryLogs } from './dashboardSqliteService.js';

// ============================================================================
// Markdown Export
// ============================================================================

async function queryAllData() {
  const result = await queryLogs({ limit: 10000, orderBy: 'created_at', orderDir: 'DESC' });
  return result?.rows || [];
}

export async function exportMarkdown(ids?: number[]): Promise<string> {
  const all = await queryAllData();
  const entries = ids ? all.filter(e => ids.includes(e.id)) : all;

  return entries.map(entry => {
    const date = new Date(entry.created_at).toISOString().split('T')[0];
    let tags: string[] = [];
    if (entry.tags) {
      try { tags = JSON.parse(entry.tags); } catch { tags = []; }
    }

    return `---
title: "${(entry.title || entry.url).replace(/"/g, '\\"')}"
url: ${entry.url}
date: ${date}
tags: [${tags.map(t => `"${t}"`).join(', ')}]
---

${entry.summary || ''}
`;
  }).join('\n---\n');
}

// ============================================================================
// CSV Export (UTF-8 BOM for Excel compatibility)
// ============================================================================

function escapeCsv(value: unknown): string {
  if (value == null) return '';
  const str = String(value);
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
  const json = JSON.stringify({ version: 1, table: 'browsing_logs', rows: all }, null, 2);
  return new Blob([json], { type: 'application/json' });
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
