/**
 * sqliteHistoryQuery.ts
 * 履歴パネルの「計算」部分を DOM とクロージャ状態から切り離した純関数群。
 *
 * sqliteHistoryPanel.ts の createSqliteHistoryPanel() は約930行のクロージャで、
 * state と DOM を共有しているため個々の計算を単体で検証する seam が無かった。
 * ここに切り出した関数は引数のみに依存するため、DBモックや jsdom を用意せずに
 * 直接テストできる。
 */

import type { BrowsingLogEntry } from '../../../utils/sqlite-types.js';
import type { SavedUrlEntry } from '../../../utils/storageUrls.js';

/** chrome.storage 補完のルックアップキーの粒度（1分） */
const ENRICHMENT_KEY_BUCKET_MS = 60000;

/**
 * chrome.storage 側エントリを引くためのキーを作る。
 * URL と「分」単位に丸めた時刻の組で対応付ける。
 */
export function buildEnrichmentKey(url: string, timestampMs: number): string {
  return `${url}|${Math.floor(timestampMs / ENRICHMENT_KEY_BUCKET_MS)}`;
}

/**
 * SQLite 側に診断メタデータが無いエントリを、chrome.storage 側の情報で補完する。
 * SQLite 側に値がある場合は常にそちらを優先する（?? による左優先）。
 *
 * @returns 補完後の新しいエントリ。補完不要／対応エントリ無しの場合は引数をそのまま返す
 */
export function enrichEntryWithChromeStorage(
  entry: BrowsingLogEntry,
  storageMap: Map<string, SavedUrlEntry>
): BrowsingLogEntry {
  // 主要な診断項目がすでに埋まっていれば補完不要
  if (entry.sent_tokens != null || entry.received_tokens != null ||
      entry.page_bytes != null || entry.ai_provider != null) {
    return entry;
  }

  const storageEntry = storageMap.get(buildEnrichmentKey(entry.url, entry.created_at));
  if (!storageEntry) {
    return entry;
  }

  return {
    ...entry,
    content: entry.content ?? storageEntry.content ?? null,
    masked_count: entry.masked_count ?? storageEntry.maskedCount ?? null,
    cleansed_reason: entry.cleansed_reason ?? storageEntry.cleansedReason ?? null,
    ai_provider: entry.ai_provider ?? storageEntry.aiProvider ?? null,
    ai_model: entry.ai_model ?? storageEntry.aiModel ?? null,
    ai_duration_ms: entry.ai_duration_ms ?? storageEntry.aiDuration ?? null,
    obsidian_duration_ms: entry.obsidian_duration_ms ?? storageEntry.obsidianDuration ?? null,
    sent_tokens: entry.sent_tokens ?? storageEntry.sentTokens ?? null,
    received_tokens: entry.received_tokens ?? storageEntry.receivedTokens ?? null,
    original_tokens: entry.original_tokens ?? storageEntry.originalTokens ?? null,
    cleansed_tokens: entry.cleansed_tokens ?? storageEntry.cleansedTokens ?? null,
    page_bytes: entry.page_bytes ?? storageEntry.pageBytes ?? null,
    candidate_bytes: entry.candidate_bytes ?? storageEntry.candidateBytes ?? null,
    original_bytes: entry.original_bytes ?? storageEntry.originalBytes ?? null,
    cleansed_bytes: entry.cleansed_bytes ?? storageEntry.cleansedBytes ?? null,
    ai_summary_original_bytes: entry.ai_summary_original_bytes ?? storageEntry.aiSummaryOriginalBytes ?? null,
    ai_summary_cleansed_bytes: entry.ai_summary_cleansed_bytes ?? storageEntry.aiSummaryCleansedBytes ?? null,
    fallback_triggered: entry.fallback_triggered ?? (storageEntry.fallbackTriggered ? 1 : 0),
  };
}

/**
 * タグ絞り込み。カンマ区切りの tags 文字列に対する部分一致で判定する。
 * tags が未設定／文字列でない行は常に除外する。
 */
export function filterRowsByTag(rows: BrowsingLogEntry[], tagFilter: string): BrowsingLogEntry[] {
  return rows.filter(row => {
    const tagsString = row.tags || '';
    if (typeof tagsString !== 'string') return false;
    return tagsString.split(',').some(tag => tag.trim().includes(tagFilter));
  });
}

/**
 * カレンダーで選択された日付(YYYY-MM-DD)を、その日1日分のローカル時刻range に変換する。
 * 未選択の場合は空オブジェクト（全期間）を返す。
 */
export function dateRangeFromSelectedDate(selectedDate: string | null): { since?: number; until?: number } {
  if (!selectedDate) return {};
  const date = new Date(selectedDate + 'T00:00:00');
  return { since: date.getTime(), until: date.getTime() + 86400000 - 1 };
}
