/**
 * researchReportGenerator.ts
 *
 * 調査レポート一発生成 (PBI 2026-10-23-09). Selection-scoped research report:
 * the panel conditions (tag / date range / search term) pick the records, and
 * the report assembles them into a four-section Markdown document (要旨・時系列・
 * 引用・未読穴). Delivery rides the existing paths: the review summary's local
 * markdown download and Obsidian's appendToDailyNote. No new egress is added
 * (PBI 2026-10-23-01 の作法).
 *
 * 作法 (the review summary generator's rules, extended):
 * - sqliteClient / obsidian / downloadMarkdown are injected; this module owns
 *   no storage and no transport.
 * - A generator-local Mutex keeps one report at a time.
 * - 縮退の出口: a fetch failure or an empty selection returns a failure with a
 *   reason — the report is never generated as a fake success.
 * - 要旨 quotes only the persisted post-cleansing summary text (never raw page
 *   bodies). Unread holes are the records in the selection without one.
 */

import { StorageKeys } from '../utils/storage/types.js';
import type { SettingsRepository } from '../utils/storage/SettingsRepository.js';
import { settingsRepository } from '../utils/storage/SettingsRepository.js';
import type { SqliteClient } from './sqlite/offscreenGateway.js';
import type { ObsidianClient } from './obsidianClient.js';
import { Mutex } from '../utils/Mutex.js';
import { formatLocalDateString } from '../utils/localDate.js';
import { sanitizeForObsidian, sanitizeUrlForMarkdownTarget } from '../utils/markdownSanitizer.js';
import { errorMessage } from '../utils/errorUtils.js';
import { MAX_BATCH_READ_RECORDS } from '../utils/limits.js';
import { addLog } from '../utils/logger/core.js';
import { LogType } from '../utils/logger/types.js';
import type { BrowsingLogRecord } from '../utils/sqlite-types.js';

/** Local export path default mirrors the review summary's setting. */
const DEFAULT_EXPORT_PATH = 'Yasumaro';

/** Records per report; a scope wider than this is capped, not rejected. */
export const REPORT_MAX_RECORDS = MAX_BATCH_READ_RECORDS;

/** One report row: id + the post-cleansing text the report quotes. */
export interface ResearchReportRecord {
  id: number;
  title: string;
  url: string;
  createdAt: number;
  /** Persisted post-cleansing summary; empty when the record has no one (未読穴). */
  summary: string;
}

/** Outcome of one report run. Failures carry a user-facing reason. */
export type ResearchReportOutcome =
  | { success: true; recordCount: number; deliveredTo: ('download' | 'obsidian')[] }
  | { success: false; error: string };

/** Scope of one report: the panel conditions (PBI 06 collection shape). */
export interface ResearchReportScope {
  search?: string;
  tag?: string;
  since?: number;
  until?: number;
}

/** Report generator, created once and shared by the message handler. */
export interface ResearchReportGenerator {
  generate(input: { scope: ResearchReportScope; sendToObsidian?: boolean }): Promise<ResearchReportOutcome>;
}

export interface ResearchReportGeneratorDeps {
  /** Selection rows come from the records query (the panel's own conditions). */
  sqliteClient: Pick<SqliteClient, 'query'>;
  repo?: Pick<SettingsRepository, 'get'>;
  /** Obsidian delivery rides the existing daily-note append path. */
  obsidian: Pick<ObsidianClient, 'appendToDailyNote'>;
  /** Local markdown download; injected so tests never touch chrome.downloads. */
  downloadMarkdown: (content: string, filename: string, exportPath: string) => Promise<boolean>;
}

/** The panel rows are id-bearing records; a summary-less row stays a hole. */
function toReportRecord(row: BrowsingLogRecord & { id: number }): ResearchReportRecord {
  return {
    id: row.id,
    title: row.title ?? '',
    url: row.url ?? '',
    createdAt: row.created_at ?? 0,
    summary: row.summary ?? '',
  };
}

/** 要旨 section: the selection's persisted summaries, newest first. */
function buildDigestSection(records: ResearchReportRecord[]): string {
  const withSummary = records.filter((r) => r.summary.trim().length > 0);
  if (withSummary.length === 0) {
    return 'この選択範囲には要約済みの記録がありません。';
  }
  return withSummary
    .map((r) => `- ${r.title || r.url}: ${r.summary.trim()}`)
    .join('\n');
}

/** 時系列 section: oldest first, the report's reading order. */
function buildTimelineSection(records: ResearchReportRecord[]): string {
  const ordered = [...records].sort((a, b) => a.createdAt - b.createdAt);
  return ordered
    .map((r) => `- ${formatLocalDateString(r.createdAt)} — ${r.title || r.url}`)
    .join('\n');
}

/** 引用 section: numbered links back to the original records (元記録に飛べる). */
function buildCitationsSection(records: ResearchReportRecord[]): string {
  return records
    .map((r, i) => `${i + 1}. [${sanitizeForObsidian(r.title || r.url)}](${sanitizeUrlForMarkdownTarget(r.url)})`)
    .join('\n');
}

/** 未読穴 section: the records in the selection without a persisted summary. */
export function countUnreadHoles(records: ResearchReportRecord[]): number {
  return records.filter((r) => r.summary.trim().length === 0).length;
}

function buildUnreadHolesSection(records: ResearchReportRecord[]): string {
  const holes = records.filter((r) => r.summary.trim().length === 0);
  if (holes.length === 0) {
    return '未読穴はありません。選択範囲の全記録に要約があります。';
  }
  return holes.map((r) => `- ${r.title || r.url}`).join('\n');
}

/**
 * Pure report builder. 縮退の出口: an empty selection returns null — the
 * caller reports the reason instead of writing an empty report file.
 */
export function buildResearchReportMarkdown(
  records: ResearchReportRecord[],
  meta: { title: string; now: number },
): string | null {
  if (records.length === 0) return null;
  const holes = countUnreadHoles(records);
  return `# 調査レポート: ${meta.title}

Generated on: ${formatLocalDateString(meta.now)}
Records: ${records.length} / 未読穴: ${holes}

## 要旨

${sanitizeForObsidian(buildDigestSection(records))}

## 時系列

${buildTimelineSection(records)}

## 引用

${buildCitationsSection(records)}

## 未読穴

${sanitizeForObsidian(buildUnreadHolesSection(records))}
`;
}

/** Report filename: date + time so repeated runs never collide on overwrite. */
export function buildReportFilename(now: number): string {
  const date = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `research-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.md`;
}

/**
 * 調査レポート生成器を組み立てる。review summary generator と同じ注入作法:
 * sqlite/obsidian/download は呼び出し側から注入し、このモジュールは
 * transport を直接生成しない。
 */
export function createResearchReportGenerator(deps: ResearchReportGeneratorDeps): ResearchReportGenerator {
  const repo = deps.repo ?? settingsRepository;
  const reportMutex = new Mutex();

  return {
    async generate(input: { scope: ResearchReportScope; sendToObsidian?: boolean }): Promise<ResearchReportOutcome> {
      await reportMutex.acquire();
      try {
        // The panel conditions pick the selection rows (oldest first keeps the
        // timeline stable); the cap bounds the report, it never fails on size.
        const result = await deps.sqliteClient.query({
          ...(input.scope.search ? { text: input.scope.search } : {}),
          ...(input.scope.tag ? { tag: input.scope.tag } : {}),
          ...(input.scope.since !== undefined ? { dateFrom: input.scope.since } : {}),
          ...(input.scope.until !== undefined ? { dateTo: input.scope.until } : {}),
          orderBy: 'created_at',
          orderDir: 'ASC',
          limit: REPORT_MAX_RECORDS,
        });
        if (!result.success) {
          return { success: false, error: result.error.message || 'report_fetch_failed' };
        }
        const rows = result.data.rows.filter((row): row is BrowsingLogRecord & { id: number } => row.id !== undefined);
        const records = rows.map(toReportRecord);
        const markdown = buildResearchReportMarkdown(records, {
          title: input.scope.search || input.scope.tag || '選択範囲',
          now: Date.now(),
        });
        if (markdown === null) {
          return { success: false, error: 'no_records' };
        }

        const deliveredTo: ('download' | 'obsidian')[] = [];
        const stored = await repo.get(StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH);
        const exportPath = typeof stored === 'string' && stored.trim().length > 0 ? stored : DEFAULT_EXPORT_PATH;
        const downloaded = await deps.downloadMarkdown(markdown, buildReportFilename(Date.now()), exportPath);
        if (downloaded) deliveredTo.push('download');

        if (input.sendToObsidian === true) {
          try {
            await deps.obsidian.appendToDailyNote(markdown);
            deliveredTo.push('obsidian');
          } catch (error: unknown) {
            // 送達は部分的に成功しうる: ダウンロードは済んでいても Obsidian の
            // 失敗は理由として返す（偽成功にしない）。再送は同じ実行で届く。
            addLog(LogType.ERROR, 'Research report Obsidian delivery failed', { error: errorMessage(error) });
            return { success: false, error: 'obsidian_delivery_failed' };
          }
        }

        if (deliveredTo.length === 0) {
          return { success: false, error: 'download_failed' };
        }
        return { success: true, recordCount: records.length, deliveredTo };
      } catch (error: unknown) {
        return { success: false, error: errorMessage(error) };
      } finally {
        reportMutex.release();
      }
    },
  };
}
