/**
 * trustDbVersion.ts
 * Trust Database's own schema-version management (migrations between
 * TrustDatabase shapes). This is distinct from TrancoVersionTracker, which
 * tracks the version string of the externally-sourced Tranco domain list —
 * do not conflate the two when reading/extending this module.
 */

import type { TrustDatabase } from './trustDbSchema.js';
import { logDebug, logInfo, logError, ErrorCode } from '../logger.js';
import { compareVersions as _compareVersions } from './domainValidation.js';
import { JP_ANCHOR_TLDS } from './presets.js';
import { SENSITIVE_DOMAINS_PRESETS as PRESETS } from './presets.js';

export const DB_VERSION = '1.0.0';

// JP-Anchor プリセット TLD（presets.ts から取得）
const JP_ANCHOR_TLDS_PRESET = [...JP_ANCHOR_TLDS] as readonly string[];

// Sensitive ドメインプリセット（presets.ts から取得。正本は presets.ts に一元化）
const SENSITIVE_DOMAINS_PRESETS = PRESETS;

export interface TrustDbVersionDeps {
  /** Persist the database after migration defaults are applied / version bumped. */
  save: () => Promise<void>;
}

export class TrustDbVersion {
  constructor(private readonly deps: TrustDbVersionDeps) {}

  /**
   * バージョン情報を取得
   */
  getVersion(): string {
    return DB_VERSION;
  }

  /**
   * バージョン比較（domainValidation.ts の compareVersions に委譲）
   */
  compareVersions(v1: string, v2: string): number {
    return _compareVersions(v1, v2);
  }

  /**
   * データベースのマイグレーション
   * @param db マイグレーション対象のデータベース
   */
  async migrateDatabase(db: TrustDatabase): Promise<void> {
    const currentVersion = db.version || '0.0.0';
    const targetVersion = DB_VERSION;

    logInfo('TrustDb', { from: currentVersion, to: targetVersion }, 'Starting database migration');

    try {
      // バージョン比較とマイグレーションパスの実行
      if (this.compareVersions(currentVersion, targetVersion) < 0) {
        await this.applyMigrations(currentVersion, targetVersion, db);

        // マイグレーション後のデータを保存（バージョン更新前に保存）
        await this.deps.save();

        // バージョンを更新（保存成功後にのみ更新）
        db.version = targetVersion;
        db.lastUpdated = new Date().toISOString();

        // バージョン更新を保存
        await this.deps.save();

        logInfo('TrustDb', { to: targetVersion }, 'Database migration completed');
      }
    } catch (error) {
      logError('TrustDb', { from: currentVersion, to: targetVersion, error }, ErrorCode.TRUST_DB_MIGRATION_FAILED);
      throw error;
    }
  }

  /**
   * マイグレーションパスの適用
   * @param from 以前のバージョン
   * @param to ターゲットバージョン
   * @param db データベース
   */
  async applyMigrations(from: string, to: string, db: TrustDatabase): Promise<void> {
    // 将来的なマイグレーションパスはここに追加
    // 例: v1.0.0 -> v1.1.0、v1.1.0 -> v1.2.0 など

    // 現在はマイグレーションパスが定義されていないため、
    // 新規スキーマに合うようにデフォルト値を設定するのみ
    logDebug('TrustDb', { from, to }, 'Applying migration defaults');

    // デフォルト値の設定（既存データに欠けているフィールドがあれば追加）
    if (!db.tranco) {
      db.tranco = { tier: 'top10k', domains: [], count: 0, sizeBytes: 0 };
    }
    if (!db.jpAnchor) {
      db.jpAnchor = { tlds: [...JP_ANCHOR_TLDS_PRESET], userTlds: [] };
    }
    if (!db.sensitive) {
      db.sensitive = {
        presets: {
          finance: [...SENSITIVE_DOMAINS_PRESETS.finance],
          gaming: [...SENSITIVE_DOMAINS_PRESETS.gaming],
          sns: [...SENSITIVE_DOMAINS_PRESETS.sns]
        },
        userBlacklist: [],
        whitelist: []
      };
    }
  }
}
