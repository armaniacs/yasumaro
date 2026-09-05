/**
 * markdownExport.ts
 * Local Markdown export: query history, group by local date, render one file
 * per date.
 *
 * Extracted from dashboard.ts (PBI 2026-08-08-09 Phase 1). In dashboard.ts this
 * logic sat next to the DOM handlers and was only reachable through the
 * module's top-level `void initDashboard()` side effect, so none of it — batch
 * sizing, date bucketing, template mapping — could be tested directly.
 *
 * The download itself goes through a `DownloadPort` seam so callers can verify
 * what would be written without touching chrome.downloads.
 */

import { StorageKeys } from '../utils/storage/types.js';
import { settingsRepository, type SettingsReader } from '../utils/storage/SettingsRepository.js';
import { queryLogs, type BrowsingLogEntry } from './dashboardSqliteService.js';
import { renderFileTemplate, getActiveTemplate, getHostname } from '../utils/markdownTemplateUtils.js';
import type { MarkdownExportTemplate, MarkdownTemplateEntryData } from '../utils/types.js';
import { sanitizeForObsidian, sanitizeForMarkdownLinkText, sanitizeUrlForMarkdownTarget } from '../utils/markdownSanitizer.js';
import { getPlatformOs } from '../utils/deviceUtils.js';
import { resolveSafeExportDir } from '../utils/pathSanitizer.js';

/** Batch size for paginated full-history export (desktop). */
export const EXPORT_BATCH_SIZE_DESKTOP = 1000;
/** Smaller batch size on mobile to reduce peak memory usage. */
export const EXPORT_BATCH_SIZE_MOBILE = 500;

/** Default folder used when no export path is configured. */
export const DEFAULT_EXPORT_PATH = 'Yasumaro';

/** Upper bound on rows fetched for a date-range export. */
export const DATE_RANGE_QUERY_LIMIT = 10000;

export function getExportBatchSize(): number {
  const os = getPlatformOs();
  return os === 'android' || os === 'ios' ? EXPORT_BATCH_SIZE_MOBILE : EXPORT_BATCH_SIZE_DESKTOP;
}

/**
 * Writes one exported file. Injected so tests can capture output instead of
 * driving chrome.downloads.
 */
export interface DownloadPort {
  (filename: string, content: string): Promise<void>;
}

/** Local date string (YYYY-MM-DD) for a timestamp, in the user's timezone. */
export function getLocalDateString(timestamp: number): string {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Convert a single browsing log entry into template entry data.
 * VULN-020: sanitize title and URL to prevent Markdown injection.
 */
export function toMarkdownTemplateEntryData(entry: {
  title?: string | null;
  url: string;
  summary?: string | null;
  tags?: string | null;
  created_at: number;
}): MarkdownTemplateEntryData {
  const timestamp = new Date(entry.created_at).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  });
  // VULN-017: title is placed inside `[title](url)`; escape link-breakout chars
  // so a `](url)` suffix cannot close the wrapper.
  const title = sanitizeForMarkdownLinkText(entry.title || entry.url || 'Untitled');
  const url = sanitizeUrlForMarkdownTarget(entry.url);
  const summary = sanitizeForObsidian(
    (entry.summary || 'Summary not available.').replace(/\n+/g, ' ').replace(/  +/g, ' ').trim(),
  );
  const tagsList = entry.tags
    ? entry.tags.split(',').map(t => t.trim()).filter(Boolean).map(t => `#${sanitizeForObsidian(t)}`)
    : [];
  const tags = tagsList.length > 0 ? tagsList.join(' ') + ' ' : '';
  const domain = getHostname(url);
  return { timestamp, title, url, summary, tags, domain };
}

/** Group entries by their local date. Insertion order is preserved. */
export function groupEntriesByLocalDate(
  rows: BrowsingLogEntry[],
): Map<string, BrowsingLogEntry[]> {
  const entriesByDate = new Map<string, BrowsingLogEntry[]>();
  for (const row of rows) {
    const date = getLocalDateString(row.created_at);
    const bucket = entriesByDate.get(date);
    if (bucket) bucket.push(row);
    else entriesByDate.set(date, [row]);
  }
  return entriesByDate;
}

/** Render one date's entries into the final file contents. */
export function renderDateFile(
  date: string,
  entries: BrowsingLogEntry[],
  template: MarkdownExportTemplate,
): string {
  return renderFileTemplate(template, entries.map(toMarkdownTemplateEntryData), date);
}

/**
 * Path of the file written for a given date.
 * PBI 27: exportPath はユーザー設定の自由文字列のため、ここを単一 choke
 * point として sanitize する。日付部分は内部生成の YYYY-MM-DD 固定で
 * 検証不要。失敗時は DEFAULT_EXPORT_PATH にフォールバックし、ダウンロード
 * 自体は継続する。
 */
export function exportFilenameFor(exportPath: string, date: string): string {
  return `${resolveSafeExportDir(exportPath, DEFAULT_EXPORT_PATH)}/${date}.md`;
}

/** Resolved export configuration read from settings. */
export interface ExportConfig {
  exportPath: string;
  template: MarkdownExportTemplate;
}

export async function loadExportConfig(repo: SettingsReader = settingsRepository): Promise<ExportConfig> {
  const settings = await repo.getMany([
    StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH,
    StorageKeys.MARKDOWN_EXPORT_TEMPLATES,
    StorageKeys.ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID,
  ]);
  const exportPath = settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH] ?? DEFAULT_EXPORT_PATH;
  const templates = settings[StorageKeys.MARKDOWN_EXPORT_TEMPLATES] ?? [];
  const activeTemplateId = settings[StorageKeys.ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID];
  return { exportPath, template: getActiveTemplate(templates, activeTemplateId) };
}

/** Outcome of an export run. */
export interface ExportResult {
  totalRows: number;
  totalFiles: number;
}

/**
 * Stream the full history in batches (ordered by created_at ASC), grouping
 * consecutive rows by local date and writing one file per date as soon as the
 * date changes. Keeps at most one batch plus one date's rows in memory rather
 * than materializing the entire history.
 */
export async function exportFullHistoryInBatches(
  config: ExportConfig,
  download: DownloadPort,
): Promise<ExportResult> {
  const batchSize = getExportBatchSize();
  let offset = 0;
  let totalRows = 0;
  let totalFiles = 0;
  let pendingDate: string | null = null;
  let pendingEntries: BrowsingLogEntry[] = [];

  const flush = async (date: string, entries: BrowsingLogEntry[]): Promise<void> => {
    await download(
      exportFilenameFor(config.exportPath, date),
      renderDateFile(date, entries, config.template),
    );
    totalFiles++;
  };

  for (;;) {
    const result = await queryLogs({ limit: batchSize, offset, orderBy: 'created_at', orderDir: 'ASC' });
    // A failed batch must not look like "reached the end", or a mid-export
    // database error would silently produce a partial export reported as
    // complete.
    if ('error' in result) {
      throw new Error(result.error);
    }
    if (result.data.rows.length === 0) break;

    for (const row of result.data.rows) {
      const date = getLocalDateString(row.created_at);
      if (pendingDate !== null && date !== pendingDate) {
        await flush(pendingDate, pendingEntries);
        pendingEntries = [];
      }
      pendingDate = date;
      pendingEntries.push(row);
    }

    totalRows += result.data.rows.length;
    if (result.data.rows.length < batchSize) break;
    offset += batchSize;
  }

  if (pendingDate !== null && pendingEntries.length > 0) {
    await flush(pendingDate, pendingEntries);
  }

  return { totalRows, totalFiles };
}

/**
 * Convert a YYYY-MM-DD range into the timestamp bounds used by the query,
 * covering the whole of both end days in local time.
 */
export function dateRangeToTimestamps(startDate: string, endDate: string): { since: number; until: number } {
  return {
    since: new Date(startDate + 'T00:00:00').getTime(),
    until: new Date(endDate + 'T23:59:59').getTime(),
  };
}

/** Export every entry within the given local date range. */
export async function exportDateRange(
  config: ExportConfig,
  startDate: string,
  endDate: string,
  download: DownloadPort,
): Promise<ExportResult> {
  const { since, until } = dateRangeToTimestamps(startDate, endDate);
  const result = await queryLogs({
    since,
    until,
    limit: DATE_RANGE_QUERY_LIMIT,
    orderBy: 'created_at',
    orderDir: 'ASC',
  });

  // Distinguish a failure from a genuinely empty range: both used to return
  // zero rows, so a database error was reported to the user as "no records in
  // this period".
  if ('error' in result) {
    throw new Error(result.error);
  }
  if (result.data.rows.length === 0) {
    return { totalRows: 0, totalFiles: 0 };
  }

  const entriesByDate = groupEntriesByLocalDate(result.data.rows);
  let totalFiles = 0;
  for (const [date, entries] of entriesByDate) {
    await download(
      exportFilenameFor(config.exportPath, date),
      renderDateFile(date, entries, config.template),
    );
    totalFiles++;
  }

  return { totalRows: result.data.rows.length, totalFiles };
}

/**
 * The production DownloadPort: hands the rendered file to chrome.downloads via
 * a blob URL.
 */
export const chromeDownloadPort: DownloadPort = async (filename, content) => {
  const blob = new Blob([content], { type: 'text/markdown' });
  const blobUrl = URL.createObjectURL(blob);

  await chrome.downloads.download({
    url: blobUrl,
    filename,
    saveAs: false,
    // PBI 27 上書きガード方針: filename は exportFilenameFor 経由で sanitize
    // 済み。日次ファイルは日付キーで冪等な再書き込みが正しい動作のため、
    // 明示 'overwrite' で無警告の黙示上書きにはしない（全 4 箇所で統一）。
    conflictAction: 'overwrite',
  });

  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
};
