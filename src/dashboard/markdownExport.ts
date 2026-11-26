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
import { isServiceError, queryLogs, type BrowsingLogEntry } from './dashboardSqliteService.js';
import { renderFileTemplate, getActiveTemplate } from '../utils/markdownTemplateUtils.js';
import type { MarkdownExportTemplate, MarkdownTemplateEntryData } from '../utils/types.js';
import { buildTemplateEntryData } from '../utils/markdownFormatter.js';
import { getPlatformOs } from '../utils/deviceUtils.js';
import { resolveSafeExportDir } from '../utils/pathSanitizer.js';
import { formatLocalDateString, parseLocalDateStart } from '../utils/localDate.js';
import { MAX_EXPORT_ROWS, QUERY_CAPS } from '../utils/limits.js';

/** Batch size for paginated full-history export (desktop). */
export const EXPORT_BATCH_SIZE_DESKTOP = 1000;
/** Smaller batch size on mobile to reduce peak memory usage. */
export const EXPORT_BATCH_SIZE_MOBILE = 500;

/** Default folder used when no export path is configured. */
export const DEFAULT_EXPORT_PATH = 'Yasumaro';

/**
 * Page size for the date-range export's keyset paging — the per-query cap,
 * NOT the export ceiling. Same value as QUERY_CAPS.plain because one plain
 * listing query cannot return more; the whole-export ceiling is
 * MAX_EXPORT_ROWS (limits.ts SSOT, shared with exportLogsService).
 */
export const DATE_RANGE_QUERY_LIMIT = QUERY_CAPS.plain;

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

/**
 * Local date string (YYYY-MM-DD) for a timestamp, in the user's timezone.
 * Thin alias kept for existing callers/tests; the implementation and the
 * zero-padding convention live in the localDate SSOT (PBI 2026-09-28-11).
 */
export function getLocalDateString(timestamp: number): string {
  return formatLocalDateString(timestamp);
}

/**
 * Parse a tags column holding a JSON array string into a string array.
 * Shared with exportLogsService so both Markdown exporters interpret stored
 * tags identically. buildTemplateEntryData is deliberately NOT reused here:
 * it splits string input on commas, which would shred a JSON array string
 * into fragments and change the emitted YAML.
 */
export function parseJsonTagsArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Convert a single browsing log entry into template entry data.
 * VULN-020: sanitize title and URL to prevent Markdown injection.
 * Delegates to the entry-markdown SSOT (PBI-04); the tag chain here is
 * obsidian-only (legacy), unlike the pipeline's linkText-wrapped tags.
 */
export function toMarkdownTemplateEntryData(entry: {
  title?: string | null;
  url: string;
  summary?: string | null;
  tags?: string | null;
  created_at: number;
}): MarkdownTemplateEntryData {
  return buildTemplateEntryData(
    {
      title: entry.title,
      url: entry.url,
      summary: entry.summary,
      tags: entry.tags,
      createdAt: entry.created_at,
    },
    { tagChain: 'obsidian' },
  );
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
    if (isServiceError(result)) {
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
    since: parseLocalDateStart(startDate),
    // WHY not endOfLocalDayMs here: this bound deliberately stops at 23:59:59
    // (the historical markdownExport contract) rather than 23:59:59.999, and
    // widening it would change which rows an existing export includes.
    until: new Date(endDate + 'T23:59:59').getTime(),
  };
}

/**
 * Export every entry within the given local date range.
 *
 * WHY keyset paging: one query caps at DATE_RANGE_QUERY_LIMIT (QUERY_CAPS.plain),
 * so ranges beyond one page continue with `since` = the previous page's newest
 * created_at — inclusive, so boundary ties are re-read — and merge by unique id
 * (queryAllData precedent with the cursor direction reversed for ASC). An
 * offset window over a live table double-counts or skips rows while the
 * recorder keeps inserting. All pages are collected before grouping:
 * flushing per page would split one date's rows across several downloads.
 */
export async function exportDateRange(
  config: ExportConfig,
  startDate: string,
  endDate: string,
  download: DownloadPort,
): Promise<ExportResult> {
  const { since, until } = dateRangeToTimestamps(startDate, endDate);
  const byId = new Map<number, BrowsingLogEntry>();
  // Frozen from the first page: the range-filtered row count this export is
  // pinned to (queryAllData precedent).
  let frozenTotal = Number.POSITIVE_INFINITY;
  let cursor = since;
  while (byId.size < MAX_EXPORT_ROWS && byId.size < frozenTotal) {
    const result = await queryLogs({
      since: cursor,
      until,
      limit: DATE_RANGE_QUERY_LIMIT,
      orderBy: 'created_at',
      orderDir: 'ASC',
    });

    // Distinguish a failure from a genuinely empty range: both used to return
    // zero rows, so a database error was reported to the user as "no records
    // in this period".
    if (isServiceError(result)) {
      throw new Error(result.error);
    }
    if (frozenTotal === Number.POSITIVE_INFINITY) {
      frozenTotal = result.data.total;
    }
    const batch = result.data.rows;
    if (batch.length === 0) break;
    const sizeBefore = byId.size;
    for (const row of batch) {
      byId.set(row.id, row);
    }
    if (byId.size >= MAX_EXPORT_ROWS) break;
    if (batch.length < DATE_RANGE_QUERY_LIMIT) break;
    const newest = batch[batch.length - 1]!.created_at;
    // WHY: an entire page of boundary-tie rows (no new id merged) means more
    // than a page shares one created_at; step forward 1ms so the ASC loop
    // cannot stall. Rows beyond a full page sharing that exact millisecond are
    // not fetched (queryAllData precedent, direction reversed).
    cursor = byId.size === sizeBefore ? newest + 1 : newest;
  }

  // Map insertion order is ASC (pages arrive ascending), so the slice keeps
  // the oldest MAX_EXPORT_ROWS rows; a page can push the merge past the cap,
  // and rows beyond it are not exported.
  const rows = Array.from(byId.values()).slice(0, MAX_EXPORT_ROWS);
  if (rows.length === 0) {
    return { totalRows: 0, totalFiles: 0 };
  }

  const entriesByDate = groupEntriesByLocalDate(rows);
  let totalFiles = 0;
  for (const [date, entries] of entriesByDate) {
    await download(
      exportFilenameFor(config.exportPath, date),
      renderDateFile(date, entries, config.template),
    );
    totalFiles++;
  }

  return { totalRows: rows.length, totalFiles };
}

const DOWNLOAD_REVOKE_SETTLE_TIMEOUT_MS = 10_000;

/**
 * Wait until a browser download reaches a terminal state (`complete` or
 * `interrupted`) before revoking its blob URL. Firefox's `downloads.download`
 * resolves before the download manager opens the blob URL, so revoking
 * immediately in `finally` races with the fetch and aborts larger exports.
 * Falls back cleanly when `chrome.downloads.onChanged` is unavailable (mocks).
 */
async function waitForDownloadTerminalState(downloadId: number): Promise<void> {
  const onChanged = chrome.downloads?.onChanged;
  if (!onChanged?.addListener || !onChanged?.removeListener) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      onChanged.removeListener(listener);
      resolve();
    };
    const listener = (delta: chrome.downloads.DownloadDelta): void => {
      if (delta.id !== downloadId) return;
      const state = delta.state?.current;
      if (state === 'complete' || state === 'interrupted') {
        finish();
      }
    };
    const timer = setTimeout(finish, DOWNLOAD_REVOKE_SETTLE_TIMEOUT_MS);
    onChanged.addListener(listener);

    // Handle downloads that already settled before the listener was attached.
    if (typeof chrome.downloads?.search === 'function') {
      const checkExisting = (items: chrome.downloads.DownloadItem[] | undefined): void => {
        const item = items?.[0];
        if (item && (item.state === 'complete' || item.state === 'interrupted')) {
          finish();
        }
      };
      try {
        const maybePromise = chrome.downloads.search({ id: downloadId }, checkExisting) as unknown;
        if (maybePromise && typeof (maybePromise as Promise<unknown>).then === 'function') {
          (maybePromise as Promise<chrome.downloads.DownloadItem[]>).then(checkExisting, () => undefined);
        }
      } catch {
        // Ignore search errors; listener + bounded timeout still settle.
      }
    }
  });
}

/**
 * The production DownloadPort: hands the rendered file to chrome.downloads via
 * a blob URL.
 */
export const chromeDownloadPort: DownloadPort = async (filename, content) => {
  const blob = new Blob([content], { type: 'text/markdown' });
  const blobUrl = URL.createObjectURL(blob);

  try {
    const downloadId = await chrome.downloads.download({
      url: blobUrl,
      filename,
      saveAs: false,
      // PBI 27 上書きガード方針: filename は exportFilenameFor 経由で sanitize
      // 済み。日次ファイルは日付キーで冪等な再書き込みが正しい動作のため、
      // 明示 'overwrite' で無警告の黙示上書きにはしない（全 4 箇所で統一）。
      conflictAction: 'overwrite',
    });
    if (typeof downloadId === 'number') {
      await waitForDownloadTerminalState(downloadId);
    }
  } finally {
    // WHY settle-driven instead of a fixed timer: we wait on downloads.download
    // plus downloads.onChanged terminal state (Firefox's download manager opens
    // the blob URL asynchronously after download() resolves), then revoke
    // deterministically with no leak on failure paths. exportLogsService keeps
    // a 60s timer only because its anchor-click path has no completion signal
    // to await.
    URL.revokeObjectURL(blobUrl);
  }
};
