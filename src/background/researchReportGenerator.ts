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
import { MAX_AND_CLAUSE_WINDOW, MAX_BATCH_READ_RECORDS } from '../utils/limits.js';
import { mergeClauseResults } from '../utils/collectionQueryV2.js';
import { addLog } from '../utils/logger/core.js';
import { LogType } from '../utils/logger/types.js';
import type { BrowsingLogRecord } from '../utils/sqlite-types.js';
import type {
  ResearchReportResponse,
  ResearchReportScope,
} from '../messaging/responseCanonical.js';
import type { ResearchReportClause } from '../messaging/responseCanonical.js';

/** Outcome and scope aliases of the canonical wire shapes (single definition). */
export type ResearchReportOutcome = ResearchReportResponse;
export type { ResearchReportScope };

/** Local export path default mirrors the review summary's setting. */
const DEFAULT_EXPORT_PATH = 'Yasumaro';

/** Records per report; a scope wider than this is capped, not rejected. */
export const REPORT_MAX_RECORDS = MAX_BATCH_READ_RECORDS;

/**
 * Per-clause id window for AND scopes (heuristic). AND intersects the
 * per-clause id sets, so fetching each clause with only REPORT_MAX_RECORDS
 * rows would silently drop matches at position 201+ before the intersect
 * runs. The raised window keeps the intersect honest for large clauses while
 * staying well under QUERY_CAPS (plain 10000 / fts 100000). The report
 * itself is still bounded by the final first-REPORT_MAX_RECORDS slice, and
 * the OR path keeps REPORT_MAX_RECORDS: a union cannot lose matches to a
 * pre-slice the way an intersect can.
 */
export const AND_CLAUSE_WINDOW = MAX_AND_CLAUSE_WINDOW;

/** One report row: id + the post-cleansing text the report quotes. */
export interface ResearchReportRecord {
  id: number;
  title: string;
  url: string;
  createdAt: number;
  /** Persisted post-cleansing summary; empty when the record has no one (未読穴). */
  summary: string;
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

/** 要旨 section: the selection's persisted summaries, in selection order. */
function buildDigestSection(records: ResearchReportRecord[]): string {
  const withSummary = records.filter((r) => r.summary.trim().length > 0);
  if (withSummary.length === 0) {
    return 'この選択範囲には要約済みの記録がありません。';
  }
  return withSummary
    .map((r) => `- ${r.title || r.url}: ${r.summary.trim()}`)
    .join('\n');
}

/** 時系列 section: oldest first, the report's reading order. Titles ride the
 * same Obsidian sanitizer as the digest so a crafted page title cannot smuggle
 * raw HTML into the note through this section. */
function buildTimelineSection(records: ResearchReportRecord[]): string {
  const ordered = [...records].sort((a, b) => a.createdAt - b.createdAt);
  return ordered
    .map((r) => `- ${formatLocalDateString(r.createdAt)} — ${sanitizeForObsidian(r.title || r.url)}`)
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
 * `excludedCount` names pinned ids that no longer resolve (deleted);
 * `truncated` names the first-200 cap on a wider UNION.
 */
export function buildResearchReportMarkdown(
  records: ResearchReportRecord[],
  meta: { title: string; now: number; excludedCount?: number; truncated?: boolean },
): string | null {
  if (records.length === 0) return null;
  const holes = countUnreadHoles(records);
  const excluded = meta.excludedCount ?? 0;
  const header = excluded > 0
    ? `Records: ${records.length} / 未読穴: ${holes} / 除外: ${excluded}`
    : `Records: ${records.length} / 未読穴: ${holes}`;
  const capNote = meta.truncated === true
    ? '\n注意: 対象が200件を超えたため、先頭200件で生成しています。'
    : '';
  return `# 調査レポート: ${sanitizeForObsidian(meta.title)}

Generated on: ${formatLocalDateString(meta.now)}
${header}${capNote}

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
 *
 * Selection resolution (PBI 2026-11-02-04 UNION semantics): a legacy
 * single scope (flat conditions, no clauses, no ids) keeps the original
 * single-query path. A V2 scope fans out per clause (ids fetch via the
 * existing query path), merges with mergeClauseResults(clauseResults, op),
 * UNIONs the pinned ids, then fetches the final rows in one ids query
 * (orderBy created_at ASC, first REPORT_MAX_RECORDS). Pinned ids that no
 * longer resolve (deleted) are excluded with the count shown — never an
 * error.
 */
export function createResearchReportGenerator(deps: ResearchReportGeneratorDeps): ResearchReportGenerator {
  const repo = deps.repo ?? settingsRepository;
  const reportMutex = new Mutex();

  return {
    async generate(input: { scope: ResearchReportScope; sendToObsidian?: boolean }): Promise<ResearchReportOutcome> {
      await reportMutex.acquire();
      try {
        const scope = input.scope;
        const pinnedIds = (scope.ids ?? []).filter((id) => Number.isFinite(id));
        const hasClauses = (scope.clauses?.length ?? 0) > 0;
        if (!hasClauses && pinnedIds.length === 0) {
          return await generateFromRows(deps, repo, await fetchSingleScope(deps, scope), scopeTitle(scope), input.sendToObsidian, {});
        }
        // V2 UNION path: fan-out per clause → merge → UNION ids → one rows fetch.
        // A pins-only scope carries no clause: the merge of zero clauses is
        // empty (never a whole-history fetch), so the UNION is the pins alone.
        const rawClauses: ResearchReportClause[] = hasClauses
          ? (scope.clauses as ResearchReportClause[])
          : [{ ...(scope.search !== undefined ? { search: scope.search } : {}), ...(scope.tag !== undefined ? { tag: scope.tag } : {}), ...(scope.since !== undefined ? { since: scope.since } : {}), ...(scope.until !== undefined ? { until: scope.until } : {}) }];
        const clauseList = rawClauses.filter((clause) =>
          clause.search !== undefined || clause.tag !== undefined || clause.since !== undefined || clause.until !== undefined);
        const op = scope.op ?? 'and';
        // AND intersects per-clause id sets, so each clause fetches with the
        // raised AND_CLAUSE_WINDOW (a 200-capped fetch would drop matches at
        // position 201+ before the intersect). OR unions, which cannot lose
        // matches to a pre-slice, keeps REPORT_MAX_RECORDS.
        const clauseWindow = op === 'and' ? AND_CLAUSE_WINDOW : REPORT_MAX_RECORDS;
        const clauseIdSets: number[][] = [];
        for (const clause of clauseList) {
          const ids = await fetchClauseIds(deps, clause, clauseWindow);
          if (!ids.ok) return { success: false, error: ids.error };
          clauseIdSets.push(ids.ids);
        }
        const merged = mergeClauseResults(clauseIdSets, op);
        // Id-sort pre-slice: ids are AUTOINCREMENT rowids, hence roughly
        // monotonic with created_at, so sorting by id approximates
        // oldest-first for the cap slice. Deletion/import can diverge the
        // two orders; the authoritative display order still comes from the
        // final orderBy created_at ASC fetch below.
        const union = [...new Set([...merged, ...pinnedIds])].sort((a, b) => a - b);
        const finalIds = union.slice(0, REPORT_MAX_RECORDS);
        if (finalIds.length === 0) {
          return { success: false, error: 'no_records' };
        }
        // Single final rows fetch with ids (existing query(ids) support, no
        // offscreen changes); deleted pins resolve to no row and are counted
        // as excluded, never an error.
        const result = await deps.sqliteClient.query({
          ids: finalIds,
          orderBy: 'created_at',
          orderDir: 'ASC',
          limit: REPORT_MAX_RECORDS,
        });
        if (!result.success) {
          return { success: false, error: result.error.message || 'report_fetch_failed' };
        }
        const rows = result.data.rows.filter((row): row is BrowsingLogRecord & { id: number } => row.id !== undefined);
        const excludedCount = finalIds.length - rows.length;
        // 先頭200件 note from delivered rows vs requested selection: show it
        // only when truncation actually cut resolvable rows. Subtracting the
        // excluded-missing (deleted pins, never resolvable) keeps a shortfall
        // explained by deletions from misreporting as a truncation cut.
        const truncated = union.length - excludedCount > REPORT_MAX_RECORDS;
        return await generateFromRows(deps, repo, { ok: true, rows }, scopeTitle(scope), input.sendToObsidian, { excludedCount, truncated });
      } catch (error: unknown) {
        return { success: false, error: errorMessage(error) };
      } finally {
        reportMutex.release();
      }
    },
  };
}

/** Report title: the single-scope condition, else the whole-selection default. */
function scopeTitle(scope: ResearchReportScope): string {
  return scope.search || scope.tag || '選択範囲';
}

/**
 * Legacy single-scope fetch (v1/single behavior, unchanged): the panel
 * conditions pick the selection rows in one query (oldest first keeps the
 * timeline stable); the cap bounds the report, it never fails on size.
 */
async function fetchSingleScope(
  deps: ResearchReportGeneratorDeps,
  scope: ResearchReportScope,
): Promise<{ ok: true; rows: Array<BrowsingLogRecord & { id: number }> } | { ok: false; error: string }> {
  const result = await deps.sqliteClient.query({
    ...(scope.search ? { text: scope.search } : {}),
    ...(scope.tag ? { tag: scope.tag } : {}),
    ...(scope.since !== undefined ? { dateFrom: scope.since } : {}),
    ...(scope.until !== undefined ? { dateTo: scope.until } : {}),
    orderBy: 'created_at',
    orderDir: 'ASC',
    limit: REPORT_MAX_RECORDS,
  });
  if (!result.success) {
    return { ok: false, error: result.error.message || 'report_fetch_failed' };
  }
  return { ok: true, rows: result.data.rows.filter((row): row is BrowsingLogRecord & { id: number } => row.id !== undefined) };
}

/** One clause's matching ids via the existing query path (rows in, ids out). */
async function fetchClauseIds(
  deps: ResearchReportGeneratorDeps,
  clause: ResearchReportClause,
  limit: number,
): Promise<{ ok: true; ids: number[] } | { ok: false; error: string }> {
  const result = await deps.sqliteClient.query({
    ...(clause.search !== undefined ? { text: clause.search } : {}),
    ...(clause.tag !== undefined ? { tag: clause.tag } : {}),
    ...(clause.since !== undefined ? { dateFrom: clause.since } : {}),
    ...(clause.until !== undefined ? { dateTo: clause.until } : {}),
    orderBy: 'created_at',
    orderDir: 'ASC',
    limit,
  });
  if (!result.success) {
    return { ok: false, error: result.error.message || 'report_fetch_failed' };
  }
  return { ok: true, ids: result.data.rows.filter((row) => row.id !== undefined).map((row) => row.id as number) };
}

/** Shared tail: markdown → download (+ optional Obsidian) → outcome. */
async function generateFromRows(
  deps: ResearchReportGeneratorDeps,
  repo: Pick<SettingsRepository, 'get'>,
  fetch: { ok: true; rows: Array<BrowsingLogRecord & { id: number }> } | { ok: false; error: string },
  title: string,
  sendToObsidian: boolean | undefined,
  meta: { excludedCount?: number; truncated?: boolean },
): Promise<ResearchReportOutcome> {
  if (!fetch.ok) {
    return { success: false, error: fetch.error };
  }
  const records = fetch.rows.map(toReportRecord);
  const markdown = buildResearchReportMarkdown(records, {
    title,
    now: Date.now(),
    ...(meta.excludedCount !== undefined && meta.excludedCount > 0 ? { excludedCount: meta.excludedCount } : {}),
    ...(meta.truncated === true ? { truncated: true } : {}),
  });
  if (markdown === null) {
    return { success: false, error: 'no_records' };
  }

  const deliveredTo: ('download' | 'obsidian')[] = [];
  const stored = await repo.get(StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH);
  const exportPath = typeof stored === 'string' && stored.trim().length > 0 ? stored : DEFAULT_EXPORT_PATH;
  const downloaded = await deps.downloadMarkdown(markdown, buildReportFilename(Date.now()), exportPath);
  if (downloaded) deliveredTo.push('download');

  if (sendToObsidian === true) {
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
}
