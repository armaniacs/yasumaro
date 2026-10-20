/**
 * opfsRecovery.ts
 * OPFS fallback → SQLite recovery migration.
 * Extracted from migrationService.ts (PBI 2026-08-22-01).
 *
 * Jobs: needsOpfsRecoveryMigration(), migrateOpfsRecovery()
 */

import { LogType } from '../../utils/logger/types.js';
import { addLog } from '../../utils/logger/core.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { SqliteClient } from '../sqlite/offscreenGateway.js';
import { errorMessage } from '../../utils/errorUtils.js';
import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';

/** FallbackStorage のストレージキー */
const FALLBACK_STORAGE_KEY = 'FALLBACK_STORAGE_DATA';

const BATCH_SIZE = 100;

/** getStatus() の snapshot（失敗時の fail-open 側既定値を含む） */
type SqliteStatusSnapshot = Awaited<ReturnType<SqliteClient['getStatus']>>;

/**
 * True only when the engine is confirmed to be SQLite: initialized and not in
 * fallback mode. A null status or the gateway's failure shape
 * ({initialized: false, fallback: false}) must fail closed — the recovery's
 * final remove destroys the fallback store, the only remaining copy of the
 * rows, so "unknown" means "do not migrate".
 *
 * This gate is also the retry-chain cap for a permanently degraded engine:
 * while the engine stays in fallback mode, needsMigration() never passes it,
 * so migrate() is never invoked again on later service worker startups.
 */
function isSqliteEngineConfirmed(status: SqliteStatusSnapshot | null | undefined): boolean {
  return !!status && status.initialized === true && status.fallback !== true;
}

/**
 * Identity of a fallback row. Mirrors the dedupe key the fallback store itself
 * uses (storageFallback.ts: `${url}\0${created_at}`), so a row that was written
 * after the snapshot is never confused with a snapshot row.
 */
function fallbackRecordKey(record: BrowsingLogRecord): string {
  return `${record.url}\0${record.created_at}`;
}

/**
 * フォールバックデータを BrowsingLogRecord 形式に変換
 *
 * Maps all fields from the stored record (which was originally converted
 * via buildInsertRecordFields in schema.ts) with proper null/default handling.
 * Must stay in sync with COLUMN_NAMES / InsertRecordFields (schema.ts) — the
 * mapping enumerates all 35 fields, and
 * __tests__/opfsRecovery.test.ts pins the output key set against
 * COLUMN_NAMES, so a new schema column fails CI until it is mapped here
 * (the field count is not hand-maintained; COLUMN_NAMES is the SSOT).
 *
 * The flat field mapping is split into field-group helpers below; the merge
 * order matches the original property order, so the produced object is
 * identical (same keys, same order, same values).
 */
function convertFallbackRecord(record: BrowsingLogRecord): BrowsingLogRecord {
  return {
    ...coreFallbackFields(record),
    ...flagFallbackFields(record),
    ...contentFallbackFields(record),
    ...tokenFallbackFields(record),
    ...byteFallbackFields(record),
    ...trailFallbackFields(record),
  };
}

/** Identity and engagement fields (url/title/summary/tags/timestamp/domain/durations). */
function coreFallbackFields(
  record: BrowsingLogRecord,
): Pick<BrowsingLogRecord, 'url' | 'title' | 'summary' | 'tags' | 'created_at' | 'domain' | 'visit_duration' | 'scroll_ratio'> {
  return {
    url: record.url,
    title: record.title ?? null,
    summary: record.summary ?? null,
    tags: record.tags ?? null,
    created_at: record.created_at,
    domain: record.domain ?? null,
    visit_duration: record.visit_duration ?? null,
    scroll_ratio: record.scroll_ratio ?? null,
  };
}

/** Star/sync flag fields. */
function flagFallbackFields(
  record: BrowsingLogRecord,
): Pick<BrowsingLogRecord, 'is_starred' | 'is_deleted' | 'obsidian_synced' | 'gist_synced'> {
  return {
    is_starred: record.is_starred ?? 0,
    is_deleted: record.is_deleted ?? 0,
    obsidian_synced: record.obsidian_synced ?? 0,
    gist_synced: record.gist_synced ?? 0,
  };
}

/** Content-processing and AI/obsidian metadata fields. */
function contentFallbackFields(
  record: BrowsingLogRecord,
): Pick<BrowsingLogRecord, 'content' | 'masked_count' | 'cleansed_reason' | 'ai_provider' | 'ai_model' | 'ai_duration_ms' | 'obsidian_duration_ms'> {
  return {
    content: record.content ?? null,
    masked_count: record.masked_count ?? null,
    cleansed_reason: record.cleansed_reason ?? null,
    ai_provider: record.ai_provider ?? null,
    ai_model: record.ai_model ?? null,
    ai_duration_ms: record.ai_duration_ms ?? null,
    obsidian_duration_ms: record.obsidian_duration_ms ?? null,
  };
}

/** Token metric fields. */
function tokenFallbackFields(
  record: BrowsingLogRecord,
): Pick<BrowsingLogRecord, 'sent_tokens' | 'received_tokens' | 'original_tokens' | 'cleansed_tokens'> {
  return {
    sent_tokens: record.sent_tokens ?? null,
    received_tokens: record.received_tokens ?? null,
    original_tokens: record.original_tokens ?? null,
    cleansed_tokens: record.cleansed_tokens ?? null,
  };
}

/** Byte metric fields (page/candidate/original/cleansed/ai summary/extracted sentences). */
function byteFallbackFields(
  record: BrowsingLogRecord,
): Pick<BrowsingLogRecord, 'page_bytes' | 'candidate_bytes' | 'original_bytes' | 'cleansed_bytes' | 'ai_summary_original_bytes' | 'ai_summary_cleansed_bytes' | 'extracted_sentences_bytes' | 'extracted_sentences_original_bytes'> {
  return {
    page_bytes: record.page_bytes ?? null,
    candidate_bytes: record.candidate_bytes ?? null,
    original_bytes: record.original_bytes ?? null,
    cleansed_bytes: record.cleansed_bytes ?? null,
    ai_summary_original_bytes: record.ai_summary_original_bytes ?? null,
    ai_summary_cleansed_bytes: record.ai_summary_cleansed_bytes ?? null,
    extracted_sentences_bytes: record.extracted_sentences_bytes ?? null,
    extracted_sentences_original_bytes: record.extracted_sentences_original_bytes ?? null,
  };
}

/** Fallback flag/reason and PBI 03 trail fields. */
function trailFallbackFields(
  record: BrowsingLogRecord,
): Pick<BrowsingLogRecord, 'fallback_triggered' | 'fallback_reason' | 'nav_source_url' | 'search_query'> {
  return {
    fallback_triggered: record.fallback_triggered ?? 0,
    // PBI 05: the opt-in diagnosis reason is the only evidence of why the
    // autosave rejected the content — dropping it here NULLs the column for
    // every recovered row while the original store is deleted right after.
    fallback_reason: record.fallback_reason ?? null,
    // PBI 03: records written before the opt-in existed carry no trail; null
    // keeps the recovery insert aligned with the new columns.
    nav_source_url: record.nav_source_url ?? null,
    search_query: record.search_query ?? null,
  };
}

/**
 * OpfsRecoveryService handles migration of OPFS fallback data to SQLite.
 * Independent from legacy migration — no shared state.
 */
export class OpfsRecoveryService {
  constructor(private readonly sqliteClient: SqliteClient) {}

  /**
   * OPFS 復旧時のマイグレーションが必要かチェック
   * - OPFS_FALLBACK_MODE が true
   * - SQLite が OPFS/IDB で利用可能
   * - フォールバックデータが存在する
   */
  async needsMigration(): Promise<boolean> {
    try {
      // 1. フォールバックモードかチェック
      const fallbackResult = await chrome.storage.local.get(StorageKeys.OPFS_FALLBACK_MODE);
      const isFallbackMode = fallbackResult[StorageKeys.OPFS_FALLBACK_MODE] === true;

      if (!isFallbackMode) {
        return false;
      }

      // 2. SQLite が利用可能かチェック（fail-closed: status が不明でも移行しない）
      const statusResult = await this.sqliteClient.getStatus();
      if (!isSqliteEngineConfirmed(statusResult)) {
        // まだフォールバックモードのまま、または status が不明（未初期化・取得失敗）
        return false;
      }

      // 3. フォールバックデータが存在するかチェック
      const dataResult = await chrome.storage.local.get(FALLBACK_STORAGE_KEY);
      const fallbackData = dataResult[FALLBACK_STORAGE_KEY] as { records: BrowsingLogRecord[] } | undefined;

      if (!fallbackData || !fallbackData.records || !Array.isArray(fallbackData.records) || fallbackData.records.length === 0) {
        return false;
      }

      return true;
    } catch (error) {
      addLog(LogType.ERROR, 'OPFS recovery check failed', { error: errorMessage(error) });
      return false; // エラー時は安全側に倒す
    }
  }

  /**
   * OPFS 復旧時にフォールバックデータを SQLite に移行
   */
  async migrate(): Promise<{ success: boolean; migrated: number; error?: string }> {
    let totalMigrated = 0;

    try {
      // 0. 実行直前の status 再確認（fail-closed）。needsMigration() のゲートを
      // 迂回して呼ばれても、fallback モード・未初期化・status 取得失敗のいずれ
      // でも insertBatch を 1 回も発行せず中断し、ストアは一切削除しない
      const initialStatus = await this.sqliteClient.getStatus();
      if (!isSqliteEngineConfirmed(initialStatus)) {
        addLog(LogType.WARN, 'OPFS recovery: engine not confirmed, deferring migration', {});
        return {
          success: false,
          migrated: 0,
          error: 'SQLite engine not confirmed (fallback mode or status unknown)',
        };
      }

      // フォールバックデータを取得（snapshot。この配列が移行対象の確定値）
      const dataResult = await chrome.storage.local.get(FALLBACK_STORAGE_KEY);
      const fallbackData = dataResult[FALLBACK_STORAGE_KEY] as { records: BrowsingLogRecord[] } | undefined;

      if (!fallbackData || !fallbackData.records || !Array.isArray(fallbackData.records)) {
        return { success: true, migrated: 0 };
      }

      const records = fallbackData.records;
      addLog(LogType.INFO, 'OPFS recovery: starting migration', { totalRecords: records.length });

      // バッチ単位で SQLite にインポート
      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE).map(convertFallbackRecord);

        try {
          const result = await this.sqliteClient.mutate({ type: 'insertBatch', records: batch });

          const normalized = result;
          if (normalized.success) {
            totalMigrated += normalized.data.count;
          } else {
            return {
              success: false,
              migrated: totalMigrated,
              error: normalized.error.message,
            };
          }
        } catch (batchError) {
          return {
            success: false,
            migrated: totalMigrated,
            error: errorMessage(batchError),
          };
        }
      }

      // 1. remove 直前の status 再確認: バッチループ中にエンジンが fallback へ
      // degrade した場合、その後のバッチは fallback アダプタで no-op になるため、
      // 破壊的経路（remove）に入る前に中断する
      const finalStatus = await this.sqliteClient.getStatus();
      if (!isSqliteEngineConfirmed(finalStatus)) {
        addLog(LogType.WARN, 'OPFS recovery: engine degraded during migration, deferring', {});
        return {
          success: false,
          migrated: totalMigrated,
          error: 'SQLite engine degraded during recovery',
        };
      }

      // 2. 最終削除の直前に FALLBACK_STORAGE_DATA を再読し、snapshot に含まれる
      // 行だけを間引く。snapshot 後に書かれた行（移行対象外）は必ず残す
      const recheckResult = await chrome.storage.local.get(FALLBACK_STORAGE_KEY);
      const currentData = recheckResult[FALLBACK_STORAGE_KEY] as { records: BrowsingLogRecord[] } | undefined;

      if (currentData && currentData.records && Array.isArray(currentData.records) && currentData.records.length > 0) {
        const snapshotKeys = new Set(records.map(fallbackRecordKey));
        const surviving = currentData.records.filter((record) => !snapshotKeys.has(fallbackRecordKey(record)));

        if (surviving.length > 0) {
          // 完全移行ではない: snapshot 行だけを間引き、マーカーは落とさない
          // （次のサービスワーカー起動で残りを再試行できる状態を維持する）
          await chrome.storage.local.set({ [FALLBACK_STORAGE_KEY]: { records: surviving } });
          addLog(LogType.INFO, 'OPFS recovery: migration completed with deferred rows', { migrated: totalMigrated, deferred: surviving.length });
          return { success: true, migrated: totalMigrated };
        }
      }

      // 3. 全件着地（または再読時にストアが空）— まずデータを削除し、最後にフラグをクリアする
      await chrome.storage.local.remove(FALLBACK_STORAGE_KEY);
      await chrome.storage.local.remove(StorageKeys.OPFS_FALLBACK_MODE);

      addLog(LogType.INFO, 'OPFS recovery: migration completed', { migrated: totalMigrated });

      return { success: true, migrated: totalMigrated };
    } catch (error) {
      addLog(LogType.ERROR, 'OPFS recovery: migration failed', { error: errorMessage(error) });
      return {
        success: false,
        migrated: totalMigrated,
        error: errorMessage(error),
      };
    }
  }
}
