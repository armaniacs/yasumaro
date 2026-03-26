/**
 * trancoConsentManager.ts
 * Tranco リスト更新同意管理（Phase 3）
 *
 * 機能:
 * - 同意状態の管理
 * - 30日間隔の再確認ルール
 * - 旧Trancoリストの保持
 */

import { logDebug, logInfo, logWarn, logError, ErrorCode } from '../logger.js';
import { StorageKeys } from '../storage.js';

/** 同意結果 */
export enum ConsentResult {
  /** 同意した */
  GRANTED = 'GRANTED',
  /** 拒否した */
  DENIED = 'DENIED',
  /** 待機中（まだ応答していない） */
  PENDING = 'PENDING',
  /** 既に同じバージョンで同意済み */
  ALREADY_GRANTED = 'ALREADY_GRANTED',
  /** 拒否後、30日経過して再確認が必要 */
  RETRY_NEEDED = 'RETRY_NEEDED'
}

/** 同意設定 */
export interface ConsentConfig {
  /** 通知対象の除外ドメイン */
  excludedDomains: string[];
  /** 現在の Tranco バージョン */
  currentVersion: string;
  /** 旧 Tranco バージョン */
  oldVersion: string | null;
}

/**
 * Tranco リスト更新同意管理クラス
 */
export class TrancoConsentManager {
  private static readonly RETRY_INTERVAL_DAYS = 30;
  private static readonly STORAGE_KEY_CONSENT_GRANTED = StorageKeys.TRANCO_CONSENT_GRANTED;
  private static readonly STORAGE_KEY_CONSENT_DENIED_REASON = StorageKeys.TRANCO_CONSENT_DENIED_REASON;
  private static readonly STORAGE_KEY_CONSENT_DENIED_TIMESTAMP = StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP;
  private static readonly STORAGE_KEY_TRANCO_DOMAINS = StorageKeys.TRANCO_DOMAINS;

  /**
   * 現在、同意が必要か判定
   */
  static async needsConsent(version: string): Promise<ConsentResult> {
    // 既に同意されているバージョンを取得
    const result = await chrome.storage.local.get([
      this.STORAGE_KEY_CONSENT_GRANTED,
      this.STORAGE_KEY_CONSENT_DENIED_TIMESTAMP
    ]);

    const grantedVersion = result[this.STORAGE_KEY_CONSENT_GRANTED] as string | null;
    const deniedTimestamp = result[this.STORAGE_KEY_CONSENT_DENIED_TIMESTAMP] as number | null;

    // 既に同じバージョンで同意済み
    if (grantedVersion === version) {
      return ConsentResult.ALREADY_GRANTED;
    }

    // 拒否中の場合、30日経過をチェック
    if (deniedTimestamp) {
      const elapsedDays = (Date.now() - deniedTimestamp) / (1000 * 60 * 60 * 24);
      if (elapsedDays < this.RETRY_INTERVAL_DAYS) {
        // まだ30日経過していない
        return ConsentResult.DENIED;
      }
      // 30日経過したので再確認が必要
      return ConsentResult.RETRY_NEEDED;
    }

    // 初回の同意が必要
    return ConsentResult.PENDING;
  }

  /**
   * 同意を記録
   */
  static async recordConsent(version: string, reason?: string): Promise<void> {
    if (reason === 'deny' || reason === 'retry_later') {
      // 拒否を記録
      await chrome.storage.local.set({
        [this.STORAGE_KEY_CONSENT_GRANTED]: null,
        [this.STORAGE_KEY_CONSENT_DENIED_REASON]: reason,
        [this.STORAGE_KEY_CONSENT_DENIED_TIMESTAMP]: Date.now()
      });

      logInfo('TrancoConsentManager', { version, reason }, 'Tranco consent denied');
    } else {
      // 同意を記録
      await chrome.storage.local.set({
        [this.STORAGE_KEY_CONSENT_GRANTED]: version,
        [this.STORAGE_KEY_CONSENT_DENIED_REASON]: null,
        [this.STORAGE_KEY_CONSENT_DENIED_TIMESTAMP]: null
      });

      logInfo('TrancoConsentManager', { version }, 'Tranco consent granted');
    }
  }

  /**
   * 旧 Tranco ドメインリストを保存（バックアップ用）
   */
  static async saveOldTrancoDomains(domains: string[]): Promise<void> {
    await chrome.storage.local.set({
      [this.STORAGE_KEY_TRANCO_DOMAINS]: domains
    });

    logInfo('TrancoConsentManager', { domainCount: domains.length }, 'Old Tranco domains saved');
  }

  /**
   * 保存された旧 Tranco ドメインリストを取得
   */
  static async getOldTrancoDomains(): Promise<string[]> {
    const result = await chrome.storage.local.get(this.STORAGE_KEY_TRANCO_DOMAINS);
    return result[this.STORAGE_KEY_TRANCO_DOMAINS] as string[] || [];
  }

  /**
   * 保存されている旧 Tranco ドメインリストを削除
   */
  static async clearOldTrancoDomains(): Promise<void> {
    await chrome.storage.local.remove([this.STORAGE_KEY_TRANCO_DOMAINS]);

    logInfo('TrancoConsentManager', {}, 'Old Tranco domains cleared');
  }

  /**
   * 拒否理由を取得
   */
  static async getDeniedReason(): Promise<string | null> {
    const result = await chrome.storage.local.get(this.STORAGE_KEY_CONSENT_DENIED_REASON);
    return result[this.STORAGE_KEY_CONSENT_DENIED_REASON] as string | null;
  }

  /**
   * 30日経過までの残り日数を取得
   */
  static async getRetryDaysRemaining(): Promise<number | null> {
    const result = await chrome.storage.local.get(this.STORAGE_KEY_CONSENT_DENIED_TIMESTAMP);
    const deniedTimestamp = result[this.STORAGE_KEY_CONSENT_DENIED_TIMESTAMP] as number | null;

    if (!deniedTimestamp) {
      return null;
    }

    const elapsedDays = (Date.now() - deniedTimestamp) / (1000 * 60 * 60 * 24);
    const remainingDays = Math.max(0, this.RETRY_INTERVAL_DAYS - elapsedDays);

    return Math.ceil(remainingDays);
  }

  /**
   * 同意状態をクリア（リセット用）
   */
  static async resetConsent(): Promise<void> {
    await chrome.storage.local.remove([
      this.STORAGE_KEY_CONSENT_GRANTED,
      this.STORAGE_KEY_CONSENT_DENIED_REASON,
      this.STORAGE_KEY_CONSENT_DENIED_TIMESTAMP
    ]);

    logInfo('TrancoConsentManager', {}, 'Tranco consent reset');
  }

  /**
   * すべての Tranco 関連設定をクリア（完全リセット用）
   */
  static async resetAll(): Promise<void> {
    await chrome.storage.local.remove([
      this.STORAGE_KEY_CONSENT_GRANTED,
      this.STORAGE_KEY_CONSENT_DENIED_REASON,
      this.STORAGE_KEY_CONSENT_DENIED_TIMESTAMP,
      this.STORAGE_KEY_TRANCO_DOMAINS
    ]);

    logInfo('TrancoConsentManager', {}, 'All Tranco settings reset');
  }

  /**
   * 現在の同意状態を取得
   */
  static async getCurrentState(version: string): Promise<{
    grantedVersion: string | null;
    deniedReason: string | null;
    deniedTimestamp: number | null;
    retryDaysRemaining: number | null;
    needsConsent: ConsentResult;
  }> {
    const result = await chrome.storage.local.get([
      this.STORAGE_KEY_CONSENT_GRANTED,
      this.STORAGE_KEY_CONSENT_DENIED_REASON,
      this.STORAGE_KEY_CONSENT_DENIED_TIMESTAMP
    ]);

    const grantedVersion = result[this.STORAGE_KEY_CONSENT_GRANTED] as string | null;
    const deniedReason = result[this.STORAGE_KEY_CONSENT_DENIED_REASON] as string | null;
    const deniedTimestamp = result[this.STORAGE_KEY_CONSENT_DENIED_TIMESTAMP] as number | null;

    let retryDaysRemaining: number | null = null;
    if (deniedTimestamp) {
      retryDaysRemaining = await this.getRetryDaysRemaining();
    }

    return {
      grantedVersion,
      deniedReason,
      deniedTimestamp,
      retryDaysRemaining,
      needsConsent: await this.needsConsent(version)
    };
  }
}