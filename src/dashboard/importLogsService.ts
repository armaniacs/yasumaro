/**
 * importLogsService.ts
 * Import browsing logs from JSON export files into SQLite.
 */

import { importLogs } from './dashboardSqliteService.js';

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
}

function validateRow(row: unknown): row is ExportedRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  if (typeof r.url !== 'string' || !r.url) return false;
  if (typeof r.created_at !== 'number') return false;
  return true;
}

export async function importFromJson(
  jsonText: string,
  onProgress?: (current: number, total: number) => void,
): Promise<{ inserted: number; skipped: number; total: number } | { error: string }> {
  let parsed: ExportedData;
  try {
    parsed = JSON.parse(jsonText) as ExportedData;
  } catch {
    return { error: 'Invalid JSON format' };
  }

  const rows = parsed.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: 'No records found in file' };
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
