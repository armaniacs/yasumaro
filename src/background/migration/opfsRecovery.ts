/**
 * opfsRecovery.ts
 * OPFS fallback → SQLite recovery migration.
 * Extracted from migrationService.ts (PBI 2026-08-22-01).
 *
 * Jobs: needsOpfsRecoveryMigration(), migrateOpfsRecovery()
 */

import { addLog, LogType } from '../../utils/logger.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { SqliteClient } from '../sqliteClient.js';
import { errorMessage } from '../../utils/errorUtils.js';
import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';

/** FallbackStorage のストレージキー */
const FALLBACK_STORAGE_KEY = 'FALLBACK_STORAGE_DATA';

const BATCH_SIZE = 100;

/**
 * フォールバックデータを BrowsingLogRecord 形式に変換
 *
 * Maps all fields from the stored record (which was originally converted
 * via buildInsertRecordFields in schema.ts) with proper null/default handling.
 * Must stay in sync with all 31 fields of InsertRecordFields/schema.ts.
 */
function convertFallbackRecord(record: BrowsingLogRecord): BrowsingLogRecord {
  return {
    url: record.url,
    title: record.title ?? null,
    summary: record.summary ?? null,
    tags: record.tags ?? null,
    created_at: record.created_at,
    domain: record.domain ?? null,
    visit_duration: record.visit_duration ?? null,
    scroll_ratio: record.scroll_ratio ?? null,
    is_starred: record.is_starred ?? 0,
    is_deleted: record.is_deleted ?? 0,
    obsidian_synced: record.obsidian_synced ?? 0,
    gist_synced: record.gist_synced ?? 0,
    content: record.content ?? null,
    masked_count: record.masked_count ?? null,
    cleansed_reason: record.cleansed_reason ?? null,
    ai_provider: record.ai_provider ?? null,
    ai_model: record.ai_model ?? null,
    ai_duration_ms: record.ai_duration_ms ?? null,
    obsidian_duration_ms: record.obsidian_duration_ms ?? null,
    sent_tokens: record.sent_tokens ?? null,
    received_tokens: record.received_tokens ?? null,
    original_tokens: record.original_tokens ?? null,
    cleansed_tokens: record.cleansed_tokens ?? null,
    page_bytes: record.page_bytes ?? null,
    candidate_bytes: record.candidate_bytes ?? null,
    original_bytes: record.original_bytes ?? null,
    cleansed_bytes: record.cleansed_bytes ?? null,
    ai_summary_original_bytes: record.ai_summary_original_bytes ?? null,
    ai_summary_cleansed_bytes: record.ai_summary_cleansed_bytes ?? null,
    extracted_sentences_bytes: record.extracted_sentences_bytes ?? null,
    extracted_sentences_original_bytes: record.extracted_sentences_original_bytes ?? null,
    fallback_triggered: record.fallback_triggered ?? 0,
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

      // 2. SQLite が利用可能かチェック
      const statusResult = await this.sqliteClient.getStatus();
      if (!statusResult || statusResult.fallback === true) {
        // まだフォールバックモードのまま
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
      // フォールバックデータを取得
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

      // 移行完了 — まずデータを削除し、最後にフラグをクリアする
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
