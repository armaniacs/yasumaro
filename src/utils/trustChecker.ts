/**
 * trustChecker.ts
 * Trust Checker - TrustチェックとAlert Settings管理（Phase 2）
 * 記録フローでのドメイン信頼度判定と警告判定
 */

import type { TrustResult, AlertSettings, SafetyMode, TrancoTier } from './trustDb/trustDbSchema.js';
import { getTrustDb } from './trustDb/trustDb.js';
import { StorageKeys } from './storage.js';
import { logInfo, logDebug, logWarn } from './logger.js';

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
      logDebug('TrustChecker', { alertConfig: this.alertConfig }, 'Alert settings loaded');
    } catch (error) {
      logWarn('TrustChecker', { error: error instanceof Error ? error.message : String(error) }, undefined, 'Failed to load alert settings');
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
   * 現在のAlert Settingsを取得（同期的、初期化済みの場合のみ）
   * 注: 非推奨メソッド。使用箇所を確認し、async getAlertConfig() に移行することを推奨
   */
  getAlertConfigSync(): AlertConfig {
    if (!this.alertConfigInitialized) {
      logWarn('TrustChecker', {}, undefined, 'getAlertConfigSync called before initialization - using default values');
    }
    return { ...this.alertConfig };
  }

  /**
   * ドメインのTrustチェックを実行
   */
  async checkDomain(url: string): Promise<TrustCheckResult> {
    await this.ensureInitialized();

    const db = getTrustDb();
    await db.initialize();

    // Trust判定を実行
    const trustResult = await db.isDomainTrusted(url);

    // ★ 修正: trustResult が trustResult プロパティを持っているか確認
    // Trust Dbクラスの戻り値は TrustResult （level, source, reason, category を持つ）
    const trustResultRaw = trustResult; // as TrustResult

    // 警告を表示すべきか判定
    const showAlert = this.shouldShowAlert(trustResultRaw);

    // 記録を続行してよいか判定
    // ★ 注: 警告モーダル式の場合、showAlert=true の場合は「ユーザーの確認待ち」扱い
    // 今回の「バッジ表示のみ」仕様では、バッジでTrustレベルを表示するだけで、
    // 実際に記録を阻止するのは「saveAbortedPages」オプションに関わる動作
    const canProceed = !this.shouldBlockRecording(trustResultRaw, showAlert);

    return {
      canProceed,
      trustResult: trustResultRaw,
      showAlert,
      reason: !canProceed ? this.getBlockReason(trustResultRaw, showAlert) : undefined
    };
  }

  /**
   * 警告を表示すべきか判定
   */
  private shouldShowAlert(trustResult: TrustResult): boolean {
    const { level, category } = trustResult;

    // TRUSTED は警告なし
    if (level === 'trusted') {
      return false;
    }

    // SENSITIVE - カテゴリごとにAlert Settingsで判定
    if (level === 'sensitive' && category) {
      if (category === 'finance') {
        return this.alertConfig.alertFinance;
      }
      // gaming, sns など
      return this.alertConfig.alertSensitive;
    }

    // UNVERIFIED
    if (level === 'unverified') {
      return this.alertConfig.alertUnverified;
    }

    return false;
  }

  /**
   * 記録をブロックすべきか判定
   * 注: バッジ表示仕様ではブロックは行わないが、将来の機能拡張のため実装
   */
  private shouldBlockRecording(trustResult: TrustResult, showAlert: boolean): boolean {
    // 現在の仕様では、バッジ表示のみでブロックは行わない
    // 将来的に「厳格モード」等の実装のためにfalse固定
    return false;
  }

  /**
   * ブロック理由を取得
   */
  private getBlockReason(trustResult: TrustResult, showAlert: boolean): string {
    const { level, category } = trustResult;

    if (level === 'unverified') {
      return 'Unverified domain - recording blocked';
    }

    if (level === 'sensitive' && category === 'finance') {
      return 'Financial site - recording blocked';
    }

    if (level === 'sensitive') {
      return `Sensitive site (${category}) - recording blocked`;
    }

    return 'Trust check failed - recording blocked';
  }

  /**
   * ドメインのTrustレベルを文字列で取得（UI用）
   */
  async getTrustLevelDisplay(url: string): Promise<{
    level: string;
    color: string;
    icon: string;
  }> {
    const db = getTrustDb();
    await db.initialize();
    const result = await db.isDomainTrusted(url);

    const mapping: Record<string, { color: string; icon: string }> = {
      'trusted': { color: '#10b981', icon: '🟢' },      // Green - Trusted
      'sensitive': { color: '#f59e0b', icon: '🟡' },  // Amber - Sensitive
      'unverified': { color: '#94a3b8', icon: '⚪' },  // Gray - Unverified
      'locked': { color: '#6b7280', icon: '🔒' }       // Gray - Locked (P0)
    };

    const display = mapping[result.level] || mapping['unverified'];

    return {
      level: result.level.toUpperCase(),
      ...display
    };
  }

  /**
   * Safety Modeを取得
   */
  async getSafetyMode(): Promise<SafetyMode> {
    const settings = await chrome.storage.local.get({
      [StorageKeys.SAFETY_MODE]: 'balanced'
    });
    return settings[StorageKeys.SAFETY_MODE] as SafetyMode || 'balanced';
  }

  /**
   * Safety Modeを設定
   */
  async setSafetyMode(mode: SafetyMode): Promise<void> {
    await chrome.storage.local.set({ [StorageKeys.SAFETY_MODE]: mode });

    // Safety Mode に応じて Tranco Tier も同期
    const tierMap: Record<SafetyMode, TrancoTier> = {
      strict: 'top1k',
      balanced: 'top10k',
      relaxed: 'top100k'
    };

    const tier = tierMap[mode];
    if (tier) {
      await chrome.storage.local.set({ [StorageKeys.TRANCO_TIER]: tier });
    }

    logInfo('TrustChecker', { mode, tier }, `Safety mode set to ${mode} (Tranco tier: ${tier})`);
  }

  /**
   * Tranco Tierを取得
   */
  async getTrancoTier(): Promise<TrancoTier> {
    const settings = await chrome.storage.local.get({
      [StorageKeys.TRANCO_TIER]: 'top10k'
    });
    return settings[StorageKeys.TRANCO_TIER] as TrancoTier || 'top10k';
  }

  /**
   * 保存された中断ページを履歴に残すか
   */
  async shouldSaveAbortedPages(): Promise<boolean> {
    await this.ensureInitialized();
    return this.alertConfig.saveAbortedPages;
  }

  /**
   * 保存された中断ページを履歴に残すか（同期的、初期化済みの場合のみ）
   */
  shouldSaveAbortedPagesSync(): boolean {
    if (!this.alertConfigInitialized) {
      logWarn('TrustChecker', {}, undefined, 'shouldSaveAbortedPagesSync called before initialization - using default value');
    }
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