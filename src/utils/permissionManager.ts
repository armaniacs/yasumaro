/**
 * permissionManager.ts
 * Permission Manager - chrome.permissions API ラッパー + 拒否訪問カウント管理（P0）
 * host_permissionsチェックとoptional_permissions要求、拒否ドメイン管理
 */

import { StorageKeys } from './storage.js';
import { logDebug, logWarn } from './logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * 拒否ドメインの通常表示情報（Dashboard用）
 */
export interface DeniedDomainEntry {
  domain: string;
  count: number;
}

/**
 * 拒否ドメインの内部データ構造（chrome.storage.localに保存）
 */
export interface DeniedDomainData {
  count: number;           // 拒否回数
  lastDenied: string;      // 最後の拒否日時（ISO 8601形式）
  lastDismissed?: string;  // 最後の無視日時（ISO 8601形式、Dashboardで「×」を押した時）
}

// ============================================================================
// PermissionManager クラス
// ============================================================================

export class PermissionManager {
  /**
   * ドメインが現在の host_permissions に含まれるか確認
   * @param url - チェック対象のURL
   * @returns 許可されているかどうか
   */
  async isHostPermitted(url: string): Promise<boolean> {
    try {
      const origin = this.urlToOrigin(url);
      return await chrome.permissions.contains({ origins: [origin] });
    } catch (error) {
      logWarn('PermissionManager', { error: error instanceof Error ? error.message : String(error), url }, undefined, 'Failed to check host permission');
      return false;
    }
  }

  /**
   * optional_permissions ダイアログを表示
   * @param url - 許可を求めるURL
   * @returns 許可された: true / 拒否された: false
   */
  async requestPermission(url: string): Promise<boolean> {
    try {
      const origin = this.urlToOrigin(url);
      return await chrome.permissions.request({ origins: [origin] });
    } catch (error) {
      logWarn('PermissionManager', { error: error instanceof Error ? error.message : String(error), url }, undefined, 'Failed to request permission');
      return false;
    }
  }

  /**
   * 拒否されたドメインの訪問回数をインクリメント
   * @param domain - 拒否されたドメイン（ホスト名のみ、例: 'example.com'）
   */
  async recordDeniedVisit(domain: string): Promise<void> {
    try {
      const data = await chrome.storage.local.get({ [StorageKeys.DENIED_DOMAINS]: {} });
      const deniedDomains: Record<string, DeniedDomainData> = data[StorageKeys.DENIED_DOMAINS] as Record<string, DeniedDomainData> || {} as Record<string, DeniedDomainData>;

      const nowISO = new Date().toISOString();

      if (!deniedDomains[domain]) {
        // 初回拒否
        deniedDomains[domain] = {
          count: 1,
          lastDenied: nowISO,
          lastDismissed: undefined
        };
      } else {
        // 既存エントリー: カウントインクリメントと最後の拒否日時更新
        deniedDomains[domain].count++;
        deniedDomains[domain].lastDenied = nowISO;
      }

      await chrome.storage.local.set({ [StorageKeys.DENIED_DOMAINS]: deniedDomains });
      logDebug('PermissionManager', { domain, count: deniedDomains[domain].count }, `Recorded denied visit for ${domain}`);
    } catch (error) {
      logWarn('PermissionManager', { error: error instanceof Error ? error.message : String(error), domain }, undefined, 'Failed to record denied visit');
    }
  }

  /**
   * Dashboardで「×」を押した時の無視を記録
   * lastDismissedを更新し、14日間再表示抑制を有効にする
   * @param domain - 無視したドメイン（ホスト名のみ）
   */
  async recordDomainDismissal(domain: string): Promise<void> {
    try {
      const data = await chrome.storage.local.get({ [StorageKeys.DENIED_DOMAINS]: {} });
      const deniedDomains: Record<string, DeniedDomainData> = data[StorageKeys.DENIED_DOMAINS] as Record<string, DeniedDomainData> || {} as Record<string, DeniedDomainData>;

      if (deniedDomains[domain]) {
        const nowISO = new Date().toISOString();
        deniedDomains[domain].lastDismissed = nowISO;
        await chrome.storage.local.set({ [StorageKeys.DENIED_DOMAINS]: deniedDomains });
        logDebug('PermissionManager', { domain }, `Recorded dismissal for ${domain}`);
      }
    } catch (error) {
      logWarn('PermissionManager', { error: error instanceof Error ? error.message : String(error), domain }, undefined, 'Failed to record domain dismissal');
    }
  }

  /**
   * 90日経過したdenied_domainsエントリーを自動削除
   * @param days - 保存日数（デフォルト: 90日）
   */
  async cleanupOldDeniedEntries(days: number = 90): Promise<void> {
    try {
      const data = await chrome.storage.local.get({ [StorageKeys.DENIED_DOMAINS]: {} });
      const deniedDomains: Record<string, DeniedDomainData> = data[StorageKeys.DENIED_DOMAINS] as Record<string, DeniedDomainData> || {} as Record<string, DeniedDomainData>;

      const threshold = Date.now() - (days * 24 * 60 * 60 * 1000);
      const cleaned: Record<string, DeniedDomainData> = {};

      let removedCount = 0;
      for (const [domain, entry] of Object.entries(deniedDomains)) {
        const lastDeniedTime = new Date(entry.lastDenied).getTime();
        if (lastDeniedTime > threshold) {
          cleaned[domain] = entry;
        } else {
          removedCount++;
        }
      }

      if (removedCount > 0) {
        await chrome.storage.local.set({ [StorageKeys.DENIED_DOMAINS]: cleaned });
        logDebug('PermissionManager', { removedCount, totalRemoved: removedCount }, `Cleaned up ${removedCount} old denied domain entries`);
      }
    } catch (error) {
      logWarn('PermissionManager', { error: error instanceof Error ? error.message : String(error), days }, undefined, 'Failed to cleanup old denied entries');
    }
  }

  /**
   * 閾値を超えた拒否ドメインを訪問数の降順で返す
   * threshold が未指定なら StorageKeys.PERMISSION_NOTIFY_THRESHOLD の値を使う
   * また、lastDismissedから14日経過していないドメインは除外する
   * @param threshold - 訪問回数の閾値（オプション）
   * @param dismissalDays - 再表示抑制日数（デフォルト: 14日）
   * @returns 閾値を超える拒否ドメインリスト
   */
   async getFrequentDeniedDomains(
     threshold?: number,
     dismissalDays: number = 14
   ): Promise<DeniedDomainEntry[]> {
     try {
       const data = await chrome.storage.local.get({
         [StorageKeys.DENIED_DOMAINS]: {},
         [StorageKeys.PERMISSION_NOTIFY_THRESHOLD]: 3
       });
       const deniedDomains: Record<string, DeniedDomainData> = data[StorageKeys.DENIED_DOMAINS] as Record<string, DeniedDomainData> || {} as Record<string, DeniedDomainData>;
       // Validate threshold is within expected range (1-50)
       const notifyThreshold = Math.max(1, Math.min(50, threshold ?? (data[StorageKeys.PERMISSION_NOTIFY_THRESHOLD] as number)));

       const dismissalThreshold = Date.now() - (dismissalDays * 24 * 60 * 60 * 1000);
       const entries: DeniedDomainEntry[] = [];

       for (const [domain, entry] of Object.entries(deniedDomains)) {
         // 閾値を超えたドメインのみ（count > threshold）
         if (entry.count <= notifyThreshold) {
           continue;
         }

         // 14日再表示抑制チェック
         if (entry.lastDismissed) {
           const dismissalTime = new Date(entry.lastDismissed).getTime();
           if (dismissalTime > dismissalThreshold) {
             continue; // 14日経過していない → 除外
           }
         }

         entries.push({ domain, count: entry.count });
       }

       // 訪問数の降順でソート
       entries.sort((a, b) => b.count - a.count);
       return entries;
     } catch (error) {
       logWarn('PermissionManager', { error: error instanceof Error ? error.message : String(error) }, undefined, 'Failed to get frequent denied domains');
       return [];
     }
   }

  /**
   * 許可されたドメインをdenied_domainsから削除
   * @param domain - 許可されたドメイン（ホスト名のみ）
   */
  async removeDeniedDomain(domain: string): Promise<void> {
    try {
      const data = await chrome.storage.local.get({ [StorageKeys.DENIED_DOMAINS]: {} });
      const deniedDomains: Record<string, DeniedDomainData> = data[StorageKeys.DENIED_DOMAINS] as Record<string, DeniedDomainData> || {} as Record<string, DeniedDomainData>;

      if (deniedDomains[domain]) {
        delete deniedDomains[domain];
        await chrome.storage.local.set({ [StorageKeys.DENIED_DOMAINS]: deniedDomains });
        logDebug('PermissionManager', { domain }, `Removed denied domain entry for ${domain}`);
      }
    } catch (error) {
      logWarn('PermissionManager', { error: error instanceof Error ? error.message : String(error), domain }, undefined, 'Failed to remove denied domain');
    }
  }

   /**
    * URL からオリジン形式に変換するユーティリティ
    * "https://example.com/path" → "*://example.com/*"
    * @param url - 変換対象のURL
    * @returns オリジン形式（chrome.permissions API用）
    */
  /**
   * <all_urls> が optional_host_permissions として付与されているか確認
   */
  async isAllUrlsPermitted(): Promise<boolean> {
    try {
      return await chrome.permissions.contains({ origins: ['<all_urls>'] });
    } catch (error) {
      logWarn('PermissionManager', { error: error instanceof Error ? error.message : String(error) }, undefined, 'Failed to check <all_urls> permission');
      return false;
    }
  }

  /**
   * <all_urls> の一括許可をユーザーに要求する
   * ※ ユーザージェスチャー（クリックイベント）内から呼ぶこと
   */
  async requestAllUrls(): Promise<boolean> {
    try {
      return await chrome.permissions.request({ origins: ['<all_urls>'] });
    } catch (error) {
      logWarn('PermissionManager', { error: error instanceof Error ? error.message : String(error) }, undefined, 'Failed to request <all_urls> permission');
      return false;
    }
  }

   private urlToOrigin(url: string): string {
     try {
       const urlObj = new URL(url);
       return `*://${urlObj.hostname}/*`;
     } catch {
       // URLパース失敗は安全側に倒して無効なオリジンを返す
       return "*://invalid/*";
     }
   }
}

// ============================================================================
// シングルトンインスタンス
// ============================================================================

let permissionManagerInstance: PermissionManager | null = null;

export function getPermissionManager(): PermissionManager {
  if (!permissionManagerInstance) {
    permissionManagerInstance = new PermissionManager();
  }
  return permissionManagerInstance;
}
// ============================================================================
// モジュールレベル便利関数（動的 import 用）
// ============================================================================

export const isHostPermitted = (url: string) => getPermissionManager().isHostPermitted(url);
export const requestPermission = (url: string) => getPermissionManager().requestPermission(url);
export const recordDeniedVisit = (domain: string) => getPermissionManager().recordDeniedVisit(domain);
export const recordDomainDismissal = (domain: string) => getPermissionManager().recordDomainDismissal(domain);
export const cleanupOldDeniedEntries = (days?: number) => getPermissionManager().cleanupOldDeniedEntries(days);
export const getFrequentDeniedDomains = (threshold?: number, dismissalDays?: number) =>
  getPermissionManager().getFrequentDeniedDomains(threshold, dismissalDays);
export const isAllUrlsPermitted = () => getPermissionManager().isAllUrlsPermitted();
export const requestAllUrls = () => getPermissionManager().requestAllUrls();
export const removeDeniedDomain = (domain: string) => getPermissionManager().removeDeniedDomain(domain);
