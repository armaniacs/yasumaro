/**
 * localMarkdownExport.ts
 * ローカル Markdown 書き出しの DOM シェル
 *
 * Shared rather than panel-local: the three handlers below are driven from
 * two different places — the general settings panel (manual export) and the
 * Export Logs / History panels — so keeping them in dashboard.ts is what
 * forced the panel layer to import from it (PBI 2026-08-09-24).
 */

import { getMessage } from '../utils/i18n.js';
import {
  loadExportConfig,
  exportFullHistoryInBatches,
  exportDateRange,
  chromeDownloadPort,
  type ExportResult,
} from './markdownExport.js';

/**
 * Options for exportLocalMarkdownCore, parameterizing the three near-identical
 * local Markdown export handlers (M15).
 */
interface LocalMarkdownExportOptions {
  /** Element IDs for the date-range inputs, or null for a full-history export (no range). */
  dateRange: { startDateId: string; endDateId: string } | null;
  exportBtnId: string;
  statusElId: string;
  /** Status message shown when the query returns zero rows. */
  emptyMessage: string;
}

/**
 * DOM shell around the export logic in markdownExport.ts: reads the form,
 * drives the button/status elements, and delegates the actual querying,
 * grouping and rendering.
 */
async function exportLocalMarkdownCore(options: LocalMarkdownExportOptions): Promise<void> {
  const exportBtn = document.getElementById(options.exportBtnId) as HTMLButtonElement | null;
  const statusEl = document.getElementById(options.statusElId) as HTMLElement | null;

  if (!exportBtn || !statusEl) return;

  exportBtn.disabled = true;
  statusEl.textContent = '';
  statusEl.className = '';

  try {
    const config = await loadExportConfig();

    statusEl.textContent = getMessage('searching') || 'Searching...';

    let result: ExportResult;
    if (!options.dateRange) {
      // Full-history export: stream in batches to bound peak memory usage.
      result = await exportFullHistoryInBatches(config, chromeDownloadPort);
    } else {
      const startDateInput = document.getElementById(options.dateRange.startDateId) as HTMLInputElement | null;
      const endDateInput = document.getElementById(options.dateRange.endDateId) as HTMLInputElement | null;

      const startDate = startDateInput?.value || new Date().toISOString().split('T')[0]!;
      const endDate = endDateInput?.value || startDate;

      result = await exportDateRange(config, startDate, endDate, chromeDownloadPort);
    }

    if (result.totalRows === 0) {
      statusEl.textContent = options.emptyMessage;
      statusEl.className = 'error';
      return;
    }

    statusEl.textContent = `${result.totalRows}件の記録を${result.totalFiles}ファイルにエクスポートしました。`;
    statusEl.className = 'success';
  } catch (e) {
    statusEl.textContent = `エクスポートに失敗しました: ${e instanceof Error ? e.message : String(e)}`;
    statusEl.className = 'error';
  } finally {
    exportBtn.disabled = false;
  }
}

/**
 * Handle manual local markdown export with date range
 */
export async function handleManualLocalMarkdownExport(): Promise<void> {
  return exportLocalMarkdownCore({
    dateRange: { startDateId: 'localExportStartDate', endDateId: 'localExportEndDate' },
    exportBtnId: 'localExportManualBtn',
    statusElId: 'localExportManualStatus',
    emptyMessage: '指定期間に記録がありません。',
  });
}

/**
 * Handle local markdown export from Export Logs panel (date range)
 */
export async function handleExportLocalMarkdown(): Promise<void> {
  return exportLocalMarkdownCore({
    dateRange: { startDateId: 'exportLocalStartDate', endDateId: 'exportLocalEndDate' },
    exportBtnId: 'exportLocalMarkdownBtn',
    statusElId: 'exportLocalMarkdownStatus',
    emptyMessage: '指定期間に記録がありません。',
  });
}

/**
 * Handle local markdown export from History panel (all records)
 */
export async function handleHistoryExportLocalMarkdown(): Promise<void> {
  return exportLocalMarkdownCore({
    dateRange: null,
    exportBtnId: 'historyExportLocalMarkdownBtn',
    statusElId: 'historyExportLocalMarkdownStatus',
    emptyMessage: 'エクスポートする記録がありません。',
  });
}
