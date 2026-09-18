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

import { textToBase64 } from '../utils/crypto/primitives.js';
import { settingsRepository, type SettingsReader } from '../utils/storage/SettingsRepository.js';
import { DEFAULT_SETTINGS } from '../utils/storage/defaults.js';
import { StorageKeys } from '../utils/storage/types.js';
import type { AIService } from './ai/AIService.js';
import type { SqliteClient } from './sqlite/offscreenGateway.js';
import { addLog, LogType } from '../utils/logger.js';
import { errorMessage } from '../utils/errorUtils.js';
import { sanitizeForObsidian } from '../utils/markdownSanitizer.js';
import { resolveSafeExportDir } from '../utils/pathSanitizer.js';
import type { BrowsingLogRecord } from '../utils/sqlite-types.js';
import { Mutex } from '../utils/Mutex.js';

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
    const base64 = textToBase64(content);
    const dataUrl = `data:text/markdown;base64,${base64}`;

    // PBI 27: exportPath はユーザー設定の自由文字列。filename 組み立て時に
    // sanitize し、失敗時は既定フォルダにフォールバックする。filename 自体は
    // week-NN / month-NN の内部生成で安全。
    await chrome.downloads.download({
      url: dataUrl,
      filename: `${resolveSafeExportDir(exportPath)}/${filename}`,
      saveAs: false,
      // PBI 27 上書きガード方針: 期間キーの冪等な再書き込みが正しい動作の
      // ため明示 'overwrite'（全 4 箇所で統一）。
      conflictAction: 'overwrite'
    });

    addLog(LogType.INFO, 'Review summary downloaded', { filename, exportPath });
    return true;
  } catch (error) {
    addLog(LogType.ERROR, 'Failed to download review summary', { error: errorMessage(error), filename });
    return false;
  }
}

interface SummaryPeriod {
  kind: 'week' | 'month';
  /** Markdown見出し・digestプロンプトに使う人間可読ラベル。 */
  label: string;
  start: number;
  end: number;
  storageKey: string;
  lastGeneratedKey: typeof StorageKeys.REVIEW_SUMMARY_LAST_GENERATED_WEEK | typeof StorageKeys.REVIEW_SUMMARY_LAST_GENERATED_MONTH;
  /** digestプロンプト・ログの文言に使う単位表現（例: "1週間" / "1ヶ月間"）。 */
  digestPromptUnit: string;
}

function buildWeekPeriod(date: Date): SummaryPeriod {
  const weekYear = getISOWeekYear(date);
  const weekNum = getISOWeekNumber(date);
  const weekKey = `${weekYear}-W${String(weekNum).padStart(2, '0')}`;
  const { start, end } = getWeekPeriod(date);

  return {
    kind: 'week',
    label: `Week ${weekNum} (${weekYear})`,
    start,
    end,
    storageKey: weekKey,
    lastGeneratedKey: StorageKeys.REVIEW_SUMMARY_LAST_GENERATED_WEEK,
    digestPromptUnit: '1週間'
  };
}

function buildMonthPeriod(date: Date): SummaryPeriod {
  const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const { start, end } = getMonthPeriod(date);

  return {
    kind: 'month',
    label: `${date.getFullYear()}年${date.getMonth() + 1}月`,
    start,
    end,
    storageKey: monthKey,
    lastGeneratedKey: StorageKeys.REVIEW_SUMMARY_LAST_GENERATED_MONTH,
    digestPromptUnit: '1ヶ月間'
  };
}

function filenameForPeriod(period: SummaryPeriod, date: Date): string {
  if (period.kind === 'week') {
    const weekYear = getISOWeekYear(date);
    const weekNum = getISOWeekNumber(date);
    return `${weekYear}-week-${String(weekNum).padStart(2, '0')}.md`;
  }
  return `${date.getFullYear()}-month-${String(date.getMonth() + 1).padStart(2, '0')}.md`;
}

/**
 * 週次/月次レビューサマリ生成器を組み立てる。
 *
 * aiServiceとsqliteClientは呼び出し側から注入し、生成器自身はAIClient等を直接生成しない。
 */
export function createReviewSummaryGenerator(options: CreateReviewSummaryGeneratorOptions): ReviewSummaryGenerator {
  const { aiService, sqliteClient, repo = settingsRepository } = options;
  const weeklyMutex = new Mutex();
  const monthlyMutex = new Mutex();

  async function generatePeriodSummary(period: SummaryPeriod, mutex: Mutex, date: Date): Promise<boolean> {
    const periodNoun = period.kind === 'week' ? 'weekly' : 'monthly';
    await mutex.acquire();
    try {
      const settings = await repo.getAll();
      const enabled = settings[StorageKeys.REVIEW_SUMMARY_ENABLED];
      if (!enabled) {
        addLog(LogType.INFO, `${periodNoun === 'weekly' ? 'Weekly' : 'Monthly'} review summary is disabled`);
        return false;
      }

      // Check if already generated
      const lastGenerated = settings[period.lastGeneratedKey];
      if (lastGenerated === period.storageKey) {
        addLog(
          LogType.INFO,
          `${periodNoun === 'weekly' ? 'Weekly' : 'Monthly'} summary already generated for this ${period.kind}`,
          { [`${period.kind}Key`]: period.storageKey }
        );
        return false;
      }

      const queryRes = await sqliteClient.query({ dateFrom: period.start, dateTo: period.end, limit: 10000 });

      if (!queryRes.success) {
        addLog(LogType.ERROR, `Failed to query entries for ${periodNoun} summary`, {
          [`${period.kind}Key`]: period.storageKey,
          error: queryRes.error.message
        });
        return false;
      }
      const result = queryRes.data;
      if (result.rows.length === 0) {
        addLog(LogType.INFO, `No entries for this ${period.kind}, skipping`, { [`${period.kind}Key`]: period.storageKey });
        return false;
      }

      // Generate digest using AI
      const summaries = result.rows
        .map((e) => e.summary)
        .filter(Boolean)
        .join('\n\n');

      let digest = `${periodNoun === 'weekly' ? 'Weekly' : 'Monthly'} review digest generation requires AI provider configuration.`;
      if (summaries) {
        const digestResult = await aiService.generateSummary(
          `以下の${period.digestPromptUnit}の閲覧ページの要約を統合して、${periodNoun === 'weekly' ? '週次' : '月次'}振り返りダイジェストを生成してください。\n\n${summaries}`
        );
        if (digestResult.success) {
          digest = digestResult.summary;
        }
      }

      const entries = result.rows as ReviewLogEntry[];

      const markdown = generateReviewMarkdown(period.label, entries, digest);
      const filename = filenameForPeriod(period, date);
      const exportPath = settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]
        ?? (DEFAULT_SETTINGS[StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH] as string);

      const success = await downloadMarkdown(markdown, filename, exportPath);

      if (success) {
        await chrome.storage.local.set({
          [period.lastGeneratedKey]: period.storageKey
        });
        addLog(LogType.INFO, `${periodNoun === 'weekly' ? 'Weekly' : 'Monthly'} review summary generated`, {
          [`${period.kind}Key`]: period.storageKey,
          entryCount: result.rows.length
        });
      }

      return success;
    } finally {
      mutex.release();
    }
  }

  async function generateWeeklySummary(targetDate?: Date): Promise<boolean> {
    const date = targetDate || new Date();
    return generatePeriodSummary(buildWeekPeriod(date), weeklyMutex, date);
  }

  async function generateMonthlySummary(targetDate?: Date): Promise<boolean> {
    const date = targetDate || new Date();
    return generatePeriodSummary(buildMonthPeriod(date), monthlyMutex, date);
  }

  return { generateWeeklySummary, generateMonthlySummary };
}

// Exported for testing
export { getISOWeekNumber, getISOWeekYear, getWeekPeriod, getMonthPeriod, generateStatsSection, generateReviewMarkdown };
