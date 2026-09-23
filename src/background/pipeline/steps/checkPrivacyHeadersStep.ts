/**
 * Privacy headers check step
 * Step 4: Check privacy headers and handle accordingly
 */

import { LogType } from '../../../utils/logger/types.js';
import { addLog } from '../../../utils/logger/core.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import { addPendingPage, buildPendingPage } from '../../../utils/pendingStorage.js';
import type { RecordingContext } from '../types.js';
import type { PrivacyInfo } from '../../../utils/privacyChecker.js';
import { pickDefined } from '../../../utils/objectUtils.js';
import { isDomainInList } from '../../../utils/wildcardToRegex.js';
import { decideGate, type PrivacyAutoBehavior } from '../../../utils/recordingGateTable.js';

export class PrivacyHeadersChecker {
  private getPrivacyInfoWithCache: (url: string) => Promise<PrivacyInfo | null>;

  constructor(getPrivacyInfoWithCache: (url: string) => Promise<PrivacyInfo | null>) {
    this.getPrivacyInfoWithCache = getPrivacyInfoWithCache;
  }

  /**
   * Check privacy headers and handle according to settings
   */
  async execute(context: RecordingContext): Promise<RecordingContext> {
    const { data, settings, force } = context;
    const { url, title, headerValue, requireConfirmation } = data;

    // Check whitelist first — same evaluation as the dashboard's domain
    // filter (wildcard patterns + DOMAIN_SUBDOMAIN_MATCHING). An exact
    // includes() here used to silently ignore *.example.com entries added
    // via the popup whitelist writer, which validates them as valid.
    // (The bypass log is emitted from the pre-decision branch below so the
    // force-first log order stays byte-equal: force logs only the force
    // message even when the domain also matches the whitelist.)
    const whitelist = settings[StorageKeys.DOMAIN_WHITELIST] || [];
    const matchSubdomains = settings[StorageKeys.DOMAIN_SUBDOMAIN_MATCHING] === true;
    let shouldSkipPrivacyCheck = false;
    let whitelistedDomain: string | null = null;

    if (whitelist.length > 0) {
      const domain = this.extractDomain(url);
      if (domain && isDomainInList(domain, whitelist, matchSubdomains)) {
        shouldSkipPrivacyCheck = true;
        whitelistedDomain = domain;
      }
    }

    // PBI 2026-09-21-28: bypass 判定を fetch 前の pre-decision に一本化する。
    // force と whitelisted は fetch 前に確定済みのため、表の privacyHeaders 行に
    // isPrivate: false（未確定のプレースホルダ）を渡して判定する。
    // settings の読み取りは副作用が無いため fetch 前倒ししても等価。
    const rawBehavior = settings[StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR] || 'save';
    const behavior: PrivacyAutoBehavior =
      rawBehavior === 'skip' || rawBehavior === 'confirm' ? rawBehavior : 'save';
    // PBI 2026-09-23-05: shared gate table row への adapter（pre-decision 構造は不変）。
    const preDecision = decideGate('privacyHeaders', {
      force,
      whitelisted: shouldSkipPrivacyCheck,
      isPrivate: false,
      autoSaveBehavior: behavior,
      requireConfirmation: requireConfirmation ?? false,
    });
    // 注意: 表の privacyHeaders 行は !isPrivate でも allow を返すが、fetch 前は
    // isPrivate が未確定のためその分岐だけでは fetch を省けない。fetch を
    // スキップするのは bypass（force/whitelisted）に裏打ちされた allow のみ。
    // ログ文言と return 形状は従来の二つの早期 return と byte 等価。
    if (preDecision.allow && (force || shouldSkipPrivacyCheck)) {
      if (force) {
        // force=true の場合はプライバシーチェックをスキップして記録を許可する
        // （「それでも記録」ボタンや手動記録操作など、ユーザーが明示的に記録を指示した場合）
        addLog(LogType.WARN, 'Force recording - bypassing privacy check', { url, traceId: context.traceId });
      } else {
        addLog(LogType.DEBUG, 'Whitelisted domain, bypassing privacy check', { url, domain: whitelistedDomain, traceId: context.traceId });
      }
      return context;
    }

    // Check privacy headers
    const privacyInfo = await this.getPrivacyInfoWithCache(url);

    // PBI 2026-09-19-08: verdict は recordingDecision.decidePrivacy に委譲。
    // PBI 2026-09-23-05: shared gate table row への adapter。
    // I/O（privacyInfo 取得・pending 保存・log）はこの step に残す。
    // fetch 後の呼び出しは isPrivate マトリクスのみを担う（deniedBy 不変）。
    const decision = decideGate('privacyHeaders', {
      force,
      whitelisted: shouldSkipPrivacyCheck,
      isPrivate: privacyInfo?.isPrivate ?? false,
      autoSaveBehavior: behavior,
      requireConfirmation: requireConfirmation ?? false,
    });

    if (decision.allow) {
      if (privacyInfo?.isPrivate) {
        addLog(LogType.INFO, 'Auto-saving private page (behavior=save)', { url, traceId: context.traceId });
      }
      return context;
    }
    // decidePrivacy denies only when isPrivate was true, so privacyInfo is
    // non-null here; the guard keeps that contract explicit for the compiler.
    if (!privacyInfo) {
      return context;
    }

    // Private page detected
    addLog(LogType.WARN, 'Private page detected', {
      url,
      reason: privacyInfo.reason,
      requireConfirmation,
      traceId: context.traceId
    });

    // deny 3分岐の payload 形状は deniedBy が単一所有する
    // （requireConfirmation と behavior=confirm は headerValue 有無が異なる）。
    const reason = privacyInfo.reason || 'cache-control';
    const actualHeaderValue = headerValue ||
      (reason === 'cache-control' ? privacyInfo.headers?.cacheControl || '' : '');

    await this.savePendingPage(url, title, reason, actualHeaderValue);

    if (decision.deniedBy === 'skip') {
      throw new PrivatePageError('PRIVATE_PAGE_DETECTED', pickDefined({ reason: privacyInfo.reason }));
    }
    throw new PrivatePageError('PRIVATE_PAGE_DETECTED', {
      confirmationRequired: true,
      ...(decision.deniedBy === 'confirm' ? { headerValue: actualHeaderValue } : {}),
      ...pickDefined({ reason: privacyInfo.reason }),
    });

    // 'save' - continue
    addLog(LogType.INFO, 'Auto-saving private page (behavior=save)', { url, traceId: context.traceId });

    return context;
  }

  private extractDomain(url: string): string | null {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  }

  private async savePendingPage(
    url: string,
    title: string,
    reason: string,
    headerValue: string
  ): Promise<void> {
    // PBI 2026-09-21-28: 組み立ては pendingStorage.buildPendingPage（純粋関数）
    // に委譲する。この step は clock 注入と I/O（addPendingPage）のみを担う。
    await addPendingPage(buildPendingPage({ url, title, reason, headerValue }, Date.now()));
  }
}

/**
 * Custom error class for private page detection
 */
export class PrivatePageError extends Error {
  public reason?: string;
  public confirmationRequired?: boolean;
  public headerValue?: string;

  constructor(
    message: string,
    options: { reason?: string; confirmationRequired?: boolean; headerValue?: string } = {}
  ) {
    super(message);
    Object.assign(this, pickDefined(options));
  }
}
