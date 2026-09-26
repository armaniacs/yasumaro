/**
 * trustChecker.ts
 * Trust Checker - TrustチェックとAlert Settings管理（Phase 2）
 * 記録フローでのドメイン信頼度判定と警告判定
 */

import type { TrustResult } from './trustDb/trustDbSchema.js';
import { StorageKeys } from './storage/types.js';
import { logDebug, logWarn } from './logger/api.js';
import { errorMessage } from './errorUtils.js';
import { pickDefined } from './objectUtils.js';
import { lookup, decideAlert } from './trustDb/TrustLookup.js';
import type { AlertFlags } from './trustDb/TrustLookup.js';

// ============================================================================
// Alert Settings
// ============================================================================

export type AlertTier = 'finance' | 'sensitive' | 'unverified';

/**
 * Alert Settings 設定
 */
export interface AlertConfig {
  alertFinance: boolean;      // 金融サイト警告
  alertSensitive: boolean;    // 警戒リスト警告
  alertUnverified: boolean;   // 未検証サイト警告
  saveAbortedPages: boolean;  // 警告で中断したページを履歴に残す
}

/**
 * デフォルト Alert Settings
 */
export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  alertFinance: true,
  alertSensitive: true,
  alertUnverified: false,
  saveAbortedPages: false
};

/**
 * Trustチェック結果判定
 */
export interface TrustCheckResult {
  canProceed: boolean;        // 記録を続行して良いか
  trustResult: TrustResult;  // Trust判定結果
  showAlert: boolean;        // 警告を表示すべきか
  reason?: string;           // 中了理由
}

/**
 * TrustChecker クラス
 */
export class TrustChecker {
  private alertConfig: AlertConfig = DEFAULT_ALERT_CONFIG;
  private alertConfigInitialized = false;
  private initializationPromise: Promise<void> | null = null;

  constructor() {
    // 初期化時にAlert Settingsを読み込む
    this.initializationPromise = this.loadAlertSettings();
  }

  /**
   * Alert Settingsを読み込む
   */
  async loadAlertSettings(): Promise<void> {
    try {
      const settings = await chrome.storage.local.get({
        [StorageKeys.ALERT_FINANCE]: DEFAULT_ALERT_CONFIG.alertFinance,
        [StorageKeys.ALERT_SENSITIVE]: DEFAULT_ALERT_CONFIG.alertSensitive,
        [StorageKeys.ALERT_UNVERIFIED]: DEFAULT_ALERT_CONFIG.alertUnverified,
        [StorageKeys.SAVE_ABORTED_PAGES]: DEFAULT_ALERT_CONFIG.saveAbortedPages
      });

      this.alertConfig = {
        alertFinance: (settings[StorageKeys.ALERT_FINANCE] as boolean) ?? DEFAULT_ALERT_CONFIG.alertFinance,
        alertSensitive: (settings[StorageKeys.ALERT_SENSITIVE] as boolean) ?? DEFAULT_ALERT_CONFIG.alertSensitive,
        alertUnverified: (settings[StorageKeys.ALERT_UNVERIFIED] as boolean) ?? DEFAULT_ALERT_CONFIG.alertUnverified,
        saveAbortedPages: (settings[StorageKeys.SAVE_ABORTED_PAGES] as boolean) ?? DEFAULT_ALERT_CONFIG.saveAbortedPages
      };

      this.alertConfigInitialized = true;
      await logDebug('TrustChecker', { alertConfig: this.alertConfig }, 'Alert settings loaded');
    } catch (error) {
      await logWarn('TrustChecker', { error: errorMessage(error) }, undefined, 'Failed to load alert settings');
      // エラーの場合も初期化済みフラグを立てて、デフォルト値を使用する
      this.alertConfigInitialized = true;
    }
  }

  /**
   * 初期化が完了するまで待機
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initializationPromise) {
      await this.initializationPromise;
    }
  }

  /**
   * Alert Settingsを保存
   */
  async saveAlertSettings(config: Partial<AlertConfig>): Promise<void> {
    const updates: Record<string, unknown> = {};

    if (config.alertFinance !== undefined) {
      this.alertConfig.alertFinance = config.alertFinance;
      updates[StorageKeys.ALERT_FINANCE] = config.alertFinance;
    }
    if (config.alertSensitive !== undefined) {
      this.alertConfig.alertSensitive = config.alertSensitive;
      updates[StorageKeys.ALERT_SENSITIVE] = config.alertSensitive;
    }
    if (config.alertUnverified !== undefined) {
      this.alertConfig.alertUnverified = config.alertUnverified;
      updates[StorageKeys.ALERT_UNVERIFIED] = config.alertUnverified;
    }
    if (config.saveAbortedPages !== undefined) {
      this.alertConfig.saveAbortedPages = config.saveAbortedPages;
      updates[StorageKeys.SAVE_ABORTED_PAGES] = config.saveAbortedPages;
    }

    if (Object.keys(updates).length > 0) {
      await chrome.storage.local.set(updates);
      logDebug('TrustChecker', { updates }, 'Alert settings saved');
    }
  }

  /**
   * 現在のAlert Settingsを取得
   */
  async getAlertConfig(): Promise<AlertConfig> {
    await this.ensureInitialized();
    return { ...this.alertConfig };
  }

  /**
   * ドメインのTrustチェックを実行（TrustLookup.lookup + decideAlert への adapter）
   */
  async checkDomain(url: string): Promise<TrustCheckResult> {
    await this.ensureInitialized();

    // Single-seam adapter: lookup() owns the TrustDecision + fallback resolution,
    // decideAlert() owns the alert/block matrix. Both display and check paths share it.
    const found = await lookup(url);
    const flags: AlertFlags = {
      alertFinance: this.alertConfig.alertFinance,
      alertSensitive: this.alertConfig.alertSensitive,
      alertUnverified: this.alertConfig.alertUnverified,
    };
    const decision = decideAlert(found, flags);

    return {
      canProceed: decision.canProceed,
      trustResult: found.trustResult,
      showAlert: decision.showAlert,
      ...pickDefined({ reason: decision.reason })
    };
  }

  /**
   * ドメインのTrustレベルを文字列で取得（UI用、TrustLookup.lookup への adapter）
   */
  async getTrustLevelDisplay(url: string): Promise<{
    level: string;
    color: string;
    icon: string;
  }> {
    const found = await lookup(url);
    return {
      level: found.display.label,
      color: found.display.color,
      icon: found.display.icon
    };
  }

  /**
   * 保存された中断ページを履歴に残すか
   */
  async shouldSaveAbortedPages(): Promise<boolean> {
    await this.ensureInitialized();
    return this.alertConfig.saveAbortedPages;
  }
}

// ============================================================================
// シングルトンインスタンス
// ============================================================================

let trustCheckerInstance: TrustChecker | null = null;

export function getTrustChecker(): TrustChecker {
  if (!trustCheckerInstance) {
    trustCheckerInstance = new TrustChecker();
  }
  return trustCheckerInstance;
}

/**
 * 簡便関数: ドメインのTrustチェック
 */
export async function checkDomainTrust(url: string): Promise<TrustCheckResult> {
  const checker = getTrustChecker();
  return await checker.checkDomain(url);
}

/**
 * 簡便関数: ドメインのTrustレベル表示用文字列を取得
 */
export async function getTrustLevelDisplay(url: string): Promise<{
  level: string;
  color: string;
  icon: string;
}> {
  const checker = getTrustChecker();
  return await checker.getTrustLevelDisplay(url);
}