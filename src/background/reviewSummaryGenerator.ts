/**
 * reviewSummaryGenerator.ts
 * 週次/月次レビューサマリの生成ロジック
 *
 * 対象期間の閲覧履歴を集計し、AI要約を用いたダイジェストMarkdownファイルを生成する。
 * 出力先: ~/Downloads/Yasumaro/YYYY-week-NN.md / YYYY-month-NN.md
 *
 * AIServiceとSQLite queryはfactory引数で注入する（ADR 2026-07-27、deep-dig 子PBI 5）。
 * インスタンスはcomposition rootで1度だけ生成し、alarmとGENERATE_REVIEW_SUMMARYが共有する。
 */

import { settingsRepository, type SettingsReader } from '../utils/storage/SettingsRepository.js';
import { DEFAULT_SETTINGS } from '../utils/storage/defaults.js';
import { StorageKeys } from '../utils/storage/types.js';
import type { AIService } from './ai/AIService.js';
import type { SqliteClient } from './sqliteClient.js';
import { addLog, LogType } from '../utils/logger.js';
import { errorMessage } from '../utils/errorUtils.js';
import { sanitizeForObsidian } from '../utils/markdownSanitizer.js';
import type { BrowsingLogRecord } from '../utils/sqlite-types.js';

type ReviewLogEntry = BrowsingLogRecord & { id: number };

/** Review summary生成器。alarmとmessage handlerが同一インスタンスを共有する。 */
export interface ReviewSummaryGenerator {
  generateWeeklySummary(targetDate?: Date): Promise<boolean>;
  generateMonthlySummary(targetDate?: Date): Promise<boolean>;
}

export interface CreateReviewSummaryGeneratorOptions {
  /** AI要約の実行先。provider選択・token policyはcomposition rootの構成に従う。 */
  aiService: AIService;
  /** 対象期間の閲覧履歴を引くSQLite query。 */
  sqliteClient: Pick<SqliteClient, 'query'>;
  /** 設定の読み取り先。テストでは InMemory repo を注入する。 */
  repo?: SettingsReader;
}

/**
 * ISO週番号を取得する
 */
function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/**
 * ISO年を取得する（週番号が前年の12月末に跨る場合に対応）
 */
function getISOWeekYear(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  return d.getUTCFullYear();
}

/**
 * 対象期間の開始・終了タイムスタンプを計算する（週次）
 */
function getWeekPeriod(date: Date): { start: number; end: number } {
  const d = new Date(date);
  // 月曜日に合わせる
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { start: monday.getTime(), end: sunday.getTime() };
}

/**
 * 対象期間の開始・終了タイムスタンプを計算する（月次）
 */
function getMonthPeriod(date: Date): { start: number; end: number } {
  const year = date.getFullYear();
  const month = date.getMonth();

  const start = new Date(year, month, 1, 0, 0, 0, 0);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);

  return { start: start.getTime(), end: end.getTime() };
}

/**
 * 統計セクションを生成する
 */
function generateStatsSection(entries: ReviewLogEntry[]): string {
  if (entries.length === 0) {
    return '## Statistics\n\nNo entries in this period.\n';
  }

  const totalVisitDuration = entries.reduce((sum, e) => sum + (e.visit_duration || 0), 0);
  const avgVisitDuration = totalVisitDuration / entries.length;

  // Domain breakdown
  const domainCounts: Record<string, number> = {};
  for (const entry of entries) {
    const domain = entry.domain || 'unknown';
    domainCounts[domain] = (domainCounts[domain] || 0) + 1;
  }

  const domainLines = Object.entries(domainCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([domain, count]) => `  - ${domain}: ${count} entries`)
    .join('\n');

  return `## Statistics

- **Total entries:** ${entries.length}
- **Average visit duration:** ${(avgVisitDuration / 1000).toFixed(1)}s

### Top Domains
${domainLines || '  - No data'}
`;
}

/**
 * レビューサマリMarkdownを生成する
 */
function generateReviewMarkdown(
  periodLabel: string,
  entries: ReviewLogEntry[],
  digest: string
): string {
  const dateStr = new Date().toISOString().split('T')[0];

  const entryList = entries.map((e, i) => {
    const title = sanitizeForObsidian(e.title || e.url || 'Untitled');
    const domain = e.domain || new URL(e.url).hostname;
    const summary = sanitizeForObsidian(e.summary || 'No summary available');
    const url = sanitizeForObsidian(e.url);
    return `### ${i + 1}. ${title}\n\n**URL:** ${url}\n**Domain:** ${domain}\n**Date:** ${new Date(e.created_at).toLocaleDateString()}\n\n${summary}`;
  }).join('\n\n---\n\n');

  return `# Yasumaro Review: ${periodLabel}

Generated on: ${dateStr}

## Digest

${sanitizeForObsidian(digest)}

${generateStatsSection(entries)}

## Entries

${entryList || 'No entries in this period.'}
`;
}

/**
 * ファイルをダウンロードする
 */
async function downloadMarkdown(content: string, filename: string, exportPath: string): Promise<boolean> {
  try {
    const base64 = btoa(unescape(encodeURIComponent(content)));
    const dataUrl = `data:text/markdown;base64,${base64}`;

    await chrome.downloads.download({
      url: dataUrl,
      filename: `${exportPath}/${filename}`,
      saveAs: false,
      conflictAction: 'overwrite'
    });

    addLog(LogType.INFO, 'Review summary downloaded', { filename, exportPath });
    return true;
  } catch (error) {
    addLog(LogType.ERROR, 'Failed to download review summary', { error: errorMessage(error), filename });
    return false;
  }
}

/**
 * 週次/月次レビューサマリ生成器を組み立てる。
 *
 * aiServiceとsqliteClientは呼び出し側から注入し、生成器自身はAIClient等を直接生成しない。
 */
export function createReviewSummaryGenerator(options: CreateReviewSummaryGeneratorOptions): ReviewSummaryGenerator {
  const { aiService, sqliteClient, repo = settingsRepository } = options;

  async function generateWeeklySummary(targetDate?: Date): Promise<boolean> {
    const settings = await repo.getAll();
    const enabled = settings[StorageKeys.REVIEW_SUMMARY_ENABLED];
    if (!enabled) {
      addLog(LogType.INFO, 'Weekly review summary is disabled');
      return false;
    }

    const date = targetDate || new Date();
    const weekYear = getISOWeekYear(date);
    const weekNum = getISOWeekNumber(date);
    const weekKey = `${weekYear}-W${String(weekNum).padStart(2, '0')}`;

    // Check if already generated
    const lastGenerated = settings[StorageKeys.REVIEW_SUMMARY_LAST_GENERATED_WEEK];
    if (lastGenerated === weekKey) {
      addLog(LogType.INFO, 'Weekly summary already generated for this week', { weekKey });
      return false;
    }

const { start, end } = getWeekPeriod(date);
     const queryRes = await sqliteClient.query({ dateFrom: start, dateTo: end, limit: 10000 });

     if (!queryRes.success) {
      addLog(LogType.ERROR, 'Failed to query entries for weekly summary', { weekKey, error: queryRes.error.message });
      return false;
    }
    const result = queryRes.data;
    if (result.rows.length === 0) {
      addLog(LogType.INFO, 'No entries for this week, skipping', { weekKey });
      return false;
    }

    // Generate digest using AI
    const summaries = result.rows
      .map((e) => e.summary)
      .filter(Boolean)
      .join('\n\n');

    let digest = 'Weekly review digest generation requires AI provider configuration.';
    if (summaries) {
      const digestResult = await aiService.generateSummary(
        `以下の1週間の閲覧ページの要約を統合して、週次振り返りダイジェストを生成してください。\n\n${summaries}`
      );
      if (digestResult.success) {
        digest = digestResult.summary;
      }
    }

    const entries = result.rows as ReviewLogEntry[];

    const markdown = generateReviewMarkdown(`Week ${weekNum} (${weekYear})`, entries, digest);
    const filename = `${weekYear}-week-${String(weekNum).padStart(2, '0')}.md`;
    const exportPath = settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]
      ?? (DEFAULT_SETTINGS[StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH] as string);

    const success = await downloadMarkdown(markdown, filename, exportPath);

    if (success) {
      // Save last generated week
      await chrome.storage.local.set({
        [StorageKeys.REVIEW_SUMMARY_LAST_GENERATED_WEEK]: weekKey
      });
      addLog(LogType.INFO, 'Weekly review summary generated', { weekKey, entryCount: result.rows.length });
    }

    return success;
  }

  async function generateMonthlySummary(targetDate?: Date): Promise<boolean> {
    const settings = await repo.getAll();
    const enabled = settings[StorageKeys.REVIEW_SUMMARY_ENABLED];
    if (!enabled) {
      addLog(LogType.INFO, 'Monthly review summary is disabled');
      return false;
    }

    const date = targetDate || new Date();
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    // Check if already generated
    const lastGenerated = settings[StorageKeys.REVIEW_SUMMARY_LAST_GENERATED_MONTH];
    if (lastGenerated === monthKey) {
      addLog(LogType.INFO, 'Monthly summary already generated for this month', { monthKey });
      return false;
    }

const { start, end } = getMonthPeriod(date);
     const queryRes = await sqliteClient.query({ dateFrom: start, dateTo: end, limit: 10000 });

     if (!queryRes.success) {
      addLog(LogType.ERROR, 'Failed to query entries for monthly summary', { monthKey, error: queryRes.error.message });
      return false;
    }
    const result = queryRes.data;
    if (result.rows.length === 0) {
      addLog(LogType.INFO, 'No entries for this month, skipping', { monthKey });
      return false;
    }

    // Generate digest using AI
    const summaries = result.rows
      .map((e) => e.summary)
      .filter(Boolean)
      .join('\n\n');

    let digest = 'Monthly review digest generation requires AI provider configuration.';
    if (summaries) {
      const digestResult = await aiService.generateSummary(
        `以下の1ヶ月間の閲覧ページの要約を統合して、月次振り返りダイジェストを生成してください。\n\n${summaries}`
      );
      if (digestResult.success) {
        digest = digestResult.summary;
      }
    }

    const entries = result.rows as ReviewLogEntry[];

    const markdown = generateReviewMarkdown(`${date.getFullYear()}年${date.getMonth() + 1}月`, entries, digest);
    const filename = `${date.getFullYear()}-month-${String(date.getMonth() + 1).padStart(2, '0')}.md`;
    const exportPath = settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]
      ?? (DEFAULT_SETTINGS[StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH] as string);

    const success = await downloadMarkdown(markdown, filename, exportPath);

    if (success) {
      // Save last generated month
      await chrome.storage.local.set({
        [StorageKeys.REVIEW_SUMMARY_LAST_GENERATED_MONTH]: monthKey
      });
      addLog(LogType.INFO, 'Monthly review summary generated', { monthKey, entryCount: result.rows.length });
    }

    return success;
  }

  return { generateWeeklySummary, generateMonthlySummary };
}

// Exported for testing
export { getISOWeekNumber, getISOWeekYear, getWeekPeriod, getMonthPeriod, generateStatsSection, generateReviewMarkdown };
