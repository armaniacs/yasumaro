/**
 * trancoChangeDetector.ts
 * Tranco リスト更新時の変更検出ロジック（Phase 2）
 *
 * 機能:
 * - 旧Trancoリストと新Trancoリストを比較
 * - 除外された信頼ドメインを特定（ただし訪問中のドメインのみ対象）
 * - 通知メッセージ生成（日英双语）
 */

import { logDebug, logInfo, logWarn, logError, ErrorCode } from '../logger.js';

/** 変更検知結果 */
export interface TrancoChangeResult {
  /** 変更があるかどうか */
  hasChanges: boolean;
  /** 除外された信頼ドメイン（訪問中のみ） */
  excludedTrustedDomains: string[];
  /** 新しく信頼ドメインに追加されたドメイン */
  addedTrustedDomains: string[];
  /** 変更の概要（日英双语） */
  summary: {
    ja: string;
    en: string;
  };
}

/** 通知メッセージ（日英双语） */
export interface TrancoNotificationMessage {
  /** タイトル */
  title: {
    ja: string;
    en: string;
  };
  /** 本文 */
  message: {
    ja: string;
    en: string;
  };
  /** 除外ドメインリスト */
  excludedDomains: string[];
  /** 変更タイムスタンプ */
  timestamp: number;
}

/** Tranco リスト比較 */
export interface TrancoListComparison {
  /** 旧リスト */
  oldList: Set<string>;
  /** 新リスト */
  newList: Set<string>;
  /** 除外されたドメイン */
  excludedDomains: string[];
  /** 追加されたドメイン */
  addedDomains: string[];
}

/**
 * 訪問ドメインセット（SavedUrlEntries から構築）
 */
export interface VisitedTrancoDomains {
  /** 訪問した Tranco ドメインのセット */
  domains: Set<string>;
  /** 最終更新タイムスタンプ */
  timestamp: number;
}

/**
 * Tranco リスト更新を検知し、変更を分析
 */
export class TrancoChangeDetector {
  private static readonly NOTIFICATION_COOLDOWN_DAYS = 7;
  private static readonly STORAGE_KEY_LAST_NOTIFICATION = 'tranco_last_notification';

  /**
   * 2つの Tranco リストを比較
   */
  static compareTrancoLists(oldList: string[], newList: string[]): TrancoListComparison {
    const oldSet = new Set(oldList);
    const newSet = new Set(newList);

    return {
      oldList: oldSet,
      newList: newSet,
      // 旧リストにあり、新リストにないドメイン（除外された）
      excludedDomains: oldList.filter(domain => !newSet.has(domain)),
      // 新リストにあり、旧リストにないドメイン（追加された）
      addedDomains: newList.filter(domain => !oldSet.has(domain))
    };
  }

  /**
   * 変更を分析し、通知が必要か判断
   * @param comparison Tranco リスト比較結果
   * @param visitedDomains 訪問した Tranco ドメイン
   */
  static async analyzeChanges(
    comparison: TrancoListComparison,
    visitedDomains: VisitedTrancoDomains
  ): Promise<TrancoChangeResult> {
    // 除外されたドメインのうち、訪問済みのものを対象にする
    const excludedTrustedDomains = comparison.excludedDomains.filter(domain =>
      visitedDomains.domains.has(domain)
    );

    const hasChanges = excludedTrustedDomains.length > 0;

    // 日英双语のサマリーを生成
    const summary = this.generateSummary(excludedTrustedDomains, comparison.addedDomains.length);

    logDebug('TrancoChangeDetector', {
      excludedTrustedDomains,
      excludedCount: comparison.excludedDomains.length,
      hadChanges: hasChanges
    }, 'Tranco changes analyzed');

    return {
      hasChanges,
      excludedTrustedDomains,
      addedTrustedDomains: comparison.addedDomains,
      summary
    };
  }

  /**
   * 日英双语のサマリーを生成
   */
  private static generateSummary(
    excludedDomains: string[],
    addedCount: number
  ): { ja: string; en: string } {
    const excluded = excludedDomains.length;
    const added = addedCount;

    if (excluded === 0 && added === 0) {
      return {
        ja: 'Tranco信頼ドメインリストの変更はありません。',
        en: 'No changes to Tranco trusted domains.'
      };
    }

    if (excluded > 0 && added === 0) {
      return {
        ja: `Tranco信頼ドメインから${excluded}個のドメインが除外されました。`,
        en: `${excluded} domains were removed from Tranco trusted domains.`
      };
    }

    if (excluded === 0 && added > 0) {
      return {
        ja: `Tranco信頼ドメインに${added}個のドメインが追加されました。`,
        en: `${added} domains were added to Tranco trusted domains.`
      };
    }

    return {
      ja: `Tranco信頼ドメインから${excluded}個が除外され、${added}個が追加されました。`,
      en: `${excluded} domains were removed and ${added} were added to Tranco trusted domains.`
    };
  }

  /**
   * 通知メッセージを生成
   */
  static generateNotificationMessage(changeResult: TrancoChangeResult): TrancoNotificationMessage {
    const { excludedTrustedDomains, addedTrustedDomains } = changeResult;

    const title = {
      ja: 'Tranco信頼ドメインリストの更新',
      en: 'Tranco Trusted Domains Update'
    };

    // 詳細メッセージ
    let messageJa = 'Tranco Top 1000 リストが更新されました。';
    let messageEn = 'The Tranco Top 1000 list has been updated.';

    if (excludedTrustedDomains.length > 0) {
      const excludedList = excludedTrustedDomains.slice(0, 5).join(', ');
      const remainingJa = excludedTrustedDomains.length > 5 ? `他${excludedTrustedDomains.length - 5}件` : '';
      const remainingEn = excludedTrustedDomains.length > 5 ? ` and ${excludedTrustedDomains.length - 5} more` : '';

      messageJa += `\n\n以下のドメインが信頼リストから除外されました: ${excludedList}${remainingJa}`;
      messageEn += `\n\nThe following domains were removed from the trusted list: ${excludedList}${remainingEn}`;
    }

    if (addedTrustedDomains.length > 0) {
      const addedList = addedTrustedDomains.slice(0, 5).join(', ');
      const remaining = addedTrustedDomains.length > 5 ? `, and ${addedTrustedDomains.length - 5} more` : '';

      messageJa += `\n\n以下のドメインが信頼リストに追加されました: ${addedList}${remaining}`;
      messageEn += `\n\nThe following domains were added to the trusted list: ${addedList}${remaining ? remaining : ''}`;
    }

    return {
      title,
      message: {
        ja: messageJa,
        en: messageEn
      },
      excludedDomains: excludedTrustedDomains,
      timestamp: Date.now()
    };
  }

  /**
   * 通知を表示すべきか判定（7日抑制ルール）
   */
  static async shouldShowNotification(version: string): Promise<boolean> {
    const result = await chrome.storage.local.get(this.STORAGE_KEY_LAST_NOTIFICATION);
    const lastNotification = result[this.STORAGE_KEY_LAST_NOTIFICATION] as string | null;

    if (!lastNotification) {
      return true; // 初回は表示
    }

    // 同一バージョンの通知はスキップ
    if (lastNotification === version) {
      return false;
    }

    // 7日経過しているかチェック
    const lastTime = parseInt(lastNotification, 10);
    const elapsedDays = (Date.now() - lastTime) / (1000 * 60 * 60 * 24);

    return elapsedDays >= this.NOTIFICATION_COOLDOWN_DAYS;
  }

  /**
   * 通知を表示したことを記録
   */
  static async recordNotificationShown(version: string): Promise<void> {
    await chrome.storage.local.set({
      [this.STORAGE_KEY_LAST_NOTIFICATION]: Date.now().toString()
    });

    logInfo('TrancoChangeDetector', { version }, 'Tranco notification recorded');
  }

  /**
   * SavedUrlEntries から訪問した Tranco ドメインを構築
   * @param savedUrls SavedUrlEntry のリスト
   * @param trancoSet 現在の Tranco ドメインセット
   */
  static buildVisitedTrancoDomains(
    savedUrls: Array<{ url: string; isTrancoDomain: boolean }>,
    trancoSet: Set<string>
  ): VisitedTrancoDomains {
    const domains = new Set<string>();

    for (const entry of savedUrls) {
      // 既に isTrancoDomain フラグがある場合
      if (entry.isTrancoDomain) {
        // URL からドメインを抽出
        let domain = entry.url.toLowerCase().trim();
        if (domain.startsWith('http://') || domain.startsWith('https://')) {
          try {
            domain = new URL(domain).hostname;
          } catch {
            continue;
          }
        }
        domains.add(domain);
      }
    }

    return {
      domains,
      timestamp: Date.now()
    };
  }
}