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
import { decideGate, normalizePrivacyAutoBehavior, shouldBypassPrivacyFetch, describePrivacyDenial } from '../../../utils/recordingGateTable.js';

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
    // (The bypass log is emitted from the bypass branch below so the
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

    // The fetch plan is I/O scheduling, not a verdict: force and whitelist
    // bypass the fetch before privacy is known. The predicate lives in the
    // gate table so the step never re-derives the bypass matrix.
    const behavior = normalizePrivacyAutoBehavior(
      settings[StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR] || 'save'
    );
    // Log wording and return shape stay byte-equal to the former two early
    // returns (force-first log order preserved).
    if (shouldBypassPrivacyFetch(force, shouldSkipPrivacyCheck)) {
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

    // The verdict comes from the single gate-table interface; this step
    // only performs I/O (fetch, pending save, logging) around it.
    // The post-fetch call owns the isPrivate matrix only; deniedBy carries
    // the payload shape so the step never re-derives it.
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

    // The deny-payload shape is owned by describePrivacyDenial in the gate
    // table (requireConfirmation and behavior=confirm stay distinct because
    // only the latter carries the header value).
    const reason = privacyInfo.reason || 'cache-control';
    const actualHeaderValue = headerValue ||
      (reason === 'cache-control' ? privacyInfo.headers?.cacheControl || '' : '');

    await this.savePendingPage(url, title, reason, actualHeaderValue);

    const denial = describePrivacyDenial(decision);
    if (!denial.confirmationRequired) {
      throw new PrivatePageError('PRIVATE_PAGE_DETECTED', pickDefined({ reason: privacyInfo.reason }));
    }
    throw new PrivatePageError('PRIVATE_PAGE_DETECTED', {
      confirmationRequired: true,
      ...(denial.includeHeaderValue ? { headerValue: actualHeaderValue } : {}),
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
